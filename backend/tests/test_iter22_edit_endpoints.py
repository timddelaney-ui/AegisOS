"""Iteration 22 — Edit endpoints: TeamItems PATCH, Equipment PATCH, Treatment entry PATCH/DELETE with author/admin authorization."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone
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

DEMO_TOKEN = os.environ.get("DEMO_SESSION_TOKEN", "demo_session_dade4ac57f0c496094fde437e8e91f00")
DEMO_EMAIL = "demo.pro@example.com"
TEAM_ID = "team_9af2d0d38747"
RIG1 = "RIG1"


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def second_user(mongo):
    uid = f"iter22_u_{uuid.uuid4().hex[:8]}"
    email = f"{uid}@example.com"
    token = f"iter22_sess_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    mongo.users.insert_one({
        "user_id": uid, "email": email, "name": "Iter22 Second",
        "team_id": TEAM_ID, "subscription_status": "active",
        "subscription_expires_at": now + timedelta(days=365),
        "trial_expires_at": now + timedelta(days=365),
        "created_at": now,
    })
    mongo.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": now + timedelta(days=1), "created_at": now,
    })
    yield {"user_id": uid, "email": email, "token": token}
    mongo.users.delete_many({"user_id": uid})
    mongo.user_sessions.delete_many({"user_id": uid})
    mongo.crew_messages.delete_many({"sender_user_id": uid})
    mongo.treatment_entries.delete_many({"author": email})
    mongo.team_items.delete_many({"created_by": email})


def _sess(token):
    s = requests.Session()
    s.cookies.set("session_token", token)
    return s


# ─────────── Team Items PATCH (inventory edit flow) ───────────
@pytest.mark.parametrize("kind", ["inventory", "consumables", "parts_order", "todo"])
def test_team_item_edit_persists(kind, mongo):
    s = _sess(DEMO_TOKEN)
    name0 = f"TEST_iter22_{kind}_{uuid.uuid4().hex[:6]}"
    payload = {"kind": kind, "name": name0, "rig_id": RIG1}
    if kind != "todo":
        payload["quantity"] = 5
        payload["unit"] = "ea"
    r = s.post(f"{BASE_URL}/api/team/items", json=payload)
    assert r.status_code == 200, r.text
    item_id = r.json()["item_id"]
    try:
        new_name = name0 + "_edited"
        patch_body = {"name": new_name, "location": "Shelf B", "note": "updated by test"}
        if kind != "todo":
            patch_body["quantity"] = 12
        pr = s.patch(f"{BASE_URL}/api/team/items/{item_id}", json=patch_body)
        assert pr.status_code == 200, pr.text
        upd = pr.json()
        assert upd["name"] == new_name
        assert upd["location"] == "Shelf B"
        assert upd["note"] == "updated by test"
        if kind != "todo":
            assert upd["quantity"] == 12
        # GET verifies persistence
        g = s.get(f"{BASE_URL}/api/team/items/{kind}", params={"rig_id": RIG1}).json()
        got = next((i for i in g["items"] if i["item_id"] == item_id), None)
        assert got and got["name"] == new_name
    finally:
        s.delete(f"{BASE_URL}/api/team/items/{item_id}")


def test_team_item_quantity_stepper_patch():
    """Simulates the +/- stepper by sending quantity updates."""
    s = _sess(DEMO_TOKEN)
    r = s.post(f"{BASE_URL}/api/team/items", json={
        "kind": "inventory", "name": f"TEST_stepper_{uuid.uuid4().hex[:6]}",
        "rig_id": RIG1, "quantity": 3,
    })
    item_id = r.json()["item_id"]
    try:
        # +1
        pr = s.patch(f"{BASE_URL}/api/team/items/{item_id}", json={"quantity": 4})
        assert pr.status_code == 200
        assert pr.json()["quantity"] == 4
        # -1 clamped to 0
        pr = s.patch(f"{BASE_URL}/api/team/items/{item_id}", json={"quantity": 0})
        assert pr.status_code == 200
        assert pr.json()["quantity"] == 0
    finally:
        s.delete(f"{BASE_URL}/api/team/items/{item_id}")


# ─────────── Equipment PATCH ───────────
def test_equipment_edit_persists(mongo):
    s = _sess(DEMO_TOKEN)
    r = s.post(f"{BASE_URL}/api/equipment", json={
        "kind": "engine",
        "name": f"TEST_iter22_engine_{uuid.uuid4().hex[:6]}",
        "serial_number": "SN-ORIG",
        "rig_id": RIG1,
        "current_hours": 100,
        "service_interval_hours": 250,
    })
    assert r.status_code == 200, r.text
    item_id = r.json()["item_id"]
    try:
        pr = s.patch(f"{BASE_URL}/api/equipment/{item_id}", json={
            "name": "TEST_iter22_engine_EDITED",
            "serial_number": "SN-NEW",
            "service_interval_hours": 500,
            "note": "edited by iter22",
        })
        assert pr.status_code == 200, pr.text
        upd = pr.json()
        assert upd["name"] == "TEST_iter22_engine_EDITED"
        assert upd["serial_number"] == "SN-NEW"
        assert upd["service_interval_hours"] == 500
        # GET list verifies persistence
        g = s.get(f"{BASE_URL}/api/equipment", params={"kind": "engine", "rig_id": RIG1})
        assert g.status_code == 200
        got = next((i for i in g.json()["items"] if i["item_id"] == item_id), None)
        assert got and got["service_interval_hours"] == 500
    finally:
        s.delete(f"{BASE_URL}/api/equipment/{item_id}")


# ─────────── Treatment entry PATCH / DELETE ───────────
@pytest.fixture(scope="module")
def treatment(mongo):
    """Ensure there's an active treatment on RIG1 to work with."""
    s = _sess(DEMO_TOKEN)
    r = s.post(f"{BASE_URL}/api/treatments", json={
        "rig_id": RIG1, "name": f"TEST_iter22_trt_{uuid.uuid4().hex[:6]}",
    })
    assert r.status_code == 200, r.text
    trt_id = r.json()["treatment_id"]
    yield trt_id
    # Cleanup: close & remove
    mongo.treatments.delete_many({"treatment_id": trt_id})
    mongo.treatment_entries.delete_many({"treatment_id": trt_id})


def test_treatment_entry_edit_by_author(treatment):
    s = _sess(DEMO_TOKEN)
    r = s.post(f"{BASE_URL}/api/treatments/{treatment}/entries", json={
        "text": "Original pumping at 1 bpm",
    })
    assert r.status_code == 200, r.text
    entry_id = r.json()["entry_id"]
    # Edit
    pr = s.patch(f"{BASE_URL}/api/treatments/{treatment}/entries/{entry_id}",
                 json={"text": "Edited — pumping at 1.5 bpm"})
    assert pr.status_code == 200, pr.text
    upd = pr.json()
    assert upd["text"] == "Edited — pumping at 1.5 bpm"
    assert upd.get("edited_at") is not None
    assert upd.get("edited_by") == DEMO_EMAIL


def test_treatment_entry_edit_forbidden_for_non_author(treatment, second_user):
    # Demo creates
    s_a = _sess(DEMO_TOKEN)
    r = s_a.post(f"{BASE_URL}/api/treatments/{treatment}/entries",
                 json={"text": "demo-authored entry"})
    entry_id = r.json()["entry_id"]
    # Second user tries to edit
    s_b = _sess(second_user["token"])
    pr = s_b.patch(f"{BASE_URL}/api/treatments/{treatment}/entries/{entry_id}",
                   json={"text": "hacker edit"})
    assert pr.status_code == 403
    # Second user tries to delete
    dr = s_b.delete(f"{BASE_URL}/api/treatments/{treatment}/entries/{entry_id}")
    assert dr.status_code == 403


def test_treatment_entry_delete_decrements_count(treatment, mongo):
    s = _sess(DEMO_TOKEN)
    # Grab initial count
    trt_before = mongo.treatments.find_one({"treatment_id": treatment})
    count_before = trt_before.get("entry_count", 0)
    r = s.post(f"{BASE_URL}/api/treatments/{treatment}/entries",
               json={"text": "to be deleted"})
    entry_id = r.json()["entry_id"]
    trt_mid = mongo.treatments.find_one({"treatment_id": treatment})
    assert trt_mid.get("entry_count", 0) == count_before + 1
    dr = s.delete(f"{BASE_URL}/api/treatments/{treatment}/entries/{entry_id}")
    assert dr.status_code == 200
    assert dr.json().get("success") is True
    trt_after = mongo.treatments.find_one({"treatment_id": treatment})
    assert trt_after.get("entry_count", 0) == count_before
    # GET list no longer contains entry
    g = s.get(f"{BASE_URL}/api/treatments/{treatment}/entries").json()
    assert not any(e["entry_id"] == entry_id for e in g["entries"])


def test_treatment_entry_edit_empty_text_rejected(treatment):
    s = _sess(DEMO_TOKEN)
    r = s.post(f"{BASE_URL}/api/treatments/{treatment}/entries",
               json={"text": "non-empty"})
    entry_id = r.json()["entry_id"]
    pr = s.patch(f"{BASE_URL}/api/treatments/{treatment}/entries/{entry_id}",
                 json={"text": "   "})
    assert pr.status_code == 400
