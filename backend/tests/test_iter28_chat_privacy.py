"""Iter 28 — crew chat is now private: NOT in handover summary nor shift-end body."""
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


@pytest.fixture
def hdr():
    return {"Cookie": f"session_token={DEMO_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL); yield c[DB_NAME]; c.close()


def _seed_chat(mongo):
    """Drop a unique crew_messages row so we can prove it's NOT exposed."""
    secret = f"PRIVATE_CHAT_{uuid.uuid4().hex[:8]}"
    mongo.crew_messages.insert_one({
        "message_id": f"m_{uuid.uuid4().hex[:10]}",
        "team_id": TEAM_ID,
        "rig_id": "RIG1",
        "sender_email": "demo.pro@example.com",
        "sender_name": "Demo Pro",
        "text": secret,
        "created_at": datetime.now(timezone.utc),
    })
    return secret


def test_handover_summary_omits_chat(hdr, mongo):
    secret = _seed_chat(mongo)
    try:
        r = requests.get(f"{BASE_URL}/api/crew/handover-summary",
                         params={"rig_id": "RIG1", "hours": 12},
                         headers=hdr)
        assert r.status_code == 200
        d = r.json()
        # chat_notes field is kept for backward-compat but must be empty
        assert d.get("chat_notes") == []
        # The seeded secret must not appear anywhere in the payload
        assert secret not in r.text
    finally:
        mongo.crew_messages.delete_many({"text": secret})


def test_shift_end_preview_omits_chat(hdr, mongo):
    secret = _seed_chat(mongo)
    try:
        r = requests.post(f"{BASE_URL}/api/crew/shift-end-preview",
                          headers=hdr, json={"rig_id": "RIG1", "hours": 12})
        assert r.status_code == 200
        body = r.json().get("body_text", "")
        assert "CREW CHAT" not in body
        assert secret not in body
    finally:
        mongo.crew_messages.delete_many({"text": secret})


def test_shift_end_body_has_tx_and_todos_but_no_chat(hdr, mongo):
    secret = _seed_chat(mongo)
    try:
        r = requests.post(f"{BASE_URL}/api/crew/shift-end-preview",
                          headers=hdr, json={"rig_id": "RIG1", "hours": 12})
        body = r.json()["body_text"]
        assert "TREATMENT / OPERATIONS LOG" in body
        assert "OPEN TO-DOS" in body
        assert "— End of handover —" in body
        assert "CREW CHAT" not in body
        assert "CHAT NOTES" not in body
    finally:
        mongo.crew_messages.delete_many({"text": secret})
