#!/usr/bin/env python3
"""4-hour comms-blackout burst-replay benchmark for the rig-PC -> MQTT -> MongoDB pipeline.

Builds an edge SQLite store holding a blackout backlog (1 Hz snapshots + encoder consensus +
fluid totalizer events, all ``is_historical_sync = 1``), replays it at burst speed over MQTT
into the cloud consumer while injecting live (``is_historical_sync = 0``) telemetry, then
replays *everything again* (simulating lost acks) and asserts:

  * 0 dropped records and 0 duplicate documents after the double replay,
  * sustained historical ingestion >= --min-throughput events/s with no write stalls,
  * live end-to-end p95 latency < --max-live-p95-ms while backfill is running.

Usage:
  python backend/scripts/benchmark_mqtt_replay.py                      # spawns local mosquitto
  python backend/scripts/benchmark_mqtt_replay.py --mongo-url mongodb://localhost:27017
  python backend/scripts/benchmark_mqtt_replay.py --broker-url mqtt://host:1883 --mongo-url ...
  python backend/scripts/benchmark_mqtt_replay.py --mongo-url mongomock --hours 0.05 --min-throughput 0

Requires paho-mqtt, aiomqtt, motor, pydantic and a `mosquitto` binary unless --broker-url is given.
Exit status is non-zero if any assertion fails.
"""

import argparse
import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
for p in (str(ROOT), str(ROOT / "backend")):
    if p not in sys.path:
        sys.path.insert(0, p)

from edge_gateway.channels import FLUID_CHANNELS  # noqa: E402
from edge_gateway.replay import MqttReplayRunner  # noqa: E402
from edge_gateway.store import EdgeStore  # noqa: E402
from services.mqtt_consumer import (  # noqa: E402
    MqttConsumerService,
    MqttSettings,
    TelemetryIngestor,
)

ORG, RIG = "bench-org", "rig-bench-1"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_local_broker(port: int, workdir: str):
    exe = shutil.which("mosquitto")
    if not exe:
        raise RuntimeError("mosquitto binary not found; pass --broker-url or install mosquitto")
    conf = Path(workdir) / "mosquitto.conf"
    conf.write_text(
        f"listener {port} 127.0.0.1\nallow_anonymous true\nmax_queued_messages 0\n"
        "max_inflight_messages 0\nmessage_size_limit 0\npersistence false\n"
    )
    proc = subprocess.Popen([exe, "-c", str(conf)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return proc
        time.sleep(0.1)
    proc.kill()
    raise RuntimeError("local mosquitto did not start")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")


def build_blackout(store: EdgeStore, hours: float, now: datetime) -> dict:
    seconds = int(hours * 3600)
    start = now - timedelta(seconds=seconds)
    snaps, cons, events = [], [], []
    totals = {f: 0.0 for f in FLUID_CHANNELS}
    for i in range(seconds):
        ts = iso(start + timedelta(seconds=i))
        depth = 1000.0 + i * 0.5
        # Every 600th second encoder 3 drifts > 2 ft so consensus warnings are exercised.
        drift = 3.0 if i % 600 == 0 else 0.1
        depths = {"encoder_1_depth_ft": depth, "encoder_2_depth_ft": depth + 0.1,
                  "encoder_3_depth_ft": depth + drift}
        channels = {**depths, "injector_speed_ft_per_min": 30.0, "injector_direction": 1.0,
                    "wellhead_pressure_psi": 2500.0 + (i % 50), "circulating_pressure_psi": 3100.0,
                    "pipe_weight_lbs": 21000.0}
        for f in FLUID_CHANNELS:
            channels[f"{f}_rate"] = 2.0
            totals[f] += 2.0 / 60.0
            channels[f"{f}_vol"] = round(totals[f], 4)
        snaps.append({"ts": ts, "channels": channels})
        cons.append({"ts": ts, "depths": depths})
        if i % 10 == 0:
            for f in FLUID_CHANNELS:
                events.append({"ts": ts, "channel": f"{f}_vol", "value": round(totals[f], 4), "unit": "bbl"})
    store.record_snapshots(snaps, is_historical_sync=1)
    store.record_consensus(cons, is_historical_sync=1)
    store.record_events(events, is_historical_sync=1)
    return {"telemetry_snapshots": len(snaps), "encoder_consensus": len(cons),
            "telemetry_events": len(events)}


async def get_db(mongo_url: str, db_name: str):
    if mongo_url == "mongomock":
        from mongomock_motor import AsyncMongoMockClient
        return AsyncMongoMockClient()[db_name], None
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
    await client.admin.command("ping")
    return client[db_name], client


def percentile(values, q):
    if not values:
        return float("nan")
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))]


async def wait_synced(store: EdgeStore, historical_only: bool, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not any(store.unsynced(t, 1, historical=1 if historical_only else None)
                   for t in ("telemetry_events", "telemetry_snapshots", "encoder_consensus")):
            return True
        await asyncio.sleep(0.05)
    return False


async def run(args) -> dict:
    tmp = tempfile.mkdtemp(prefix="aegis-bench-")
    broker = None
    db_name = f"aegis_bench_{os.getpid()}_{int(time.time())}"
    db, mongo_client = await get_db(args.mongo_url, db_name)
    try:
        if args.broker_url:
            parsed = urlparse(args.broker_url)
            host, port = parsed.hostname, parsed.port or 1883
            broker_url = args.broker_url
        else:
            port = free_port()
            broker = start_local_broker(port, tmp)
            host, broker_url = "127.0.0.1", f"mqtt://127.0.0.1:{port}"

        now = datetime.now(timezone.utc)
        store = EdgeStore(os.path.join(tmp, "edge.sqlite3"), ORG, RIG)
        expected = build_blackout(store, args.hours, now)
        total_hist = sum(expected.values())

        latencies_ms: list = []
        pass_start = [datetime.now(timezone.utc)]
        live_seen = [0]

        async def live_sink(org, rig, table, docs):
            t = datetime.now(timezone.utc)
            for d in docs:
                if d["ts"] < pass_start[0]:
                    continue  # re-delivered rows from earlier in the run are not fresh live samples
                latencies_ms.append((t - d["ts"]).total_seconds() * 1000.0)
                live_seen[0] += 1

        ingestor = TelemetryIngestor(db, live_sink=live_sink, historical_workers=args.workers)
        service = MqttConsumerService(ingestor, MqttSettings(
            enabled=True, broker_url=broker_url, tls_ca=None, client_cert=None, client_key=None,
            client_id=f"bench-consumer-{os.getpid()}"))
        await service.start()
        # Warm the Mongo connection pool and worker processes like a long-running service would be.
        await asyncio.gather(*[db.warmup.insert_one({"i": i}) for i in range(32)])
        await db.warmup.drop()
        ingestor._pool.submit(int, "0").result()
        await asyncio.wait_for(service.connected.wait(), 10)

        runner = MqttReplayRunner(store, host=host, port=port, batch_size=args.batch_size,
                                  max_inflight=args.max_inflight)
        thread = threading.Thread(target=runner.run, daemon=True)

        stop_live = threading.Event()
        live_written = [0]

        def live_injector():
            while not stop_live.is_set():
                ts = iso(datetime.now(timezone.utc))
                store.record_snapshots([{"ts": ts, "channels": {"encoder_1_depth_ft": 5000.0,
                                                                 "wellhead_pressure_psi": 2600.0}}],
                                       is_historical_sync=0)
                live_written[0] += 1
                runner.wake.set()
                stop_live.wait(1.0 / args.live_hz)

        def run_pass():
            return time.perf_counter()

        async def replay_pass(label: str) -> dict:
            store.reset_synced() if label == "second" else None
            latencies_ms.clear()
            pass_start[0] = datetime.now(timezone.utc)
            live_seen[0] = 0
            inj = threading.Thread(target=live_injector, daemon=True)
            started = run_pass()
            if label == "first":
                thread.start()
                # Measure latency during backfill, not the initial TCP/session setup.
                while runner._client is None or not runner._client.is_connected():
                    await asyncio.sleep(0.02)
            inj.start()
            ok = await wait_synced(store, historical_only=True, timeout=args.timeout)
            elapsed = time.perf_counter() - started
            stop_live.set()
            inj.join()
            stop_live.clear()
            await asyncio.sleep(0.3)
            return {"ok": ok, "elapsed_s": elapsed, "throughput_eps": total_hist / elapsed,
                    "live_p95_ms": percentile(latencies_ms, 0.95),
                    "live_p50_ms": percentile(latencies_ms, 0.50),
                    "live_samples": len(latencies_ms)}

        first = await replay_pass("first")
        await wait_synced(store, historical_only=False, timeout=30)
        await ingestor.drain()
        first_counts = {t: await db[t].count_documents({}) for t in expected}
        dup_before = ingestor.metrics.duplicates

        second = await replay_pass("second")
        await wait_synced(store, historical_only=False, timeout=30)
        await ingestor.drain()

        runner.stop()
        thread.join(timeout=10)

        counts, dup_docs = {}, {}
        for table in expected:
            counts[table] = await db[table].count_documents({})
            pipeline = [{"$group": {"_id": {"o": "$org_id", "r": "$rig_id", "i": "$id"},
                                    "n": {"$sum": 1}}}, {"$match": {"n": {"$gt": 1}}}, {"$count": "c"}]
            res = await db[table].aggregate(pipeline).to_list(1)
            dup_docs[table] = res[0]["c"] if res else 0
        local_total = store.total_counts()
        hist_expected = expected
        dropped = {t: local_total[t] - counts[t] for t in expected}
        await service.stop()

        report = {
            "blackout_hours": args.hours,
            "historical_records": hist_expected,
            "total_historical": total_hist,
            "first_pass": first,
            "second_pass": second,
            "mongo_counts": counts,
            "edge_counts": local_total,
            "dropped": dropped,
            "duplicate_documents": dup_docs,
            "duplicates_absorbed_on_replay": ingestor.metrics.duplicates - dup_before,
            "max_bulk_write_s": round(ingestor.metrics.max_bulk_write_s, 4),
            "queue_overflows": ingestor.metrics.queue_overflows,
            "rejected": ingestor.metrics.rejected,
        }
        failures = []
        if not (first["ok"] and second["ok"]):
            failures.append("replay did not complete before timeout")
        if any(v != 0 for v in dropped.values()):
            failures.append(f"dropped records: {dropped}")
        if any(v != 0 for v in dup_docs.values()):
            failures.append(f"duplicate documents: {dup_docs}")
        if any(counts[t] < expected[t] for t in expected):
            failures.append("historical counts below expected")
        if ingestor.metrics.rejected:
            failures.append(f"{ingestor.metrics.rejected} records rejected")
        if first["throughput_eps"] < args.min_throughput:
            failures.append(f"throughput {first['throughput_eps']:.0f}/s < {args.min_throughput}")
        if ingestor.metrics.max_bulk_write_s > args.max_write_stall_s:
            failures.append(f"bulk write stall {ingestor.metrics.max_bulk_write_s:.2f}s")
        for name, p in (("first", first), ("second", second)):
            if p["live_samples"] == 0:
                failures.append(f"no live samples observed in {name} pass")
            elif p["live_p95_ms"] >= args.max_live_p95_ms:
                failures.append(f"live p95 {p['live_p95_ms']:.1f}ms >= {args.max_live_p95_ms}ms ({name})")
        report["failures"] = failures
        report["passed"] = not failures
        store.close()
        return report
    finally:
        if broker:
            broker.terminate()
        if mongo_client is not None:
            await mongo_client.drop_database(db_name)
            mongo_client.close()
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mongo-url", default=os.environ.get("MONGO_URL", "mongodb://localhost:27017"),
                    help="MongoDB URL, or 'mongomock' for an in-memory smoke run")
    ap.add_argument("--broker-url", default=None, help="existing broker (default: spawn local mosquitto)")
    ap.add_argument("--hours", type=float, default=4.0, help="blackout length (4h => 14,400 snapshots)")
    ap.add_argument("--live-hz", type=float, default=20.0)
    ap.add_argument("--batch-size", type=int, default=500)
    ap.add_argument("--max-inflight", type=int, default=8)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--min-throughput", type=float, default=1000.0)
    ap.add_argument("--max-live-p95-ms", type=float, default=250.0)
    ap.add_argument("--max-write-stall-s", type=float, default=1.0)
    ap.add_argument("--timeout", type=float, default=300.0)
    args = ap.parse_args()
    report = asyncio.run(run(args))
    print(json.dumps(report, indent=2, default=str))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
