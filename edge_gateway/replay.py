"""Windowed batch publisher: drains the SQLite store to MQTT and marks rows synced on cloud ack.

Live rows (``is_historical_sync = 0``) are always sent before historical backfill so a
blackout recovery never delays current telemetry. Unacked batches are re-sent after a
timeout; the cloud consumer upserts idempotently so re-delivery is harmless.
"""

import json
import logging
import ssl
import threading
import time
import uuid
from typing import Callable, Dict, Optional, Tuple

from .store import TABLES, TOPIC_SUFFIX, EdgeStore

logger = logging.getLogger("aegis.edge.replay")

Publish = Callable[[str, bytes], None]


class BatchReplayPublisher:
    def __init__(
        self,
        store: EdgeStore,
        publish: Publish,
        *,
        batch_size: int = 500,
        max_inflight: int = 8,
        max_live_inflight: int = 16,
        ack_timeout_s: float = 30.0,
    ):
        if batch_size < 1 or max_inflight < 1:
            raise ValueError("batch_size and max_inflight must be positive")
        self.store, self.publish = store, publish
        self.batch_size, self.max_inflight, self.ack_timeout_s = batch_size, max_inflight, ack_timeout_s
        # Live rows get their own window so a deep historical backlog can never delay them.
        self.max_live_inflight = max_live_inflight
        self.base = f"aegis/{store.org_id}/{store.rig_id}"
        self.ack_topic = f"{self.base}/ack"
        self._lock = threading.Lock()
        # batch_id -> (table, ids, sent_monotonic, historical)
        self._inflight: Dict[str, Tuple[str, list, float, int]] = {}
        self._claimed: set = set()

    def inflight_count(self, historical: Optional[int] = None) -> int:
        with self._lock:
            return sum(1 for e in self._inflight.values() if historical in (None, e[3]))

    def pump(self, max_historical_batches: int = 1) -> int:
        """Send live batches, then a few historical ones, so live rows are re-checked often."""
        sent = 0
        hist_sent = 0
        self._expire_stale()
        for historical in (0, 1):
            for table in TABLES:
                while True:
                    limit = self.max_inflight if historical else self.max_live_inflight
                    if self.inflight_count(historical) >= limit:
                        break
                    with self._lock:
                        claimed = set(self._claimed)
                    rows = [
                        r for r in self.store.unsynced(
                            table, self.batch_size + len(claimed), historical=historical)
                        if r["id"] not in claimed
                    ][: self.batch_size]
                    if not rows:
                        break
                    self._send(table, rows, historical)
                    sent += 1
                    if historical:
                        hist_sent += 1
                        if hist_sent >= max_historical_batches:
                            return sent
        return sent

    def _send(self, table: str, rows: list, historical: int) -> None:
        batch_id = uuid.uuid4().hex
        ids = [r["id"] for r in rows]
        payload = json.dumps(
            {"batch_id": batch_id, "table": table, "records": rows},
            separators=(",", ":"), allow_nan=False,
        ).encode()
        with self._lock:
            self._inflight[batch_id] = (table, ids, time.monotonic(), historical)
            self._claimed.update(ids)
        try:
            self.publish(f"{self.base}/{TOPIC_SUFFIX[table]}", payload)
        except Exception:
            self._release(batch_id)
            raise

    def _release(self, batch_id: str) -> Optional[Tuple[str, list, float, int]]:
        with self._lock:
            entry = self._inflight.pop(batch_id, None)
            if entry:
                self._claimed.difference_update(entry[1])
            return entry

    def _expire_stale(self) -> None:
        now = time.monotonic()
        with self._lock:
            stale = [b for b, (_, _, t, _) in self._inflight.items() if now - t > self.ack_timeout_s]
        for batch_id in stale:
            logger.warning("batch %s unacked after %.0fs; will resend", batch_id, self.ack_timeout_s)
            self._release(batch_id)

    def on_ack(self, payload: bytes) -> int:
        """Handle an ack; rows the cloud accepted or already had are marked synced."""
        try:
            ack = json.loads(payload)
            batch_id = ack["batch_id"]
        except (ValueError, KeyError, TypeError):
            logger.warning("ignoring malformed ack")
            return 0
        entry = self._release(batch_id)
        if entry is None:
            return 0
        table, ids = entry[0], entry[1]
        if ack.get("status") == "retry":
            return 0
        # Permanently rejected rows are marked synced too so one bad row cannot block the queue.
        return self.store.mark_synced(table, ids)


class MqttReplayRunner:
    """paho-mqtt transport (mTLS) around BatchReplayPublisher."""

    def __init__(
        self,
        store: EdgeStore,
        *,
        host: str,
        port: int = 8883,
        ca_file: Optional[str] = None,
        client_cert: Optional[str] = None,
        client_key: Optional[str] = None,
        qos: int = 1,
        **publisher_kwargs,
    ):
        self.store, self.host, self.port, self.qos = store, host, port, qos
        self.ca_file, self.client_cert, self.client_key = ca_file, client_cert, client_key
        self.publisher = BatchReplayPublisher(store, self._publish, **publisher_kwargs)
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self._client = None

    def _publish(self, topic: str, payload: bytes) -> None:
        info = self._client.publish(topic, payload, qos=self.qos)
        if info.rc != 0:
            raise RuntimeError(f"MQTT publish rejected rc={info.rc}")

    def _on_message(self, client, userdata, message) -> None:
        self.publisher.on_ack(message.payload)
        self.wake.set()

    def run(self) -> None:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"{self.store.org_id}-{self.store.rig_id}",
            clean_session=False,
            protocol=mqtt.MQTTv311,
        )
        if self.ca_file:
            client.tls_set(
                ca_certs=self.ca_file, certfile=self.client_cert, keyfile=self.client_key,
                cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT,
            )
        client.on_connect = lambda c, *_: c.subscribe(self.publisher.ack_topic, qos=1)
        client.on_message = self._on_message
        client.max_inflight_messages_set(self.publisher.max_inflight * 4)
        self._client = client
        client.connect_async(self.host, self.port, keepalive=60)
        client.loop_start()
        try:
            while not self.stop_event.is_set():
                if client.is_connected():
                    self.wake.clear()
                    if self.publisher.pump() == 0:
                        self.wake.wait(0.05)
                else:
                    self.stop_event.wait(1)
        finally:
            client.disconnect()
            client.loop_stop()

    def stop(self) -> None:
        self.stop_event.set()
