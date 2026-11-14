"""Rig-PC edge gateway with a durable SQLite outbox and MQTT delivery."""

import asyncio
import json
import logging
import os
import re
import signal
import sqlite3
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

_BACKEND_DIR = str(Path(__file__).resolve().parents[1] / "backend")
if _BACKEND_DIR not in sys.path:
    sys.path.append(_BACKEND_DIR)

from daq_listeners import PROTOCOL_TASKS  # noqa: E402

logger = logging.getLogger("aegis.edge")


class QueueFullError(RuntimeError):
    """Raised before an event is accepted when the configured disk queue is full."""


class SQLiteOutbox:
    def __init__(self, path: str, max_pending: int = 0):
        if max_pending < 0:
            raise ValueError("max_pending must be zero (unlimited) or positive")
        self.path = path
        self.max_pending = max_pending
        self._lock = threading.RLock()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, timeout=30, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA synchronous=FULL")
            self._db.execute("PRAGMA busy_timeout=30000")
            self._db.execute(
                """
                CREATE TABLE IF NOT EXISTS telemetry_events (
                    event_id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'inflight', 'published')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at REAL NOT NULL DEFAULT 0,
                    last_error TEXT,
                    published_at TEXT
                )
                """
            )
            self._db.execute(
                "CREATE INDEX IF NOT EXISTS telemetry_pending "
                "ON telemetry_events(status, next_attempt_at, created_at)"
            )
            self._db.execute(
                "UPDATE telemetry_events SET status='pending' WHERE status='inflight'"
            )
            self._db.commit()

    def enqueue(self, payload: Dict[str, Any]) -> str:
        if not isinstance(payload, dict):
            raise ValueError("telemetry payload must be an object")
        event = dict(payload)
        raw_event_id = event.get("client_id")
        event_id = str(raw_event_id) if raw_event_id not in (None, "") else uuid.uuid4().hex
        if not event_id or len(event_id) > 128:
            raise ValueError("client_id must contain 1 to 128 characters")
        event["client_id"] = event_id
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                existing = self._db.execute(
                    "SELECT payload FROM telemetry_events WHERE event_id=?", (event_id,)
                ).fetchone()
                if existing:
                    if event.get("event_at") in (None, ""):
                        event["event_at"] = json.loads(existing["payload"])["event_at"]
                    serialized = self._serialize(event)
                    if existing["payload"] != serialized:
                        raise ValueError("client_id already exists with a different payload")
                    self._db.commit()
                    return event_id
                if event.get("event_at") in (None, ""):
                    event["event_at"] = datetime.now(timezone.utc).isoformat()
                serialized = self._serialize(event)
                if self.max_pending:
                    count = self._db.execute(
                        "SELECT COUNT(*) FROM telemetry_events WHERE status != 'published'"
                    ).fetchone()[0]
                    if count >= self.max_pending:
                        raise QueueFullError("telemetry outbox is full; caller must apply back-pressure")
                self._db.execute(
                    "INSERT INTO telemetry_events(event_id, created_at, payload, status) "
                    "VALUES (?, ?, ?, 'pending')",
                    (event_id, event["event_at"], serialized),
                )
                self._db.commit()
            except Exception:
                self._db.rollback()
                raise
        return event_id

    @staticmethod
    def _serialize(event: Dict[str, Any]) -> str:
        event_at = event.get("event_at")
        if not isinstance(event_at, str) or not event_at:
            raise ValueError("event_at must be a non-empty ISO timestamp")
        try:
            parsed = datetime.fromisoformat(event_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("event_at must be a valid ISO timestamp") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        event["event_at"] = parsed.astimezone(timezone.utc).isoformat()
        return json.dumps(event, separators=(",", ":"), sort_keys=True, allow_nan=False)

    def claim_next(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                row = self._db.execute(
                    "SELECT event_id, payload, attempts FROM telemetry_events "
                    "WHERE status='pending' AND next_attempt_at <= ? "
                    "ORDER BY created_at, event_id LIMIT 1",
                    (time.time(),),
                ).fetchone()
                if row is None:
                    self._db.commit()
                    return None
                self._db.execute(
                    "UPDATE telemetry_events SET status='inflight', attempts=attempts+1 "
                    "WHERE event_id=?",
                    (row["event_id"],),
                )
                self._db.commit()
                return {
                    "event_id": row["event_id"],
                    "payload": row["payload"],
                    "attempts": row["attempts"] + 1,
                }
            except Exception:
                self._db.rollback()
                raise

    def mark_published(self, event_id: str) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE telemetry_events SET status='published', published_at=?, "
                "last_error=NULL WHERE event_id=?",
                (datetime.now(timezone.utc).isoformat(), event_id),
            )
            self._db.commit()

    def retry(self, event_id: str, attempts: int, error: str) -> None:
        delay = min(300, 2 ** min(max(attempts - 1, 0), 8))
        with self._lock:
            self._db.execute(
                "UPDATE telemetry_events SET status='pending', next_attempt_at=?, "
                "last_error=? WHERE event_id=?",
                (time.time() + delay, error[:500], event_id),
            )
            self._db.commit()

    def pending_count(self) -> int:
        with self._lock:
            return self._db.execute(
                "SELECT COUNT(*) FROM telemetry_events WHERE status != 'published'"
            ).fetchone()[0]

    def prune_published(self, retention_seconds: int) -> int:
        if retention_seconds < 0:
            raise ValueError("retention_seconds cannot be negative")
        cutoff = datetime.fromtimestamp(time.time() - retention_seconds, timezone.utc).isoformat()
        with self._lock:
            cur = self._db.execute(
                "DELETE FROM telemetry_events WHERE status='published' AND published_at < ?",
                (cutoff,),
            )
            self._db.commit()
            return cur.rowcount

    def close(self) -> None:
        with self._lock:
            self._db.close()


class MQTTOutboxPublisher:
    def __init__(
        self,
        outbox: SQLiteOutbox,
        *,
        host: str,
        port: int,
        device_id: str,
        username: str,
        password: str,
        ca_file: str,
        topic_prefix: str = "aegis",
        qos: int = 2,
        client_cert: Optional[str] = None,
        client_key: Optional[str] = None,
        published_retention_seconds: int = 30 * 24 * 60 * 60,
    ):
        if not host or not device_id or not username or not password or not ca_file:
            raise ValueError("MQTT host, device ID, credentials, and CA file are required")
        if not 1 <= port <= 65535:
            raise ValueError("MQTT port must be between 1 and 65535")
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", device_id):
            raise ValueError("device ID may contain only letters, digits, dot, underscore, and hyphen")
        if qos not in (1, 2):
            raise ValueError("MQTT QoS must be 1 or 2")
        if published_retention_seconds < 0:
            raise ValueError("published retention cannot be negative")
        if bool(client_cert) != bool(client_key):
            raise ValueError("client certificate and key must be configured together")
        topic_segments = topic_prefix.strip("/").split("/")
        if not topic_segments or any(not part or "+" in part or "#" in part for part in topic_segments):
            raise ValueError("MQTT topic prefix must contain literal, non-empty segments")
        self.outbox = outbox
        self.host = host
        self.port = port
        self.device_id = device_id
        self.username = username
        self.password = password
        self.ca_file = ca_file
        self.topic = f"{topic_prefix.strip('/')}/{device_id}/telemetry"
        self.qos = qos
        self.client_cert = client_cert
        self.client_key = client_key
        self.published_retention_seconds = published_retention_seconds
        self.stop_event = threading.Event()

    def run(self) -> None:
        import paho.mqtt.client as mqtt

        client = None
        try:
            client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=self.device_id,
                clean_session=False,
                protocol=mqtt.MQTTv311,
            )
            client.username_pw_set(self.username, self.password)
            client.tls_set(
                ca_certs=self.ca_file,
                certfile=self.client_cert,
                keyfile=self.client_key,
                cert_reqs=ssl.CERT_REQUIRED,
                tls_version=ssl.PROTOCOL_TLS_CLIENT,
            )
            client.connect_async(self.host, self.port, keepalive=60)
            client.loop_start()
            last_prune_at = 0.0
            while not self.stop_event.is_set():
                if time.monotonic() - last_prune_at >= 3600:
                    self.outbox.prune_published(self.published_retention_seconds)
                    last_prune_at = time.monotonic()
                if not client.is_connected():
                    self.stop_event.wait(1)
                    continue
                item = self.outbox.claim_next()
                if item is None:
                    self.stop_event.wait(0.25)
                    continue
                try:
                    info = client.publish(self.topic, item["payload"], qos=self.qos, retain=False)
                    if info.rc != mqtt.MQTT_ERR_SUCCESS:
                        raise RuntimeError(f"MQTT publish rejected with code {info.rc}")
                    info.wait_for_publish(timeout=30)
                    if not info.is_published():
                        raise TimeoutError("MQTT publish acknowledgement timed out")
                    self.outbox.mark_published(item["event_id"])
                except Exception as exc:
                    self.outbox.retry(item["event_id"], item["attempts"], str(exc))
                    logger.warning("MQTT delivery deferred for %s: %s", item["event_id"], exc)
        except Exception:
            logger.exception("MQTT outbox publisher stopped unexpectedly")
            raise
        finally:
            if client is not None:
                client.disconnect()
                client.loop_stop()

    def stop(self) -> None:
        self.stop_event.set()


async def run_daq(outbox: SQLiteOutbox, protocol: str, config: Dict[str, Any]) -> None:
    protocol = protocol.lower()
    if protocol not in ("wits0", "wits0_tcp", "modbus", "modbus_tcp"):
        raise ValueError("edge gateway supports only WITS0 TCP and Modbus TCP DAQ inputs")
    runner = PROTOCOL_TASKS[protocol]
    delay = 1.0
    while True:
        def on_sample(sample, status_update=None):
            if sample:
                outbox.enqueue(sample)

        try:
            await runner(config, on_sample)
            delay = 1.0
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("DAQ connection failed; retrying in %.1f seconds", delay)
        await asyncio.sleep(delay)
        delay = min(60.0, delay * 2)


async def _supervise_daq(daq_task: asyncio.Task, publisher, publisher_thread) -> None:
    while not publisher.stop_event.is_set():
        if not publisher_thread.is_alive():
            raise RuntimeError("MQTT publisher thread exited; stopping DAQ to preserve failure visibility")
        if daq_task.done():
            daq_task.result()
            raise RuntimeError("DAQ task exited unexpectedly; stopping service")
        await asyncio.sleep(0.25)


def main() -> None:
    logging.basicConfig(
        level=os.getenv("AEGIS_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    db_path = os.environ.get("AEGIS_SQLITE_PATH", "/var/lib/aegis-edge/telemetry.sqlite3")
    outbox = SQLiteOutbox(db_path, int(os.getenv("AEGIS_MAX_PENDING", "0")))
    publisher = MQTTOutboxPublisher(
        outbox,
        host=os.environ["AEGIS_MQTT_HOST"],
        port=int(os.getenv("AEGIS_MQTT_PORT", "8883")),
        device_id=os.environ["AEGIS_DEVICE_ID"],
        username=os.environ["AEGIS_MQTT_USERNAME"],
        password=os.environ["AEGIS_MQTT_PASSWORD"],
        ca_file=os.environ["AEGIS_MQTT_CA_FILE"],
        topic_prefix=os.getenv("AEGIS_MQTT_TOPIC_PREFIX", "aegis"),
        qos=int(os.getenv("AEGIS_MQTT_QOS", "2")),
        client_cert=os.getenv("AEGIS_MQTT_CLIENT_CERT"),
        client_key=os.getenv("AEGIS_MQTT_CLIENT_KEY"),
        published_retention_seconds=int(os.getenv("AEGIS_PUBLISHED_RETENTION_DAYS", "30")) * 24 * 60 * 60,
    )
    protocol = os.environ["AEGIS_DAQ_PROTOCOL"]
    config = json.loads(os.environ["AEGIS_DAQ_CONFIG"])
    if not isinstance(config, dict):
        raise ValueError("AEGIS_DAQ_CONFIG must be a JSON object")

    publisher_thread = threading.Thread(target=publisher.run, name="mqtt-outbox", daemon=True)
    publisher_thread.start()

    def stop(*_):
        publisher.stop()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    async def serve():
        daq_task = asyncio.create_task(run_daq(outbox, protocol, config))
        try:
            await _supervise_daq(daq_task, publisher, publisher_thread)
        finally:
            if not daq_task.done():
                daq_task.cancel()
            try:
                await daq_task
            except asyncio.CancelledError:
                pass

    try:
        asyncio.run(serve())
    finally:
        publisher.stop()
        publisher_thread.join(timeout=35)
        outbox.close()


if __name__ == "__main__":
    main()
