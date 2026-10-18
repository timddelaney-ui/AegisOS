"""Iteration 21 — Chat Notifications digest API tests.

Creates a 'second crew member' on the SAME team as demo.pro by inserting a
user + session directly into Mongo (public auth is Google OAuth). All test
data is cleaned up at the end.
"""
import os
import uuid
import time
import pytest
import requests
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
# Read backend .env directly to get Mongo URL (test runs on same host)
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
RIG2 = "RIG2"


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module")
def second_user(mongo):
    """Create a second user on the same team with their own session."""
    uid = f"notif_sender_{uuid.uuid4().hex[:8]}"
    email = f"{uid}@example.com"
    token = f"notif_sess_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    mongo.users.insert_one({
        "user_id": uid,
        "email": email,
        "name": "Second Crew Member",
        "picture": None,
        "team_id": TEAM_ID,
        "subscription_status": "active",
        "subscription_plan": "pro",
        "subscription_expires_at": now + timedelta(days=365),
        "trial_expires_at": now + timedelta(days=365),
        "created_at": now,
    })
    mongo.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": now + timedelta(days=1),
        "created_at": now,
    })
    yield {"user_id": uid, "email": email, "token": token}
    # Cleanup
    mongo.users.delete_many({"user_id": uid})
    mongo.user_sessions.delete_many({"user_id": uid})
    mongo.crew_messages.delete_many({"sender_user_id": uid})
    mongo.team_items.delete_many({"created_by": email})
    mongo.treatment_entries.delete_many({"author": email})


def _sess(token):
    s = requests.Session()
    s.cookies.set("session_token", token)
    return s


# ───────────────────────── Basic shape ─────────────────────────
def test_digest_shape_default_window():
    r = _sess(DEMO_TOKEN).get(f"{BASE_URL}/api/notifications/digest", params={"rig_id": RIG1})
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data.keys()) >= {"chat", "tasks", "treatment", "server_time"}
    for k in ("count", "has_alert", "latest"):
        assert k in data["chat"]
    for k in ("count", "latest"):
        assert k in data["tasks"]
    for k in ("count", "latest", "treatment_id", "treatment_name"):
        assert k in data["treatment"]


def test_digest_old_since_returns_zero():
    old = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    # Even with ancient `since`, nothing new should have happened in the last SECOND
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    r = _sess(DEMO_TOKEN).get(
        f"{BASE_URL}/api/notifications/digest",
        params={"rig_id": RIG1, "since": future},
    )
    assert r.status_code == 200
    d = r.json()
    assert d["chat"]["count"] == 0
    assert d["tasks"]["count"] == 0
    assert d["treatment"]["count"] == 0


# ───────────────────────── Chat (another user) ─────────────────────────
def test_chat_from_second_user_appears_in_demo_digest(second_user, mongo):
    since = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    # Post a chat message as second user on RIG1
    text = f"iter21-chat-{uuid.uuid4().hex[:6]}"
    r = _sess(second_user["token"]).post(
        f"{BASE_URL}/api/crew/chat", json={"text": text, "rig_id": RIG1}
    )
    assert r.status_code == 200, r.text
    time.sleep(1)
    d = _sess(DEMO_TOKEN).get(
        f"{BASE_URL}/api/notifications/digest",
        params={"rig_id": RIG1, "since": since},
    ).json()
    assert d["chat"]["count"] >= 1
    assert any(m.get("text") == text for m in d["chat"]["latest"])


def test_chat_alert_sets_has_alert(second_user, mongo):
    since = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    # No API for is_alert=True on crew/chat; insert directly
    mongo.crew_messages.insert_one({
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "team_id": TEAM_ID,
        "rig_id": RIG1,
        "sender_user_id": second_user["user_id"],
        "sender_name": "Second Crew Member",
        "sender_email": second_user["email"],
        "text": "SAFETY ALERT iter21",
        "is_alert": True,
        "is_skipper": False,
        "created_at": datetime.now(timezone.utc),
    })
    d = _sess(DEMO_TOKEN).get(
        f"{BASE_URL}/api/notifications/digest",
        params={"rig_id": RIG1, "since": since},
    ).json()
    assert d["chat"]["has_alert"] is True


def test_chat_on_rig2_NOT_included_for_rig1_query(second_user):
    since = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    text = f"iter21-rig2-{uuid.uuid4().hex[:6]}"
    r = _sess(second_user["token"]).post(
        f"{BASE_URL}/api/crew/chat", json={"text": text, "rig_id": RIG2}
    )
    assert r.status_code == 200
    time.sleep(1)
    d = _sess(DEMO_TOKEN).get(
        f"{BASE_URL}/api/notifications/digest",
        params={"rig_id": RIG1, "since": since},
    ).json()
    assert not any(m.get("text") == text for m in d["chat"]["latest"])


def test_self_messages_do_NOT_appear_in_own_digest(mongo):
    """CRITICAL: a user's own chat must never appear in their own digest."""
    since = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    text = f"iter21-self-{uuid.uuid4().hex[:6]}"
    r = _sess(DEMO_TOKEN).post(
        f"{BASE_URL}/api/crew/chat", json={"text": text, "rig_id": RIG1}
    )
    assert r.status_code == 200
    time.sleep(1)
    d = _sess(DEMO_TOKEN).get(
        f"{BASE_URL}/api/notifications/digest",
        params={"rig_id": RIG1, "since": since},
    ).json()
    found = any(m.get("text") == text for m in d["chat"]["latest"])
    # Cleanup our own injected message regardless of result
    mongo.crew_messages.delete_many({"text": text})
    assert not found, "User's own chat message leaked into their own digest (sender filter broken)"


# ───────────────────────── Tasks ─────────────────────────
def test_task_from_second_user_appears(second_user, mongo):
    since = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    name = f"iter21-task-{uuid.uuid4().hex[:6]}"
    r = _sess(second_user["token"]).post(
        f"{BASE_URL}/api/team/items",
        json={"kind": "todo", "name": name, "rig_id": RIG1},
    )
    assert r.status_code == 200, r.text
    item_id = r.json()["item_id"]
    time.sleep(1)
    d = _sess(DEMO_TOKEN).get(
        f"{BASE_URL}/api/notifications/digest",
        params={"rig_id": RIG1, "since": since},
    ).json()
    assert d["tasks"]["count"] >= 1
    assert any(t.get("name") == name for t in d["tasks"]["latest"])
    # Cleanup
    _sess(second_user["token"]).delete(f"{BASE_URL}/api/team/items/{item_id}")


# ───────────────────────── Treatment ─────────────────────────
def test_treatment_entry_from_second_user(second_user, mongo):
    # Need an active treatment on RIG1 for team
    trt = mongo.treatments.find_one({"team_id": TEAM_ID, "rig_id": RIG1, "status": "active"})
    created_locally = False
    if not trt:
        trt = {
            "treatment_id": f"trt_{uuid.uuid4().hex[:12]}",
            "team_id": TEAM_ID,
            "rig_id": RIG1,
            "name": "Iter21 Test Treatment",
            "status": "active",
            "created_at": datetime.now(timezone.utc),
        }
        mongo.treatments.insert_one(trt)
        created_locally = True
    since = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    entry_text = f"iter21-trt-{uuid.uuid4().hex[:6]}"
    mongo.treatment_entries.insert_one({
        "entry_id": f"ent_{uuid.uuid4().hex[:12]}",
        "team_id": TEAM_ID,
        "treatment_id": trt["treatment_id"],
        "author": second_user["email"],
        "author_name": "Second Crew Member",
        "text": entry_text,
        "created_at": datetime.now(timezone.utc),
    })
    d = _sess(DEMO_TOKEN).get(
        f"{BASE_URL}/api/notifications/digest",
        params={"rig_id": RIG1, "since": since},
    ).json()
    assert d["treatment"]["count"] >= 1
    assert d["treatment"]["treatment_id"] == trt["treatment_id"]
    assert d["treatment"]["treatment_name"] == trt["name"]
    # Cleanup
    mongo.treatment_entries.delete_many({"text": entry_text})
    if created_locally:
        mongo.treatments.delete_many({"treatment_id": trt["treatment_id"]})
