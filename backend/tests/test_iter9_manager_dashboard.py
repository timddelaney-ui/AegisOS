"""Iter 9 backend tests — Ops Manager role, grant_role invites, /api/manager/dashboard scope."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ct-workbook-sim.preview.emergentagent.com").rstrip("/")
DEMO_COOKIE = {"session_token": "demo_session_dade4ac57f0c496094fde437e8e91f00"}
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"

# Seeded lifetime OM codes — MUST NOT be redeemed by tests (belong to end user)
SEEDED_OM_CODES = {"OM-NRLB-B8H4", "OM-TSLS-BLMC", "OM-5D33-AJAN"}


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.cookies.update(DEMO_COOKIE)
    s.headers.update({"Content-Type": "application/json"})
    return s


def _make_throwaway_user(db, role=None, team_id=None):
    uid = f"TEST_iter9_{uuid.uuid4().hex[:8]}"
    token = f"TEST_iter9_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": "Iter9 Throwaway",
        "subscription_status": "free",
        "created_at": datetime.now(timezone.utc),
    }
    if role:
        doc["role"] = role
    if team_id:
        doc["team_id"] = team_id
    db.users.insert_one(doc)
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    s = requests.Session()
    s.cookies.set("session_token", token)
    s.headers.update({"Content-Type": "application/json"})
    return uid, token, s


def _cleanup(db, uid, token):
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": token})


# ---------- Regression: /api/auth/me returns role field ----------
def test_auth_me_returns_role_default_crew(admin_session, db):
    r = admin_session.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    # role should always be present; default 'crew' for legacy users
    assert "role" in data
    assert data["role"] in ("crew", "field_manager", "ops_manager")


# ---------- Seeded OM codes present ----------
def test_seeded_om_codes_present_in_admin_invites(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/invites")
    assert r.status_code == 200
    invites = r.json()
    codes = {i["code"]: i for i in invites}
    for c in SEEDED_OM_CODES:
        assert c in codes, f"Missing seeded OM code {c}"
        inv = codes[c]
        assert inv["grant_role"] == "ops_manager"
        assert inv["grant_days"] == 3650
        assert inv["is_active"] is True
        assert inv["use_count"] == 0, f"Seeded OM code {c} appears to have been redeemed"


# ---------- POST /api/admin/invites with grant_role ----------
def test_create_invite_with_grant_role_ops_manager(admin_session, db):
    r = admin_session.post(f"{BASE_URL}/api/admin/invites", json={
        "grant_days": 3650,
        "max_uses": 1,
        "grant_role": "ops_manager",
        "note": "OM tester",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["grant_role"] == "ops_manager"
    assert data["grant_days"] == 3650
    assert data["max_uses"] == 1
    code = data["code"]
    # cleanup
    db.invite_codes.delete_one({"code": code})


# ---------- POST /api/invites/redeem promotes user to ops_manager ----------
def test_redeem_grants_ops_manager_role(admin_session, db):
    # Mint fresh code (do NOT burn seeded OM codes)
    r = admin_session.post(f"{BASE_URL}/api/admin/invites", json={
        "grant_days": 30,
        "max_uses": 1,
        "grant_role": "ops_manager",
        "note": "iter9 redeem test",
    })
    assert r.status_code == 200
    code = r.json()["code"]

    uid, token, s = _make_throwaway_user(db)
    try:
        r = s.post(f"{BASE_URL}/api/invites/redeem", json={"code": code})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["success"] is True
        assert data["grant_role"] == "ops_manager"
        assert "Ops Manager" in data["message"]

        u = db.users.find_one({"user_id": uid})
        assert u["role"] == "ops_manager"
        assert u["subscription_status"] == "active"
    finally:
        _cleanup(db, uid, token)
        db.invite_codes.delete_one({"code": code})


# ---------- Redeem WITHOUT grant_role keeps existing role intact ----------
def test_redeem_without_grant_role_preserves_role(admin_session, db):
    r = admin_session.post(f"{BASE_URL}/api/admin/invites", json={
        "grant_days": 30, "max_uses": 1, "note": "iter9 no role"
    })
    code = r.json()["code"]

    uid, token, s = _make_throwaway_user(db, role="field_manager")
    try:
        r = s.post(f"{BASE_URL}/api/invites/redeem", json={"code": code})
        assert r.status_code == 200
        assert r.json().get("grant_role") is None
        u = db.users.find_one({"user_id": uid})
        assert u["role"] == "field_manager", "Role must be unchanged when invite has no grant_role"
    finally:
        _cleanup(db, uid, token)
        db.invite_codes.delete_one({"code": code})


# ---------- /api/manager/dashboard as admin/ops_manager -> cross_team ----------
def test_manager_dashboard_admin_cross_team(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/manager/dashboard")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["scope"] == "cross_team"
    for key in ("rigs_activity", "safety_events", "maintenance_events",
                "alerts", "inventory_flags", "parts_open"):
        assert key in data, f"Missing key {key}"
        assert isinstance(data[key], list)
    totals = data["totals"]
    for k in ("teams_seen", "rigs_seen", "safety_events", "maintenance_events",
              "alerts", "inventory_flags", "parts_open"):
        assert k in totals


# ---------- Crew user -> 403 ----------
def test_manager_dashboard_crew_403(db):
    uid, token, s = _make_throwaway_user(db, role="crew")
    try:
        r = s.get(f"{BASE_URL}/api/manager/dashboard")
        assert r.status_code == 403
    finally:
        _cleanup(db, uid, token)


# ---------- Field manager needs a team ----------
def test_manager_dashboard_field_manager_needs_team(db):
    uid, token, s = _make_throwaway_user(db, role="field_manager")  # no team
    try:
        r = s.get(f"{BASE_URL}/api/manager/dashboard")
        assert r.status_code == 400
    finally:
        _cleanup(db, uid, token)


def test_manager_dashboard_field_manager_with_team_scope_team(db):
    # Give them an existing team_id (borrow demo user's team)
    demo = db.users.find_one({"email": "demo.pro@example.com"})
    team_id = demo.get("team_id")
    assert team_id, "Demo user should be in a team"
    uid, token, s = _make_throwaway_user(db, role="field_manager", team_id=team_id)
    try:
        r = s.get(f"{BASE_URL}/api/manager/dashboard")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["scope"] == "team"
        assert data["role"] == "field_manager"
    finally:
        _cleanup(db, uid, token)


# ---------- Regression: team items CRUD still works ----------
def test_team_items_crud_unaffected(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/team/items/inventory")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and isinstance(body["items"], list)
