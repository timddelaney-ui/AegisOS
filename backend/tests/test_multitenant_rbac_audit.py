import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from middleware.tenant import (  # noqa: E402
    TenantDB, has_entitlement, has_permission, org_plan, role_of,
)
from services import audit_chain  # noqa: E402
from services.org_routes import build_router  # noqa: E402

USERS = {
    "a_fleet": {"user_id": "a_fleet", "email": "f@a", "team_id": "orgA", "role": "ops_manager", "subscription_plan": "aegis_fleet"},
    "a_op": {"user_id": "a_op", "email": "o@a", "team_id": "orgA", "role": "crew"},
    "a_cm": {"user_id": "a_cm", "email": "c@a", "team_id": "orgA", "org_role": "company_man"},
    "a_supervisor": {"user_id": "a_supervisor", "email": "s@a", "team_id": "orgA", "role": "field_manager"},
    "b_fleet": {"user_id": "b_fleet", "email": "f@b", "team_id": "orgB", "org_role": "fleet_manager", "subscription_plan": "aegis_fleet"},
    "b_management": {"user_id": "b_management", "email": "m@b", "team_id": "orgB", "role": "ops_manager", "subscription_plan": "aegis_fleet"},
}


def make_app():
    db = AsyncMongoMockClient()["t"]
    app = FastAPI()

    async def require_user(x_user: str = Header(None)):
        if x_user not in USERS:
            raise HTTPException(401)
        return USERS[x_user]

    async def chain(user, action, *, requester=None, approver=None, target=None,
                    payload_hash=None, decision=None, rig_id=None, meta=None):
        await audit_chain.append(db, org_id=user["team_id"], action=action,
                                 actor_user_id=user["user_id"], rig_id=rig_id, target=target, meta=meta)

    app.include_router(build_router(
        require_user=require_user, db=db, chain_audit=chain,
        has_fleet_plan=lambda user: user.get("subscription_plan") == "aegis_fleet",
    ), prefix="/api")
    return app, db


@pytest.fixture
def env():
    app, db = make_app()
    with TestClient(app) as c:
        yield c, db


def h(u):
    return {"x-user": u}


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_rbac_matrix():
    assert has_permission(USERS["a_op"], "encoder_drift.ack")
    assert not has_permission(USERS["a_op"], "audit.read")
    assert has_permission(USERS["a_cm"], "outbound.approve")
    assert has_permission(USERS["a_cm"], "telemetry.live")
    assert not has_permission(USERS["a_cm"], "annotation.write")
    assert has_permission(USERS["a_fleet"], "rig.provision")
    assert role_of(USERS["a_fleet"]) == "fleet_manager"


def test_route_permissions(env):
    c, _ = env
    assert c.post("/api/org/rigs", json={"rig_id": "CT-UNIT-01"}, headers=h("a_op")).status_code == 403
    assert c.post("/api/org/rigs", json={"rig_id": "CT-UNIT-01"}, headers=h("a_cm")).status_code == 403
    assert c.post("/api/org/rigs", json={"rig_id": "CT-UNIT-01"}, headers=h("a_fleet")).status_code == 200
    for u in ("a_op", "a_cm"):
        assert c.get("/api/audit-logs", headers=h(u)).status_code == 403
        assert c.get("/api/audit-logs/verify", headers=h(u)).status_code == 403
    assert c.get("/api/audit-logs", headers=h("a_fleet")).status_code == 200


def test_cross_tenant_isolation(env):
    c, db = env
    c.post("/api/org/rigs", json={"rig_id": "CT-UNIT-01"}, headers=h("a_fleet"))
    # Tenant B cannot see A's rig, and a duplicate id in B is independent
    assert c.get("/api/org/rigs", headers=h("b_fleet")).json() == []
    assert c.post("/api/org/rigs", json={"rig_id": "CT-UNIT-01"}, headers=h("b_fleet")).status_code == 200
    # Role change across tenants is a 404 even for a valid user id
    r = c.put("/api/org/users/a_op/role", json={"role": "company_man"}, headers=h("b_fleet"))
    assert r.status_code == 404
    # B cannot see A's audit entries
    acts = [e["action"] for e in c.get("/api/audit-logs", headers=h("b_fleet")).json()["items"]]
    assert acts == ["rig.provision"]


def test_job_rig_lead_assignments_are_team_scoped_and_management_only(env):
    c, db = env
    assert c.post("/api/org/rigs", json={"rig_id": "CT-UNIT-01"}, headers=h("a_fleet")).status_code == 200
    run(db.users.insert_many([
        {"user_id": "a_op", "team_id": "orgA"},
        {"user_id": "b_fleet", "team_id": "orgB"},
    ]))
    path = "/api/rigs/CT-UNIT-01/lead-assignment"
    assert c.get("/api/rigs/lead-assignments", headers=h("a_op")).status_code == 403
    assert c.put(path, json={"user_id": "a_op"}, headers=h("a_op")).status_code == 403
    assert c.put(path, json={"user_id": "a_op"}, headers=h("a_supervisor")).status_code == 403
    assert c.put(path, json={}, headers=h("a_fleet")).status_code == 422
    assert c.put(path, json={"user_id": "b_fleet"}, headers=h("a_fleet")).status_code == 404
    assert c.put("/api/rigs/CT-UNIT-05/lead-assignment", json={"user_id": "a_op"}, headers=h("a_fleet")).status_code == 404
    assert c.put(path, json={"user_id": "a_op"}, headers=h("a_fleet")).json() == {"rig_id": "CT-UNIT-01", "user_id": "a_op"}
    assert c.get("/api/rigs/lead-assignments", headers=h("b_management")).json()["assignments"] == []
    assert c.get("/api/rigs/lead-assignments", headers=h("a_fleet")).json()["assignments"] == [
        {"team_id": "orgA", "rig_id": "CT-UNIT-01", "user_id": "a_op"}
    ]
    assert c.put(path, json={"user_id": None}, headers=h("a_fleet")).json()["user_id"] is None
    entries = c.get("/api/audit-logs", headers=h("a_fleet")).json()["items"]
    assert [entry["action"] for entry in entries] == [
        "rig.lead_assignment", "rig.lead_assignment", "rig.provision",
    ]


def test_tenantdb_injects_org_and_blocks_guessed_id():
    async def go():
        db = AsyncMongoMockClient()["t"]
        a, b = TenantDB(db, "A"), TenantDB(db, "B")
        await a.jobs.insert_one({"id": "j1", "org_id": "B"})  # caller org_id is overridden
        assert await b.jobs.find_one({"id": "j1"}) is None
        assert (await a.jobs.find_one({"id": "j1"}))["org_id"] == "A"
        assert (await b.jobs.update_one({"id": "j1"}, {"$set": {"x": 1}})).matched_count == 0
        assert (await b.jobs.delete_one({"id": "j1"})).deleted_count == 0
        assert await a.jobs.count_documents({}) == 1
        assert [d async for d in b.jobs.aggregate([{"$match": {"id": "j1"}}])] == []
    run(go())


def test_audit_chain_append_only_and_tamper_detection():
    async def go():
        db = AsyncMongoMockClient()["t"]
        for i in range(5):
            await audit_chain.append(db, org_id="A", action="x", actor_user_id=f"u{i}")
        await audit_chain.append(db, org_id="B", action="y")
        assert (await audit_chain.verify(db, "A"))["valid"] is True
        with pytest.raises(audit_chain.AppendOnlyViolation):
            audit_chain.guarded(db).update_one({}, {})
        with pytest.raises(audit_chain.AppendOnlyViolation):
            TenantDB(db, "A").audit_logs.delete_many({})
        await db.audit_logs.update_one({"org_id": "A", "seq": 3}, {"$set": {"decision": "approved"}})
        v = await audit_chain.verify(db, "A")
        assert v["valid"] is False and v["broken_at_seq"] == 3
        await db.audit_logs.delete_one({"org_id": "B", "seq": 1})
        assert (await audit_chain.verify(db, "B"))["valid"] is True  # empty chain
        await db.audit_logs.delete_one({"org_id": "A", "seq": 2})
        assert (await audit_chain.verify(db, "A"))["valid"] is False
    run(go())


def test_concurrent_appends_keep_single_chain():
    async def go():
        db = AsyncMongoMockClient()["t"]
        await asyncio.gather(*[audit_chain.append(db, org_id="A", action="x") for _ in range(25)])
        v = await audit_chain.verify(db, "A")
        assert v["valid"] and v["entries"] == 25
    run(go())


def test_plan_entitlements_cannot_be_overridden_by_beta_environment(monkeypatch):
    monkeypatch.delenv("BETA_UNLOCK", raising=False)
    monkeypatch.delenv("BETA_FEATURES", raising=False)
    assert org_plan({"plan": "field_pro", "pilot_expires_at": datetime.now(timezone.utc) + timedelta(days=1)}) == "field_pro"
    assert org_plan({"plan": "field_pro", "pilot_expires_at": datetime.now(timezone.utc) - timedelta(days=1)}) == "free"
    assert org_plan(None, {"subscription_tier": "smallmed"}) == "pro"
    assert org_plan(None, {"subscription_plan": "field_pilot"}) == "free"
    assert org_plan(None, {
        "subscription_plan": "field_pilot",
        "subscription_status": "active",
        "pilot_expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    }) == "field_pilot"
    assert org_plan(None, {}) == "free"
    assert not has_entitlement("free", "security_compliance")
    assert has_entitlement("enterprise", "security_compliance")
    monkeypatch.setenv("BETA_FEATURES", "security_compliance")
    assert not has_entitlement("free", "security_compliance")
    assert not has_entitlement("free", "audit_export")
    monkeypatch.setenv("BETA_UNLOCK", "true")
    assert not has_entitlement("free", "audit_export")
