"""Iter 18: Crew Builder + schedule regression."""
import os
import time
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as f:
        for l in f:
            if l.startswith("REACT_APP_BACKEND_URL="):
                BASE = l.split("=", 1)[1].strip().rstrip("/")

COOKIE = {"session_token": "demo_session_dade4ac57f0c496094fde437e8e91f00"}
RIG = "RIG1"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.cookies.update(COOKIE)
    return sess


def _cleanup_test_crews(s):
    r = s.get(f"{BASE}/api/crews", params={"rig_id": RIG})
    for c in r.json().get("crews", []):
        if c["name"].startswith("TEST_"):
            s.delete(f"{BASE}/api/crews/{c['crew_id']}")


@pytest.fixture(scope="module", autouse=True)
def cleanup(s):
    _cleanup_test_crews(s)
    yield
    _cleanup_test_crews(s)


# ---------- Auth sanity ----------
def test_auth_me(s):
    r = s.get(f"{BASE}/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "demo.pro@example.com"


# ---------- POST /api/crews create+opposite ----------
def test_create_crew_with_opposite(s):
    payload = {
        "rig_id": RIG,
        "name": "TEST_CrewA",
        "tour": "day",
        "pattern": "14/14",
        "start_date": "2026-02-01",
        "repeat_cycles": 3,
        "members": [
            {"name": "TEST_Alice", "role": "Supervisor"},
            {"name": "TEST_Bob", "role": "Operator"},
        ],
        "auto_create_opposite": True,
    }
    r = s.post(f"{BASE}/api/crews", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["crews"]) == 2
    assert data["shifts_generated"] == 2 * 3  # 2 members × 3 cycles
    a, b = data["crews"]
    assert a["tour"] == "day" and b["tour"] == "night"
    assert a["paired_crew_id"] == b["crew_id"]
    assert b["paired_crew_id"] == a["crew_id"]
    assert b["members"] == []
    # Persist for later tests
    pytest.crew_a_id = a["crew_id"]
    pytest.crew_b_id = b["crew_id"]


def test_list_crews_returns_created(s):
    r = s.get(f"{BASE}/api/crews", params={"rig_id": RIG})
    assert r.status_code == 200
    ids = [c["crew_id"] for c in r.json()["crews"]]
    assert pytest.crew_a_id in ids
    assert pytest.crew_b_id in ids


def test_patch_crew_rebuilds_shifts(s):
    new_members = [
        {"name": "TEST_Alice", "role": "Supervisor"},
        {"name": "TEST_Bob", "role": "Operator"},
        {"name": "TEST_Carol", "role": "Crane Op"},
    ]
    r = s.patch(f"{BASE}/api/crews/{pytest.crew_a_id}", json={"members": new_members})
    assert r.status_code == 200, r.text
    # GET schedule scoped to crew - use list endpoint then filter
    sched = s.get(f"{BASE}/api/schedule", params={"rig_id": RIG}).json()["shifts"]
    crew_shifts = [x for x in sched if x.get("crew_id") == pytest.crew_a_id]
    # 3 members × 3 cycles = 9
    assert len(crew_shifts) == 9, f"got {len(crew_shifts)}"


def test_patch_crew_rejects_one_off(s):
    r = s.patch(f"{BASE}/api/crews/{pytest.crew_a_id}", json={"pattern": "one_off"})
    assert r.status_code == 400


def test_patch_crew_custom_requires_rotation(s):
    # Create a fresh 20/10 crew, then try to switch to custom without providing
    # new rotation values — backend merges old ones so this actually passes.
    # This test documents backend behaviour: rotation days are inherited on merge.
    r = s.patch(
        f"{BASE}/api/crews/{pytest.crew_a_id}",
        json={"pattern": "custom", "rotation_days_on": 0, "rotation_days_off": 0},
    )
    # 0/0 → treated as falsy → should reject
    assert r.status_code == 400, f"expected 400 for zero rotation, got {r.status_code}: {r.text}"


def test_create_crew_empty_members_rejected(s):
    r = s.post(f"{BASE}/api/crews", json={
        "rig_id": RIG, "name": "TEST_Empty", "tour": "day",
        "pattern": "14/14", "start_date": "2026-02-01", "members": [],
    })
    assert r.status_code == 400
    assert "member" in r.json()["detail"].lower()


def test_create_crew_rejects_one_off(s):
    r = s.post(f"{BASE}/api/crews", json={
        "rig_id": RIG, "name": "TEST_OneOff", "tour": "day",
        "pattern": "one_off", "start_date": "2026-02-01",
        "members": [{"name": "TEST_X", "role": "Operator"}],
    })
    assert r.status_code == 400


def test_delete_crew_unpairs_partner_and_drops_shifts(s):
    # Delete crew A; verify shifts gone; verify partner un-paired
    r = s.delete(f"{BASE}/api/crews/{pytest.crew_a_id}")
    assert r.status_code == 200
    sched = s.get(f"{BASE}/api/schedule", params={"rig_id": RIG}).json()["shifts"]
    assert not any(x.get("crew_id") == pytest.crew_a_id for x in sched)
    crews = s.get(f"{BASE}/api/crews", params={"rig_id": RIG}).json()["crews"]
    partner = next((c for c in crews if c["crew_id"] == pytest.crew_b_id), None)
    assert partner is not None
    assert partner["paired_crew_id"] is None
    # cleanup B
    s.delete(f"{BASE}/api/crews/{pytest.crew_b_id}")


# ---------- Legacy /api/schedule regression ----------
@pytest.mark.parametrize("pattern", ["one_off", "14/14", "20/10", "7/7"])
def test_legacy_single_shift(s, pattern):
    payload = {
        "rig_id": RIG,
        "crew_member_name": f"TEST_Single_{pattern.replace('/', '_')}",
        "role": "Operator", "tour": "day",
        "pattern": pattern, "start_date": "2026-02-10",
        "repeat_cycles": 2,
    }
    if pattern == "one_off":
        payload["end_date"] = "2026-02-12"
    r = s.post(f"{BASE}/api/schedule", json=payload)
    assert r.status_code == 200, r.text
    shifts = r.json()["shifts"]
    assert len(shifts) >= 1
    # cleanup
    for sh in shifts:
        s.delete(f"{BASE}/api/schedule/{sh['shift_id']}")


def test_legacy_custom_pattern(s):
    payload = {
        "rig_id": RIG,
        "crew_member_name": "TEST_Custom",
        "role": "Operator", "tour": "night",
        "pattern": "custom", "start_date": "2026-03-01",
        "rotation_days_on": 10, "rotation_days_off": 5, "repeat_cycles": 2,
    }
    r = s.post(f"{BASE}/api/schedule", json=payload)
    assert r.status_code == 200
    shifts = r.json()["shifts"]
    assert len(shifts) == 2
    for sh in shifts:
        s.delete(f"{BASE}/api/schedule/{sh['shift_id']}")
