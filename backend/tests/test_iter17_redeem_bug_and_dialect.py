"""
Iter 17 — redeem bug verification + Cape Breton dialect removal.

Covers:
- Redeem success on a freshly-minted disposable code (mint via admin API).
- Redeem invalid code returns 'Invalid code'.
- Redeem already-used code returns 'already'.
- Whitespace-tolerant redeem (leading/trailing spaces stripped by backend).
- Cape Breton dialect substring purge in /api/ai/chat responses.
- Regression: 20 CT- + 3 OM- production codes untouched (0/1 uses, is_active).
"""
import os
import re
import time
import uuid
import secrets
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"
DEMO_TOKEN = os.environ.get("DEMO_SESSION_TOKEN", "demo_session_dade4ac57f0c496094fde437e8e91f00")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

PROD_CT_CODES = [
    "CT-5EWU-CQ8S", "CT-ML3V-EQMJ", "CT-7FH3-8BMC", "CT-P8FN-VRP6", "CT-2H32-HUCR",
    "CT-2VZ8-E2U2", "CT-TTL9-6W9Q", "CT-M8X2-L4S3", "CT-DWM5-AZ9H", "CT-3QSQ-M2LU",
    "CT-ADYD-L7JX", "CT-YRN5-DCBA", "CT-R5WD-KS3F", "CT-GPV4-7VR7", "CT-NJX9-EUXA",
    "CT-CHZW-ALD5", "CT-96B7-A4E4", "CT-G7EB-V4BP", "CT-QXVG-TLLK", "CT-YTLQ-MP48",
]
PROD_OM_CODES = ["OM-NRLB-B8H4", "OM-TSLS-BLMC", "OM-5D33-AJAN"]

DIALECT_SUBSTRINGS = ["b'y", "me son", "Cape Breton", "Caper",
                     "Lord thunderin", "oh me nerves", "she's a goer"]


# -------- fixtures --------

@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.cookies.set("session_token", DEMO_TOKEN)
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 200, f"Demo admin session broken: {r.status_code} {r.text}"
    return s


def _mint_throwaway_user(mongo, role="crew"):
    uid = f"iter17_u_{uuid.uuid4().hex[:10]}"
    email = f"iter17_{uid}@test.local"
    token = f"iter17_sess_{secrets.token_hex(12)}"
    now = datetime.now(timezone.utc)
    mongo.users.insert_one({
        "user_id": uid,
        "email": email,
        "name": "Iter17 Throwaway",
        "role": role,
        "subscription_status": "inactive",
        "created_at": now,
    })
    mongo.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "expires_at": now + timedelta(days=1),
        "created_at": now,
    })
    return {"user_id": uid, "email": email, "token": token}


@pytest.fixture
def throwaway_user_factory(mongo):
    created = []

    def _make(role="crew"):
        u = _mint_throwaway_user(mongo, role=role)
        created.append(u)
        return u

    yield _make

    # cleanup
    for u in created:
        mongo.user_sessions.delete_many({"user_id": u["user_id"]})
        mongo.users.delete_many({"user_id": u["user_id"]})
        mongo.feedback.delete_many({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def minted_codes(admin_session, mongo):
    """Track codes we mint so we can clean them up at end."""
    codes = []
    yield codes
    if codes:
        mongo.invite_codes.delete_many({"code": {"$in": codes}})


def _mint_invite(admin_session, minted_codes, grant_days=7, max_uses=1, grant_role=None, note="iter17_bug_verify"):
    body = {"grant_days": grant_days, "max_uses": max_uses, "note": note}
    if grant_role:
        body["grant_role"] = grant_role
    r = admin_session.post(f"{API}/admin/invites", json=body)
    assert r.status_code == 200, f"mint failed: {r.status_code} {r.text}"
    code = r.json()["code"]
    minted_codes.append(code)
    return code


def _user_session(token):
    s = requests.Session()
    s.cookies.set("session_token", token)
    return s


# -------- tests --------

class TestRedeemFlow:
    def test_redeem_success_fresh_code(self, admin_session, throwaway_user_factory, minted_codes, mongo):
        code = _mint_invite(admin_session, minted_codes, grant_days=7)
        u = throwaway_user_factory()
        us = _user_session(u["token"])

        r = us.post(f"{API}/invites/redeem", json={"code": code})
        assert r.status_code == 200, f"redeem failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["success"] is True
        assert data["grant_days"] == 7
        assert "Pro unlocked" in data["message"]

        # verify /api/auth/me now shows active
        me = us.get(f"{API}/auth/me").json()
        assert me["subscription_status"] == "active"

        # verify code use_count == 1
        doc = mongo.invite_codes.find_one({"code": code})
        assert doc["use_count"] == 1

    def test_redeem_invalid_code_returns_invalid_code(self, throwaway_user_factory):
        u = throwaway_user_factory()
        us = _user_session(u["token"])
        r = us.post(f"{API}/invites/redeem", json={"code": "CT-FAKE-XXXX"})
        assert r.status_code == 404
        detail = r.json().get("detail", "")
        assert "Invalid code" in detail, f"Expected 'Invalid code' in detail, got: {detail!r}"

    def test_redeem_already_used_code(self, admin_session, throwaway_user_factory, minted_codes):
        code = _mint_invite(admin_session, minted_codes, grant_days=7, max_uses=1)
        u1 = throwaway_user_factory()
        u2 = throwaway_user_factory()

        r1 = _user_session(u1["token"]).post(f"{API}/invites/redeem", json={"code": code})
        assert r1.status_code == 200, f"first redeem failed: {r1.text}"

        r2 = _user_session(u2["token"]).post(f"{API}/invites/redeem", json={"code": code})
        assert r2.status_code == 400
        detail = r2.json().get("detail", "").lower()
        assert "already" in detail, f"Expected 'already' in detail, got: {detail!r}"

    def test_redeem_whitespace_tolerance(self, admin_session, throwaway_user_factory, minted_codes):
        code = _mint_invite(admin_session, minted_codes, grant_days=7)
        u = throwaway_user_factory()
        us = _user_session(u["token"])
        padded = f"  {code}  "
        r = us.post(f"{API}/invites/redeem", json={"code": padded})
        assert r.status_code == 200, f"whitespace-padded redeem failed: {r.status_code} {r.text}"
        assert r.json()["success"] is True

    def test_redeem_ops_manager_role_grant(self, admin_session, throwaway_user_factory, minted_codes, mongo):
        code = _mint_invite(admin_session, minted_codes, grant_days=7, grant_role="ops_manager")
        u = throwaway_user_factory()
        us = _user_session(u["token"])
        r = us.post(f"{API}/invites/redeem", json={"code": code})
        assert r.status_code == 200
        data = r.json()
        assert data["grant_role"] == "ops_manager"
        assert "Ops Manager" in data["message"]
        user_doc = mongo.users.find_one({"user_id": u["user_id"]})
        assert user_doc["role"] == "ops_manager"


class TestDialectRemoval:
    def test_ai_chat_no_dialect(self, admin_session):
        # Demo Pro user has AI access
        r = admin_session.post(f"{API}/ai/chat", json={
            "mode": "assistant",
            "message": "Say a quick friendly greeting and mention CT ops.",
        }, timeout=60)
        assert r.status_code == 200, f"ai chat failed: {r.status_code} {r.text[:300]}"
        content = (r.json().get("response") or r.json().get("message") or "").lower()
        # If schema differs, at least the whole body shouldn't contain dialect
        raw = r.text
        for needle in DIALECT_SUBSTRINGS:
            assert needle.lower() not in raw.lower(), f"dialect substring present in AI response: {needle!r}"

    def test_server_source_no_dialect(self):
        with open("/app/backend/server.py", "r") as f:
            src = f.read()
        # CAPE_BRETON_SAFETY_QUIPS variable name is intentionally preserved (per request).
        # We check for the *dialect strings* only.
        for needle in DIALECT_SUBSTRINGS:
            assert needle.lower() not in src.lower(), f"dialect substring still in server.py: {needle!r}"

    def test_frontend_source_no_dialect(self):
        import glob
        files = (glob.glob("/app/frontend/src/**/*.jsx", recursive=True) +
                 glob.glob("/app/frontend/src/**/*.js", recursive=True))
        offenders = []
        for fp in files:
            with open(fp, "r", errors="ignore") as f:
                text = f.read().lower()
            for needle in DIALECT_SUBSTRINGS:
                if needle.lower() in text:
                    offenders.append((fp, needle))
        assert not offenders, f"dialect strings still in frontend: {offenders}"


class TestProdCodesUntouched:
    def test_prod_codes_intact(self, mongo):
        for code in PROD_CT_CODES + PROD_OM_CODES:
            doc = mongo.invite_codes.find_one({"code": code})
            assert doc is not None, f"prod code missing: {code}"
            assert doc.get("is_active", True) is True, f"prod code deactivated: {code}"
            assert doc.get("use_count", 0) in (0, 1), f"prod code use_count unexpected: {code}={doc.get('use_count')}"
