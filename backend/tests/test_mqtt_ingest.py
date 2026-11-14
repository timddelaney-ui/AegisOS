"""Idempotent MQTT ingestion, live/historical routing, ack publishing and edge replay."""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

import pytest

pytest.importorskip("mongomock_motor")
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from services.mqtt_consumer import MqttSettings, TelemetryIngestor, parse_topic  # noqa: E402
from edge_gateway.replay import BatchReplayPublisher  # noqa: E402
from edge_gateway.store import EdgeStore  # noqa: E402

ORG, RIG = "acme", "rig1"
TOPIC = f"aegis/{ORG}/{RIG}/telemetry/snapshots"


def snap(i, hist, org=ORG):
    return {"id": f"s{i}", "org_id": org, "rig_id": RIG, "ts": f"2026-01-01T00:00:{i:02d}+00:00",
            "channels": {"encoder_1_depth_ft": float(i)}, "is_historical_sync": hist}


def batch(records, bid="b1"):
    return json.dumps({"batch_id": bid, "table": "telemetry_snapshots", "records": records}).encode()


async def make(**kw):
    db = AsyncMongoMockClient()["t"]
    acks, live = [], []

    async def ack(org, rig, payload):
        acks.append((org, rig, json.loads(payload)))

    async def sink(org, rig, table, docs):
        live.extend(docs)

    ing = TelemetryIngestor(db, live_sink=sink, ack_sink=ack, **kw)
    await ing.ensure_indexes()
    await ing.start()
    return db, ing, acks, live


def test_parse_topic():
    assert parse_topic(TOPIC) == (ORG, RIG, "telemetry_snapshots")
    assert parse_topic("aegis/a/b/telemetry/other") is None
    assert parse_topic("aegis/a/+/telemetry/events") is None
    assert parse_topic("other/a/b/telemetry/events") is None


def test_settings_validation():
    ok = MqttSettings(True, "mqtts://h:8883", "/ca", "/c", "/k")
    ok.validate()
    for bad in (MqttSettings(True, "", None, None, None),
                MqttSettings(True, "mqtts://h", None, None, None),
                MqttSettings(True, "mqtts://h", "/ca", "/c", None),
                MqttSettings(True, "http://h", "/ca", None, None)):
        with pytest.raises(ValueError):
            bad.validate()


@pytest.mark.asyncio
async def test_replay_is_idempotent_and_acked():
    db, ing, acks, live = await make()
    recs = [snap(i, 1) for i in range(5)]
    for bid in ("b1", "b2"):
        ing.submit(TOPIC, batch(recs, bid))
        await ing.drain()
    assert await db.telemetry_snapshots.count_documents({}) == 5
    assert [a[2]["accepted"] for a in acks] == [5, 0]
    assert acks[1][2]["duplicates"] == 5 and acks[0][0:2] == (ORG, RIG)
    assert not live  # historical records never hit the live path
    await ing.stop()


@pytest.mark.asyncio
async def test_live_routing_and_live_state_not_overwritten_by_older():
    db, ing, acks, live = await make()
    ing.submit(TOPIC, batch([snap(9, 0)], "l1"))
    await ing.drain()
    ing.submit(TOPIC, batch([snap(3, 0)], "l2"))
    await ing.drain()
    assert len(live) == 2
    state = await db.rig_live_state.find_one({"org_id": ORG, "rig_id": RIG})
    assert state["snapshot"]["encoder_1_depth_ft"] == 9.0
    await ing.stop()


@pytest.mark.asyncio
async def test_mixed_batch_acks_once_and_bad_records_rejected():
    db, ing, acks, live = await make()
    bad_tenant = snap(1, 0, org="evil")
    bad_channel = {**snap(2, 1), "channels": {"nope": 1.0}}
    ing.submit(TOPIC, batch([snap(0, 0), snap(3, 1), bad_tenant, bad_channel], "m1"))
    await ing.drain()
    assert len(acks) == 1
    ack = acks[0][2]
    assert ack["status"] == "ok" and ack["rejected_count"] == 2 and ack["accepted"] == 2
    assert await db.telemetry_snapshots.count_documents({"org_id": "evil"}) == 0
    await ing.stop()


@pytest.mark.asyncio
async def test_historical_queue_overflow_requests_retry():
    db, ing, acks, live = await make(historical_queue_size=1, historical_workers=0)
    for i in range(3):
        ing.submit(TOPIC, batch([snap(i, 1)], f"o{i}"))
    await asyncio.sleep(0.05)
    assert ing.metrics.queue_overflows == 2
    assert [a[2]["status"] for a in acks] == ["retry", "retry"]
    await ing.stop()


def test_edge_store_replay_marks_synced_only_after_ack(tmp_path):
    store = EdgeStore(str(tmp_path / "e.db"), ORG, RIG)
    store.record_snapshots([{"ts": f"2026-01-01T00:00:{i:02d}+00:00", "channels": {"a": 1}}
                            for i in range(3)], is_historical_sync=1)
    # same timestamps again => deterministic ids => no duplicates in the outbox
    assert store.record_snapshots([{"ts": "2026-01-01T00:00:00+00:00", "channels": {"a": 1}}], 1) == 0
    sent = []
    pub = BatchReplayPublisher(store, lambda t, p: sent.append((t, p)), batch_size=2)
    pub.pump(max_historical_batches=10)
    assert store.pending_counts()["telemetry_snapshots"] == 3
    first = json.loads(sent[0][1])
    pub.on_ack(json.dumps({"batch_id": first["batch_id"], "status": "retry"}).encode())
    assert store.pending_counts()["telemetry_snapshots"] == 3
    for _, payload in sent[1:]:
        pub.on_ack(json.dumps({"batch_id": json.loads(payload)["batch_id"], "status": "ok"}).encode())
    assert store.pending_counts()["telemetry_snapshots"] == 2
    store.close()
