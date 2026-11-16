import asyncio
from pathlib import Path
import sys

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routes.approvals import build_approvals_router  # noqa: E402
from services import audit_chain  # noqa: E402
from services.rbac import rank, role_tier  # noqa: E402

USERS = {
    "op": {"user_id": "op", "email": "op@a", "team_id": "orgA", "role": "operator"},
    "lead": {"user_id": "lead", "email": "l@a", "team_id": "orgA", "role": "lead_op"},
    "sup": {"user_id": "sup", "email": "s@a", "team_id": "orgA", "role": "supervisor"},
    "mgr": {"user_id": "mgr", "email": "m@a", "team_id": "orgA", "role": "management"},
    "legacy_crew": {"user_id": "lc", "email": "c@a", "team_id": "orgA", "role": "crew"},
    "mgrB": {"user_id": "mb", "email": "m@b", "team_id": "orgB", "role": "ops_manager"},
}


@pytest.fixture
def env():
    db = AsyncMongoMockClient()["t"]
    app = FastAPI()

    async def require_user(x_user: str = Header(None)):
        if x_user not in USERS:
            raise HTTPException(401)
        return USERS[x_user]

    async def chain(user, action, *, requester=None, approver=None, target=None,
                    payload_hash=None, decision=None, rig_id=None, meta=None):
        await audit_chain.append(db, org_id=user["team_id"], action=action,
                                 actor_user_id=user["user_id"], target=target,
                                 decision=decision, rig_id=rig_id, meta=meta)

    app.include_router(build_approvals_router(require_user=require_user, db=db, chain_audit=chain),
                       prefix="/api")
    with TestClient(app) as c:
        yield c, db


def h(u):
    return {"x-user": u}


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_rank_and_legacy_mapping():
    assert [rank(r) for r in ("operator", "lead_op", "supervisor", "management")] == [1, 2, 3, 4]
    assert role_tier({"role": "crew"}) == "operator"
    assert role_tier({"role": "field_manager"}) == "supervisor"
    assert role_tier({"role": "ops_manager"}) == "management"
    assert role_tier({"role": "admin"}) == "management"
    assert role_tier({"role": "bogus"}) == "operator"


def test_full_chain_flow_and_verify(env):
    c, db = env
    r = c.post("/api/approvals/requests", json={"kind": "parts_request", "title": "Seals"}, headers=h("op"))
    assert r.status_code == 200 and r.json()["status"] == "pending_supervisor"
    rid = r.json()["request_id"]

    assert [i["request_id"] for i in c.get("/api/approvals/requests", headers=h("sup")).json()["items"]] == [rid]
    d = c.post(f"/api/approvals/requests/{rid}/supervisor-decision",
               json={"decision": "approve"}, headers=h("sup"))
    assert d.json()["status"] == "pending_po"
    assert c.get("/api/approvals/requests", headers=h("sup")).json()["items"] == []
    assert len(c.get("/api/approvals/requests", headers=h("mgr")).json()["items"]) == 1

    d = c.post(f"/api/approvals/requests/{rid}/management-decision",
               json={"decision": "approve", "po_number": "PO-1"}, headers=h("mgr"))
    assert d.json()["status"] == "approved"

    r2 = c.post("/api/approvals/requests", json={"kind": "consumable", "title": "Grease"}, headers=h("op")).json()
    d = c.post(f"/api/approvals/requests/{r2['request_id']}/supervisor-decision",
               json={"decision": "approve", "escalate_to": "pending_management"}, headers=h("sup"))
    assert d.json()["status"] == "pending_management"
    r3 = c.post("/api/approvals/requests", json={"kind": "inventory_update", "title": "x"}, headers=h("op")).json()
    d = c.post(f"/api/approvals/requests/{r3['request_id']}/supervisor-decision",
               json={"decision": "reject"}, headers=h("sup"))
    assert d.json()["status"] == "rejected"

    v = c.get("/api/approvals/audit/verify", headers=h("mgr")).json()
    assert v["valid"] and v["entries"] == 7

    entries = run(db.audit_logs.find({"org_id": "orgA"}, {"_id": 0}).sort("seq", 1).to_list(50))
    assert entries[0]["prev_hash"] == audit_chain.GENESIS
    assert all(e["entry_hash"] and e["prev_hash"] for e in entries)

    run(db.audit_logs.update_one({"org_id": "orgA", "seq": 2}, {"$set": {"decision": "tampered"}}))
    v = c.get("/api/approvals/audit/verify", headers=h("mgr")).json()
    assert not v["valid"] and v["broken_at_seq"] == 2
    assert c.get("/api/approvals/audit/verify", headers=h("mgrB")).json()["valid"]


def test_403s_not_401(env):
    c, _ = env
    rid = c.post("/api/approvals/requests", json={"kind": "parts_request", "title": "t"},
                 headers=h("op")).json()["request_id"]
    assert c.post("/api/approvals/requests", json={"kind": "parts_request", "title": "t"}).status_code == 401
    for u in ("op", "lead"):
        assert c.post(f"/api/approvals/requests/{rid}/supervisor-decision",
                      json={"decision": "approve"}, headers=h(u)).status_code == 403
    for u in ("op", "lead", "sup"):
        assert c.post(f"/api/approvals/requests/{rid}/management-decision",
                      json={"decision": "approve"}, headers=h(u)).status_code == 403
        assert c.get("/api/approvals/audit/verify", headers=h(u)).status_code == 403
    assert c.post("/api/approvals/requests", json={"kind": "bad", "title": "t"}, headers=h("op")).status_code == 400
    # operator only sees own; other operator sees nothing
    assert c.get("/api/approvals/requests", headers=h("legacy_crew")).json()["items"] == []
    # management cannot decide a request still pending supervisor
    assert c.post(f"/api/approvals/requests/{rid}/management-decision",
                  json={"decision": "approve"}, headers=h("mgr")).status_code == 409


def test_documents_and_tasks(env):
    c, _ = env
    assert c.post("/api/approvals/documents/d1/submit", headers=h("op")).status_code == 403
    assert c.post("/api/approvals/documents/d1/submit", headers=h("lead")).json()["status"] == "pending_supervisor"
    assert c.post("/api/approvals/documents/d1/approve", headers=h("lead")).status_code == 403
    assert c.post("/api/approvals/documents/d1/final-approve", headers=h("sup")).status_code == 403
    assert c.post("/api/approvals/documents/d1/approve", headers=h("sup")).json()["status"] == "pending_management"
    assert c.post("/api/approvals/documents/d1/final-approve", headers=h("mgr")).json()["status"] == "approved"

    assert c.post("/api/approvals/tasks", json={"title": "t"}, headers=h("op")).status_code == 403
    t = c.post("/api/approvals/tasks", json={"title": "t"}, headers=h("lead"))
    assert t.status_code == 200
    assert c.post(f"/api/approvals/tasks/{t.json()['task_id']}/assign",
                  json={"assignee_user_id": "x"}, headers=h("op")).status_code == 403


def test_seed_and_test_role_view(env, monkeypatch):
    c, db = env
    monkeypatch.delenv("BETA_TEST_MODE", raising=False)
    assert c.post("/api/dev/seed-role-accounts", headers=h("sup")).status_code == 403
    assert c.post("/api/auth/test-role-view", json={"role": "operator"}, headers=h("op")).status_code == 403
    for _ in range(2):
        a = c.post("/api/dev/seed-role-accounts", headers=h("mgr")).json()["accounts"]
    assert sorted(x["role"] for x in a) == ["lead_op", "management", "operator", "supervisor"]
    assert run(db.users.count_documents({"email": {"$regex": "@aegis.local$"}})) == 4
    t = c.post("/api/auth/test-role-view", json={"role": "supervisor"}, headers=h("mgr"))
    assert t.status_code == 200 and t.json()["claims"]["email"] == "supervisor@aegis.local"
    assert run(db.user_sessions.find_one({"session_token": t.json()["session_token"]}))
    assert c.post("/api/auth/test-role-view", json={"role": "nope"}, headers=h("mgr")).status_code == 400
    monkeypatch.setenv("BETA_TEST_MODE", "true")
    assert c.post("/api/auth/test-role-view", json={"role": "operator"}, headers=h("op")).status_code == 200
