"""Iter 29 — treatment entries accept custom event_at (backdating)."""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
DEMO_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture
def hdr():
    return {"Cookie": f"session_token={DEMO_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture
def treatment(hdr):
    r = requests.post(f"{BASE_URL}/api/treatments", headers=hdr, json={
        "rig_id": "RIG1", "name": "iter29 event_at test",
    })
    assert r.status_code == 200
    tid = r.json()["treatment_id"]
    yield tid
    requests.delete(f"{BASE_URL}/api/treatments/{tid}", headers=hdr)


def test_event_at_defaults_to_created(hdr, treatment):
    r = requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                      json={"text": "live note"})
    assert r.status_code == 200
    d = r.json()
    assert d["event_at"] is not None
    def _dt(s):
        x = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return x.replace(tzinfo=timezone.utc) if x.tzinfo is None else x
    ea = _dt(d["event_at"])
    ca = _dt(d["created_at"])
    assert abs((ea - ca).total_seconds()) < 2


def test_event_at_backdating_accepted(hdr, treatment):
    past = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    r = requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                      json={"text": "backdated 3h", "event_at": past})
    assert r.status_code == 200
    d = r.json()
    assert d["event_at"] is not None
    def _dt(s):
        x = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return x.replace(tzinfo=timezone.utc) if x.tzinfo is None else x
    ea = _dt(d["event_at"])
    assert (datetime.now(timezone.utc) - ea).total_seconds() > 60 * 60 * 2


def test_event_at_future_rejected(hdr, treatment):
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    r = requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                      json={"text": "future", "event_at": future})
    assert r.status_code == 400
    assert "future" in r.json()["detail"].lower()


def test_event_at_too_old_rejected(hdr, treatment):
    old = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    r = requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                      json={"text": "ancient", "event_at": old})
    assert r.status_code == 400


def test_event_at_invalid_string_rejected(hdr, treatment):
    r = requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                      json={"text": "bad", "event_at": "garbage"})
    assert r.status_code == 400


def test_patch_event_at_retroactively(hdr, treatment):
    # Create at "now" then shift to 2h ago via patch
    r = requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                      json={"text": "to be shifted"})
    eid = r.json()["entry_id"]
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    r2 = requests.patch(f"{BASE_URL}/api/treatments/{treatment}/entries/{eid}", headers=hdr,
                        json={"event_at": past})
    assert r2.status_code == 200
    d = r2.json()
    ea = datetime.fromisoformat(d["event_at"].replace("Z", "+00:00"))
    if ea.tzinfo is None:
        ea = ea.replace(tzinfo=timezone.utc)
    assert (datetime.now(timezone.utc) - ea).total_seconds() > 60 * 60


def test_patch_text_only_still_works(hdr, treatment):
    r = requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                      json={"text": "original"})
    eid = r.json()["entry_id"]
    original_event_at = r.json()["event_at"]
    r2 = requests.patch(f"{BASE_URL}/api/treatments/{treatment}/entries/{eid}", headers=hdr,
                        json={"text": "edited"})
    assert r2.status_code == 200
    d = r2.json()
    assert d["text"] == "edited"
    # event_at unchanged — compare as datetimes (Mongo may drop tz suffix on roundtrip)
    def _dt(s):
        x = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return x.replace(tzinfo=timezone.utc) if x.tzinfo is None else x
    assert abs((_dt(d["event_at"]) - _dt(original_event_at)).total_seconds()) < 1


def test_list_sorted_by_event_at(hdr, treatment):
    # Add entries OUT of chronological order; expect list sorted ascending by event_at
    now = datetime.now(timezone.utc)
    requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                  json={"text": "latest live"})
    requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                  json={"text": "earlier backdated",
                        "event_at": (now - timedelta(hours=4)).isoformat()})
    requests.post(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr,
                  json={"text": "middle backdated",
                        "event_at": (now - timedelta(hours=2)).isoformat()})
    r = requests.get(f"{BASE_URL}/api/treatments/{treatment}/entries", headers=hdr)
    assert r.status_code == 200
    entries = r.json()["entries"]
    def _dt(s):
        x = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return x.replace(tzinfo=timezone.utc) if x.tzinfo is None else x
    event_times = [_dt(e["event_at"]) for e in entries]
    assert event_times == sorted(event_times), "entries must be chronological by event_at"
