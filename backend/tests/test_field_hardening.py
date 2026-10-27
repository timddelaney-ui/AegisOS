"""Offline-replay hardening: validation, idempotency, atomic fatigue, sandbox gating.

Runs in-process against an in-memory Mongo (mongomock-motor); no live backend needed.
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
from fastapi import APIRouter, FastAPI, Depends  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import phase1_modules as p1  # noqa: E402

USER = {"email": "t@example.com", "team_id": "team1", "role": "supervisor"}


@pytest.fixture()
def client():
    db = AsyncMongoMockClient()["t"]
    router = APIRouter(prefix="/api")

    async def require_user():
        return USER

    p1.register_phase1(router, db, require_user, require_user, lambda u: True)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


def _reel(client, sandbox=False, length=10000):
    r = client.post("/api/reels", json={
        "name": "R", "total_length_ft": length, "sandbox": sandbox,
        "intervals": [{"end_md_ft": length, "od_in": 2.0, "wt_in": 0.175}],
    })
    assert r.status_code == 200, r.text
    return r.json()["reel_id"]


def _feed(client, rid, **kw):
    body = {"reel_id": rid, "depth_ft": 2000, "traction_pressure_psi": 1200, "cycle_count": 1}
    body.update(kw)
    return client.post("/api/fatigue/feed", json=body)


def test_parse_event_at():
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)
    good = (now - timedelta(hours=2)).isoformat()
    assert p1.parse_event_at(good, now) == now - timedelta(hours=2)
    assert p1.parse_event_at("garbage", now) == now
    assert p1.parse_event_at((now + timedelta(hours=1)).isoformat(), now) == now
    assert p1.parse_event_at((now - timedelta(days=30)).isoformat(), now) == now
    assert p1.parse_event_at(None, now) == now


@pytest.mark.parametrize("bad", [
    {"cycle_count": 0}, {"cycle_count": -5}, {"depth_ft": -1}, {"traction_pressure_psi": -10},
    {"depth_ft": 1e9}, {"source": "bogus"},
])
def test_fatigue_rejects_invalid(client, bad):
    rid = _reel(client)
    assert _feed(client, rid, **bad).status_code == 422


def test_fatigue_depth_beyond_reel(client):
    rid = _reel(client, length=5000)
    assert _feed(client, rid, depth_ft=6000).status_code == 422


def test_fatigue_rejects_nan(client):
    rid = _reel(client)
    r = client.post("/api/fatigue/feed", content='{"reel_id":"%s","depth_ft":NaN,"traction_pressure_psi":1}' % rid,
                    headers={"content-type": "application/json"})
    # Rejected before any write (FastAPI may fail to echo NaN in the error body => 500, never 200).
    assert r.status_code in (422, 500)
    assert client.get("/api/fatigue/state", params={"reel_id": rid}).json()["worst_damage"] == 0.0


def test_simulated_blocked_on_real_reel_allowed_on_sandbox(client):
    real, sbx = _reel(client), _reel(client, sandbox=True)
    assert _feed(client, real, source="simulated").status_code == 400
    assert _feed(client, sbx, source="simulated").status_code == 200
    assert client.get("/api/fatigue/state", params={"reel_id": real}).json()["worst_damage"] == 0.0


def test_fatigue_idempotent_replay(client):
    rid = _reel(client)
    cid = uuid.uuid4().hex
    first = _feed(client, rid, client_id=cid).json()
    again = _feed(client, rid, client_id=cid).json()
    assert again.get("duplicate") is True
    assert again["worst_damage"] == pytest.approx(first["worst_damage"])
    third = _feed(client, rid, client_id=uuid.uuid4().hex).json()
    assert third["worst_damage"] > first["worst_damage"]


def test_fatigue_damage_accumulates_monotonically(client):
    rid = _reel(client)
    worst = 0.0
    for _ in range(5):
        w = _feed(client, rid).json()["worst_damage"]
        assert w > worst
        worst = w


def test_liveops_idempotent_and_event_at(client):
    cid = uuid.uuid4().hex
    ev = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    body = {"depth_ft": 15000, "weight_lb": 20000, "client_id": cid, "event_at": ev}
    assert client.post("/api/liveops/feed", json=body).status_code == 200
    assert client.post("/api/liveops/feed", json=body).json().get("duplicate") is True
    samples = client.get("/api/liveops/stream").json()["samples"]
    assert len(samples) == 1
    assert samples[0]["created_at"].startswith(ev[:16])


@pytest.mark.parametrize("bad", [{"depth_ft": -5}, {"pressure_psi": -1}, {"pressure_psi": 1e9}, {"fatigue_worst": 2}])
def test_liveops_rejects_invalid(client, bad):
    assert client.post("/api/liveops/feed", json=bad).status_code == 422


def test_liveops_simulated_on_real_reel_blocked(client):
    rid = _reel(client)
    r = client.post("/api/liveops/feed", json={"reel_id": rid, "source": "simulated", "depth_ft": 1})
    assert r.status_code == 400
