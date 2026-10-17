"""Iteration 24 — CT Drilling Scenarios CRUD endpoints + authorization."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
_env = {}
with open("/app/backend/.env") as fh:
    for line in fh:
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.strip().partition("=")
            _env[k] = v.strip().strip('"').strip("'")
MONGO_URL = _env.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = _env.get("DB_NAME", "test_database")

DEMO_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"
TEAM_ID = "team_9af2d0d38747"


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture
def auth_headers():
    return {"Cookie": f"session_token={DEMO_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture
def second_user(mongo):
    """A user NOT on the demo team — used to verify team visibility & auth."""
    uid = f"iter24_u_{uuid.uuid4().hex[:8]}"
    email = f"{uid}@example.com"
    token = f"iter24_sess_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": uid, "email": email, "name": "Iter24 Outsider",
        "team_id": None, "subscription_status": "active",
        "created_at": datetime.now(timezone.utc),
    })
    mongo.user_sessions.insert_one({
        "session_token": token, "user_id": uid, "email": email,
        "expires_at": datetime.now(timezone.utc).replace(year=2099),
    })
    yield {"uid": uid, "email": email, "token": token,
           "headers": {"Cookie": f"session_token={token}", "Content-Type": "application/json"}}
    mongo.users.delete_one({"user_id": uid})
    mongo.user_sessions.delete_one({"session_token": token})
    mongo.ctd_scenarios.delete_many({"user_id": uid})


def test_create_scenario_requires_well_name(auth_headers):
    r = requests.post(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers,
                      json={"well_name": "   "})
    assert r.status_code == 400


def test_create_list_get_scenario(auth_headers, mongo):
    body = {
        "well_name": "iter24-test-well",
        "mode": "underbalanced",
        "unit_system": "imp",
        "values": {"tvd": "5000", "q_bpm": "1.5", "q_N2_scfm": "900"},
        "note": "pytest",
    }
    r = requests.post(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers, json=body)
    assert r.status_code == 200, r.text
    sid = r.json()["scenario_id"]
    try:
        assert r.json()["well_name"] == "iter24-test-well"
        assert r.json()["mode"] == "underbalanced"
        assert r.json()["visibility"] == "private"

        # list contains it
        r2 = requests.get(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers)
        assert r2.status_code == 200
        assert any(s["scenario_id"] == sid for s in r2.json())

        # get single
        r3 = requests.get(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)
        assert r3.status_code == 200
        assert r3.json()["values"]["q_N2_scfm"] == "900"
    finally:
        requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)


def test_update_scenario(auth_headers):
    r = requests.post(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers,
                      json={"well_name": "iter24-upd", "mode": "balanced", "values": {}})
    sid = r.json()["scenario_id"]
    try:
        r2 = requests.patch(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers,
                            json={"note": "patched", "mode": "underbalanced"})
        assert r2.status_code == 200
        assert r2.json()["note"] == "patched"
        assert r2.json()["mode"] == "underbalanced"
    finally:
        requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)


def test_delete_scenario(auth_headers):
    r = requests.post(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers,
                      json={"well_name": "iter24-del", "mode": "balanced", "values": {}})
    sid = r.json()["scenario_id"]
    r2 = requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)
    assert r2.status_code == 200
    # second delete should 404
    r3 = requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)
    assert r3.status_code == 404


def test_outsider_cannot_see_private_scenario(auth_headers, second_user):
    r = requests.post(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers,
                      json={"well_name": "iter24-priv", "mode": "balanced",
                            "values": {}, "visibility": "private"})
    sid = r.json()["scenario_id"]
    try:
        r2 = requests.get(f"{BASE_URL}/api/ctd-scenarios/{sid}",
                          headers=second_user["headers"])
        assert r2.status_code == 403
        # List doesn't include it either
        r3 = requests.get(f"{BASE_URL}/api/ctd-scenarios", headers=second_user["headers"])
        assert all(s["scenario_id"] != sid for s in r3.json())
    finally:
        requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)


def test_outsider_cannot_update_or_delete(auth_headers, second_user):
    r = requests.post(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers,
                      json={"well_name": "iter24-foreign", "mode": "balanced", "values": {}})
    sid = r.json()["scenario_id"]
    try:
        r2 = requests.patch(f"{BASE_URL}/api/ctd-scenarios/{sid}",
                            headers=second_user["headers"], json={"note": "hacked"})
        assert r2.status_code in (403, 404)
        r3 = requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}",
                             headers=second_user["headers"])
        assert r3.status_code in (403, 404)
    finally:
        requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)


def test_team_visible_scenario_is_shared(mongo, auth_headers):
    """Teammate of the demo team should see team-visible scenarios."""
    # Create a second user on the SAME team as demo (TEAM_ID)
    uid = f"iter24_t_{uuid.uuid4().hex[:8]}"
    email = f"{uid}@example.com"
    token = f"iter24_tsess_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": uid, "email": email, "name": "Iter24 Teammate",
        "team_id": TEAM_ID, "subscription_status": "active",
        "created_at": datetime.now(timezone.utc),
    })
    mongo.user_sessions.insert_one({
        "session_token": token, "user_id": uid, "email": email,
        "expires_at": datetime.now(timezone.utc).replace(year=2099),
    })
    team_headers = {"Cookie": f"session_token={token}", "Content-Type": "application/json"}
    r = requests.post(f"{BASE_URL}/api/ctd-scenarios", headers=auth_headers,
                      json={"well_name": "iter24-team", "mode": "balanced",
                            "values": {}, "visibility": "team"})
    sid = r.json()["scenario_id"]
    try:
        assert r.status_code == 200
        r2 = requests.get(f"{BASE_URL}/api/ctd-scenarios", headers=team_headers)
        assert any(s["scenario_id"] == sid for s in r2.json())
    finally:
        requests.delete(f"{BASE_URL}/api/ctd-scenarios/{sid}", headers=auth_headers)
        mongo.users.delete_one({"user_id": uid})
        mongo.user_sessions.delete_one({"session_token": token})


def test_unauth_rejected():
    r = requests.get(f"{BASE_URL}/api/ctd-scenarios")
    assert r.status_code == 401
