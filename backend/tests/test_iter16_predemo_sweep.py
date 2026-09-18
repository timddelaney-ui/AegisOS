"""
Iter 16 — Pre-demo readiness sweep.
Covers the two "wired" flows (redeem, feedback) end-to-end plus regression on
manager dashboard, admin invites, and workbook/team endpoints. All test data
created here is cleaned up at the end so the admin panel remains tidy.
"""
import os
import secrets
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

def _read_env(path, key):
    with open(path) as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} missing in {path}")

BASE = _read_env("/app/frontend/.env", "REACT_APP_BACKEND_URL").rstrip("/")
MONGO_URL = _read_env("/app/backend/.env", "MONGO_URL")
DB_NAME = _read_env("/app/backend/.env", "DB_NAME")

_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]

DEMO_COOKIE = {"session_token": "demo_session_dade4ac57f0c496094fde437e8e91f00"}

# Track things to clean up
_created_invites = []
_created_feedback = []
_created_users = []
_created_sessions = []


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    s.cookies.update(DEMO_COOKIE)
    return s


@pytest.fixture(scope="module")
def throwaway_session():
    """Seed a fresh user + session directly in Mongo so we can redeem cleanly."""
    uid = f"test_user_{uuid.uuid4().hex[:8]}"
    tok = f"test_session_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    _db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": "Throwaway Redeemer",
        "picture": "https://via.placeholder.com/150",
        "team_id": None,
        "subscription_status": "trial",
        "subscription_plan": None,
        "role": "crew",
        "created_at": now,
        "updated_at": now,
    })
    _db.user_sessions.insert_one({
        "session_token": tok,
        "user_id": uid,
        "email": f"{uid}@example.com",
        "expires_at": now.replace(year=now.year + 1),
        "created_at": now,
    })
    _created_users.append(uid)
    _created_sessions.append(tok)
    s = requests.Session()
    s.cookies.update({"session_token": tok})
    return s, uid


# ---------- basic sanity ----------
def test_auth_me(demo_session):
    r = demo_session.get(f"{BASE}/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "demo.pro@example.com"
    assert data["subscription_status"] == "active"


# ---------- Admin Invites ----------
def test_admin_invites_list_includes_ct_and_om(demo_session):
    r = demo_session.get(f"{BASE}/api/admin/invites")
    assert r.status_code == 200, r.text
    codes = r.json()
    ct = [c for c in codes if c["code"].startswith("CT-")]
    om = [c for c in codes if c["code"].startswith("OM-")]
    assert len(ct) >= 20, f"Expected >=20 CT- codes, got {len(ct)}"
    assert len(om) >= 3, f"Expected >=3 OM- codes, got {len(om)}"
    # verify none of the 3 OM- codes have been redeemed (customer's codes)
    for c in om:
        assert c["use_count"] == 0, f"OM code {c['code']} has been used!"


def test_create_invite_with_ops_manager_role(demo_session):
    body = {"grant_days": 30, "note": "TEST iter16 disposable", "max_uses": 1, "grant_role": "ops_manager"}
    r = demo_session.post(f"{BASE}/api/admin/invites", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["grant_role"] == "ops_manager"
    assert data["grant_days"] == 30
    assert data["use_count"] == 0
    assert data["code"].startswith("CT-")
    _created_invites.append(data["code"])


# ---------- Redeem flow (critical) ----------
def test_redeem_success_sets_active(demo_session, throwaway_session):
    # mint a disposable code
    r = demo_session.post(f"{BASE}/api/admin/invites",
                          json={"grant_days": 7, "note": "TEST iter16 redeem", "max_uses": 1})
    assert r.status_code == 200
    code = r.json()["code"]
    _created_invites.append(code)

    sess, uid = throwaway_session
    r = sess.post(f"{BASE}/api/invites/redeem", json={"code": code})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("success") is True

    # Verify /api/auth/me reflects active
    me = sess.get(f"{BASE}/api/auth/me").json()
    assert me["subscription_status"] == "active"
    assert me["subscription_plan"] == "invite"


def test_redeem_single_use_enforcement(demo_session, throwaway_session):
    # mint a fresh code, redeem it, then attempt second redeem via another new user
    r = demo_session.post(f"{BASE}/api/admin/invites",
                          json={"grant_days": 3, "note": "TEST iter16 single-use", "max_uses": 1})
    code = r.json()["code"]
    _created_invites.append(code)

    sess1, _ = throwaway_session  # already has a session, but the throwaway_session is module-scoped so a fresh throwaway is needed
    # Create a second throwaway user
    uid = f"test_user_{uuid.uuid4().hex[:8]}"
    tok = f"test_session_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    _db.users.insert_one({"user_id": uid, "email": f"{uid}@example.com", "name": "T2",
                          "team_id": None, "subscription_status": "trial",
                          "role": "crew", "created_at": now, "updated_at": now})
    _db.user_sessions.insert_one({"session_token": tok, "user_id": uid,
                                  "email": f"{uid}@example.com",
                                  "expires_at": now.replace(year=now.year+1), "created_at": now})
    _created_users.append(uid); _created_sessions.append(tok)

    s2 = requests.Session(); s2.cookies.update({"session_token": tok})
    r1 = s2.post(f"{BASE}/api/invites/redeem", json={"code": code})
    assert r1.status_code == 200, r1.text

    # 2nd redeem by third user must fail
    uid2 = f"test_user_{uuid.uuid4().hex[:8]}"
    tok2 = f"test_session_{uuid.uuid4().hex}"
    _db.users.insert_one({"user_id": uid2, "email": f"{uid2}@example.com", "name": "T3",
                          "team_id": None, "subscription_status": "trial",
                          "role": "crew", "created_at": now, "updated_at": now})
    _db.user_sessions.insert_one({"session_token": tok2, "user_id": uid2,
                                  "email": f"{uid2}@example.com",
                                  "expires_at": now.replace(year=now.year+1), "created_at": now})
    _created_users.append(uid2); _created_sessions.append(tok2)
    s3 = requests.Session(); s3.cookies.update({"session_token": tok2})
    r2 = s3.post(f"{BASE}/api/invites/redeem", json={"code": code})
    assert r2.status_code == 400
    assert "already" in r2.text.lower() or "redeemed" in r2.text.lower()


def test_redeem_invalid_code(throwaway_session):
    sess, _ = throwaway_session
    r = sess.post(f"{BASE}/api/invites/redeem", json={"code": "CT-XXXX-XXXX"})
    assert r.status_code == 404


# ---------- Feedback flow (critical) ----------
def test_feedback_submit_and_admin_list(demo_session):
    payload = {
        "category": "idea",
        "subject": "TEST iter16 subject",
        "message": "TEST iter16 message body for pre-demo sweep.",
        "page": "/hub",
    }
    r = demo_session.post(f"{BASE}/api/feedback", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["category"] == "idea"
    assert data["subject"] == "TEST iter16 subject"
    assert data["status"] == "new"
    fid = data["feedback_id"]
    _created_feedback.append(fid)

    # admin list must contain it (demo user is admin per ADMIN_EMAILS)
    lr = demo_session.get(f"{BASE}/api/feedback")
    assert lr.status_code == 200
    ids = [f["feedback_id"] for f in lr.json()]
    assert fid in ids


def test_feedback_invalid_category(demo_session):
    r = demo_session.post(f"{BASE}/api/feedback",
                          json={"category": "bogus", "subject": "x", "message": "y"})
    assert r.status_code == 400


# ---------- Regression: workbook / rigs / team / manager ----------
def test_rigs_list_client_side():
    """Rigs (1-25 + Yard) are defined client-side in RigContext.jsx — this is by design so
    the roster is always available offline. Verify the frontend module exposes 26 rigs."""
    from pathlib import Path
    src = Path("/app/frontend/src/context/RigContext.jsx").read_text()
    assert "length: 25" in src, "RigContext should expose 25 numbered rigs"
    assert '"YARD"' in src, "RigContext should include the Yard entry"


def test_manager_dashboard_admin_scope(demo_session):
    r = demo_session.get(f"{BASE}/api/manager/dashboard")
    # ops_manager or admin
    assert r.status_code in (200, 403), r.text
    if r.status_code == 200:
        data = r.json()
        assert "scope" in data or "stats" in data or "kpis" in data


def test_equipment_list(demo_session):
    r = demo_session.get(f"{BASE}/api/equipment")
    assert r.status_code == 200
    body = r.json()
    # API returns { items: [...], team_id, rig_id }
    assert "items" in body and isinstance(body["items"], list)


def test_schedule_shifts_list(demo_session):
    # Correct endpoint is /api/schedule (not /schedule/shifts); requires a rig_id in practice
    r = demo_session.get(f"{BASE}/api/schedule", params={"rig_id": "RIG1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "shifts" in body and isinstance(body["shifts"], list)


# ---------- teardown ----------
def test_zzz_cleanup():
    # Revoke test invite codes so admin panel stays clean
    for code in _created_invites:
        try:
            _db.invite_codes.delete_one({"code": code})
        except Exception:
            pass
    for fid in _created_feedback:
        try:
            _db.feedback.delete_one({"feedback_id": fid})
        except Exception:
            pass
    for uid in _created_users:
        _db.users.delete_one({"user_id": uid})
    for tok in _created_sessions:
        _db.user_sessions.delete_one({"session_token": tok})
    # sanity: ensure no TEST_ invite remains
    remain = list(_db.invite_codes.find({"note": {"$regex": "^TEST iter16"}}))
    assert remain == []
