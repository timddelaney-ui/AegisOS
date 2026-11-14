"""Cloud-side MQTT consumer: validated, idempotent ingestion of rig telemetry into MongoDB.

Routing
  * ``is_historical_sync == 0`` -> live path: broadcast to WebSocket clients first, then persist.
  * ``is_historical_sync == 1`` -> bounded background queue drained by worker tasks, so
    blackout catch-up never delays or floods live dashboards.

Idempotency
  Records are insert-only under a unique ``(org_id, rig_id, id)`` index; duplicate-key rejections on
  replay are absorbed, so a replayed packet never creates a duplicate or overwrites stored state. The rolling
  ``rig_live_state`` document is only advanced by live records with a newer timestamp.

Acknowledgement
  An ack is published to ``aegis/{org}/{rig}/ack`` only after every part of a batch is durably
  stored (or permanently rejected), so the rig-PC may then mark the rows synced.
"""

import asyncio
import json
import logging
import os
import ssl
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from pydantic import ValidationError
from pymongo import ASCENDING, InsertOne
from pymongo.errors import BulkWriteError

from .telemetry_schema import (
    COLLECTION_FOR_TABLE,
    MODEL_FOR_TABLE,
    SEGMENT,
    TOPIC_KIND_TO_TABLE,
    BatchEnvelope,
)

logger = logging.getLogger("aegis.mqtt_consumer")

LiveSink = Callable[[str, str, str, List[dict]], Awaitable[None]]
AckSink = Callable[[str, str, bytes], Awaitable[None]]


def _validate_records(table: str, org_id: str, rig_id: str, records: List[dict]):
    """Pure function so CPU-heavy historical validation can run in a worker process."""
    model = MODEL_FOR_TABLE[table]
    docs, rejected = [], []
    for raw in records:
        rid = raw.get("id") if isinstance(raw, dict) else None
        try:
            rec = model.model_validate(raw)
        except ValidationError as exc:
            rejected.append({"id": rid, "reason": exc.errors()[0]["msg"][:120]})
            continue
        # The topic is the authenticated scope (broker ACL); never trust payload tenancy.
        if rec.org_id != org_id or rec.rig_id != rig_id:
            rejected.append({"id": rec.id, "reason": "tenant_mismatch"})
            continue
        docs.append(rec.model_dump())
    return docs, rejected


def parse_topic(topic: str) -> Optional[Tuple[str, str, str]]:
    """Return (org_id, rig_id, table) for ``aegis/{org}/{rig}/telemetry/{events|snapshots|consensus}``."""
    parts = topic.split("/")
    if len(parts) != 5 or parts[0] != "aegis" or parts[3] != "telemetry":
        return None
    org_id, rig_id, kind = parts[1], parts[2], parts[4]
    if not (SEGMENT.match(org_id) and SEGMENT.match(rig_id)) or kind not in TOPIC_KIND_TO_TABLE:
        return None
    return org_id, rig_id, TOPIC_KIND_TO_TABLE[kind]


@dataclass
class _Batch:
    org_id: str
    rig_id: str
    table: str
    batch_id: str
    parts: int = 0
    accepted: int = 0
    duplicates: int = 0
    rejected: List[dict] = field(default_factory=list)
    retry: bool = False


@dataclass
class IngestMetrics:
    batches: int = 0
    inserted: int = 0
    duplicates: int = 0
    rejected: int = 0
    live_records: int = 0
    historical_records: int = 0
    queue_overflows: int = 0
    max_bulk_write_s: float = 0.0


class TelemetryIngestor:
    def __init__(
        self,
        db,
        *,
        live_sink: Optional[LiveSink] = None,
        ack_sink: Optional[AckSink] = None,
        historical_workers: int = 2,
        historical_queue_size: int = 2000,
        upsert_chunk: int = 1000,
    ):
        self.db = db
        self.live_sink, self.ack_sink = live_sink, ack_sink
        self.historical_workers = historical_workers
        self.upsert_chunk = upsert_chunk
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=historical_queue_size)
        self._workers: List[asyncio.Task] = []
        self._tasks: set = set()
        self._pool = ProcessPoolExecutor(max_workers=max(1, historical_workers))
        self.metrics = IngestMetrics()

    # ---- lifecycle -----------------------------------------------------
    async def ensure_indexes(self) -> None:
        for table in COLLECTION_FOR_TABLE.values():
            coll = self.db[table]
            await coll.create_index(
                [("org_id", ASCENDING), ("rig_id", ASCENDING), ("id", ASCENDING)],
                unique=True, name="org_rig_id_unique")
            await coll.create_index(
                [("org_id", ASCENDING), ("rig_id", ASCENDING), ("ts", ASCENDING)], name="org_rig_ts")
        await self.db.rig_live_state.create_index(
            [("org_id", ASCENDING), ("rig_id", ASCENDING)], unique=True, name="org_rig_unique")

    async def start(self) -> None:
        # Spawn and warm the validation workers up front so the first backfill burst is not slowed.
        loop = asyncio.get_running_loop()
        await asyncio.gather(*[
            loop.run_in_executor(self._pool, _validate_records, table, "warm", "warm", [{}])
            for table in list(MODEL_FOR_TABLE) * max(1, self.historical_workers)
        ])
        for _ in range(self.historical_workers):
            self._workers.append(asyncio.create_task(self._historical_worker()))

    async def stop(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        self._pool.shutdown(wait=False, cancel_futures=True)

    async def drain(self) -> None:
        """Wait until all queued and in-flight work has completed (tests/benchmarks)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)
        await self._queue.join()

    # ---- entry point (never blocks on historical persistence) ----------
    def submit(self, topic: str, payload: bytes) -> None:
        routed = parse_topic(topic)
        if routed is None:
            logger.warning("dropping message on unrecognised topic %s", topic)
            return
        org_id, rig_id, table = routed
        try:
            envelope = BatchEnvelope.model_validate_json(payload)
        except ValidationError:
            logger.warning("rejecting malformed envelope on %s", topic)
            return
        if envelope.table not in (None, table):
            logger.warning("envelope table %s does not match topic %s", envelope.table, topic)
            return
        batch = _Batch(org_id, rig_id, table, envelope.batch_id)
        live = [r for r in envelope.records if not _is_historical(r)]
        hist = [r for r in envelope.records if _is_historical(r)]
        batch.parts = bool(live) + bool(hist)
        if batch.parts == 0:
            self._spawn(self._finish_part(batch))
            return
        if live:
            self._spawn(self._process_live(batch, live))
        if hist:
            try:
                self._queue.put_nowait((batch, hist))
            except asyncio.QueueFull:
                # The rig keeps the rows unsynced and re-sends once the window reopens.
                self.metrics.queue_overflows += 1
                batch.retry = True
                self._spawn(self._finish_part(batch))

    def _spawn(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ---- processing ----------------------------------------------------
    def _validate(self, batch: _Batch, records: List[dict]) -> List[dict]:
        docs, rejected = _validate_records(batch.table, batch.org_id, batch.rig_id, records)
        batch.rejected.extend(rejected)
        return docs

    async def _process_live(self, batch: _Batch, records: List[dict]) -> None:
        try:
            docs = self._validate(batch, records)
            self.metrics.live_records += len(docs)
            if docs and self.live_sink:
                try:
                    await self.live_sink(batch.org_id, batch.rig_id, batch.table, docs)
                except Exception:
                    logger.exception("live broadcast failed")
            await self._persist(batch, docs, live=True)
        except Exception:
            logger.exception("live ingest failed for batch %s", batch.batch_id)
            batch.retry = True
        await self._finish_part(batch)

    async def _historical_worker(self) -> None:
        while True:
            batch, records = await self._queue.get()
            try:
                loop = asyncio.get_running_loop()
                # A worker process keeps backfill validation from stealing the GIL from live traffic.
                docs, rejected = await loop.run_in_executor(
                    self._pool, _validate_records, batch.table, batch.org_id, batch.rig_id, records)
                batch.rejected.extend(rejected)
                self.metrics.historical_records += len(docs)
                await self._persist(batch, docs, live=False)
            except Exception:
                logger.exception("historical ingest failed for batch %s", batch.batch_id)
                batch.retry = True
            await self._finish_part(batch)
            self._queue.task_done()

    async def _persist(self, batch: _Batch, docs: List[dict], *, live: bool) -> None:
        if not docs:
            return
        coll = self.db[COLLECTION_FOR_TABLE[batch.table]]
        now = datetime.now(timezone.utc)
        for i in range(0, len(docs), self.upsert_chunk):
            chunk = docs[i:i + self.upsert_chunk]
            ops = [InsertOne({**d, "ingested_at": now, "source": "mqtt"}) for d in chunk]
            started = time.perf_counter()
            try:
                result = await coll.bulk_write(ops, ordered=False)
                inserted = result.inserted_count
            except BulkWriteError as exc:
                # The unique (org_id, rig_id, id) index rejects replays; anything else is a real failure.
                errors = exc.details.get("writeErrors", [])
                if any(e.get("code") != 11000 for e in errors):
                    raise
                inserted = exc.details.get("nInserted", len(chunk) - len(errors))
            self.metrics.max_bulk_write_s = max(self.metrics.max_bulk_write_s, time.perf_counter() - started)
            batch.accepted += inserted
            batch.duplicates += len(chunk) - inserted
            self.metrics.inserted += inserted
            self.metrics.duplicates += len(chunk) - inserted
        if live and batch.table != "telemetry_events":
            await self._advance_live_state(batch, docs)

    async def _advance_live_state(self, batch: _Batch, docs: List[dict]) -> None:
        newest = max(docs, key=lambda d: d["ts"])
        key = "snapshot" if batch.table == "telemetry_snapshots" else "consensus"
        scope = {"org_id": batch.org_id, "rig_id": batch.rig_id}
        update = {"$set": {key: newest["channels"] if key == "snapshot" else newest,
                           f"{key}_ts": newest["ts"]}}
        res = await self.db.rig_live_state.update_one(
            {**scope, "$or": [{f"{key}_ts": {"$lt": newest["ts"]}}, {f"{key}_ts": {"$exists": False}}]},
            update)
        if res.matched_count == 0:
            try:
                await self.db.rig_live_state.insert_one({**scope, **update["$set"]})
            except Exception:
                pass  # a newer (or concurrent) live record already owns the state

    async def _finish_part(self, batch: _Batch) -> None:
        batch.parts -= 1
        if batch.parts > 0:
            return
        self.metrics.batches += 1
        self.metrics.rejected += len(batch.rejected)
        if self.ack_sink:
            ack = {
                "batch_id": batch.batch_id,
                "table": batch.table,
                "status": "retry" if batch.retry else "ok",
                "accepted": batch.accepted,
                "duplicates": batch.duplicates,
                "rejected": batch.rejected[:50],
                "rejected_count": len(batch.rejected),
                "ts": datetime.now(timezone.utc).isoformat(),
            }
            try:
                await self.ack_sink(batch.org_id, batch.rig_id, json.dumps(ack).encode())
            except Exception:
                logger.exception("failed to publish ack for batch %s", batch.batch_id)


def _is_historical(record: Any) -> bool:
    return isinstance(record, dict) and record.get("is_historical_sync") == 1


# ---------------------------------------------------------------------------
# MQTT transport
# ---------------------------------------------------------------------------
@dataclass
class MqttSettings:
    enabled: bool
    broker_url: str
    tls_ca: Optional[str]
    client_cert: Optional[str]
    client_key: Optional[str]
    client_id: str = "aegis-cloud-consumer"
    username: Optional[str] = None
    password: Optional[str] = None

    @classmethod
    def from_env(cls, env=os.environ) -> "MqttSettings":
        return cls(
            enabled=env.get("MQTT_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"},
            broker_url=env.get("MQTT_BROKER_URL", "").strip(),
            tls_ca=env.get("MQTT_TLS_CA") or None,
            client_cert=env.get("MQTT_CLIENT_CERT") or None,
            client_key=env.get("MQTT_CLIENT_KEY") or None,
            client_id=env.get("MQTT_CLIENT_ID", "aegis-cloud-consumer"),
            username=env.get("MQTT_USERNAME") or None,
            password=env.get("MQTT_PASSWORD") or None,
        )

    def validate(self) -> None:
        if not self.broker_url:
            raise ValueError("MQTT_BROKER_URL is required when MQTT_ENABLED=true")
        parsed = urlparse(self.broker_url)
        if parsed.scheme not in ("mqtt", "mqtts") or not parsed.hostname:
            raise ValueError("MQTT_BROKER_URL must look like mqtts://host:8883")
        # Managed brokers (EMQX Cloud, HiveMQ) use public CAs, so credentials may stand in for a CA file.
        if parsed.scheme == "mqtts" and not self.tls_ca and not self.username:
            raise ValueError("MQTT_TLS_CA (or MQTT_USERNAME for public-CA brokers) is required for mqtts:// brokers")
        if bool(self.username) != bool(self.password):
            raise ValueError("MQTT_USERNAME and MQTT_PASSWORD must be set together")
        if bool(self.client_cert) != bool(self.client_key):
            raise ValueError("MQTT_CLIENT_CERT and MQTT_CLIENT_KEY must be set together")

    def tls_context(self) -> Optional[ssl.SSLContext]:
        if urlparse(self.broker_url).scheme != "mqtts":
            return None
        ctx = ssl.create_default_context(cafile=self.tls_ca)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        if self.client_cert:
            ctx.load_cert_chain(self.client_cert, self.client_key)
        return ctx


SUBSCRIPTION = "aegis/+/+/telemetry/#"


class MqttConsumerService:
    """Runs the aiomqtt subscribe loop with automatic reconnection."""

    def __init__(self, ingestor: TelemetryIngestor, settings: MqttSettings):
        self.ingestor, self.settings = ingestor, settings
        self._task: Optional[asyncio.Task] = None
        self._client = None
        self.connected = asyncio.Event()

    async def start(self) -> None:
        self.settings.validate()
        self.ingestor.ack_sink = self._publish_ack
        await self.ingestor.ensure_indexes()
        await self.ingestor.start()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        await self.ingestor.stop()

    async def _publish_ack(self, org_id: str, rig_id: str, payload: bytes) -> None:
        client = self._client
        if client is None:
            raise ConnectionError("MQTT client not connected")
        await client.publish(f"aegis/{org_id}/{rig_id}/ack", payload, qos=1)

    async def _run(self) -> None:
        import aiomqtt

        parsed = urlparse(self.settings.broker_url)
        port = parsed.port or (8883 if parsed.scheme == "mqtts" else 1883)
        delay = 1.0
        while True:
            try:
                async with aiomqtt.Client(
                    parsed.hostname, port,
                    identifier=self.settings.client_id,
                    username=self.settings.username,
                    password=self.settings.password,
                    clean_session=False,
                    protocol=aiomqtt.ProtocolVersion.V311,
                    tls_context=self.settings.tls_context(),
                    max_queued_incoming_messages=0,
                ) as client:
                    self._client = client
                    await client.subscribe(SUBSCRIPTION, qos=1)
                    self.connected.set()
                    delay = 1.0
                    async for message in client.messages:
                        self.ingestor.submit(str(message.topic), bytes(message.payload))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("MQTT consumer disconnected: %s; retrying in %.0fs", exc, delay)
            finally:
                self._client = None
                self.connected.clear()
            await asyncio.sleep(delay)
            delay = min(30.0, delay * 2)
