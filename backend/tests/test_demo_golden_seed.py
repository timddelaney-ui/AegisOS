import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routes import demo  # noqa: E402

USERS = {
    "mgr": {"user_id": "m", "email": "m@a", "team_id": "orgA", "role": "management"},
    "mgrB": {"user_id": "mb", "email": "m@b", "team_id": "orgB", "role": "management"},
    "op": {"user_id": "o", "email": "o@a", "team_id": "orgA", "role": "operator"},
}


@pytest.fixture
def env():
    db = AsyncMongoMockClient()["t"]
    app = FastAPI()

    async def require_user(x_user: str = Header(None)):
        if x_user not in USERS:
            raise HTTPException(401)
        return USERS[x_user]

    app.include_router(demo.build_router(require_user=require_user, db=db), prefix="/api")
    with TestClient(app) as c:
        yield c, db


def test_seed_is_gated_by_role_and_beta_mode(env, monkeypatch):
    c, _ = env
    monkeypatch.delenv("BETA_TEST_MODE", raising=False)
    assert c.post("/api/demo/golden-job/seed").status_code == 401
    assert c.post("/api/demo/golden-job/seed", headers={"x-user": "op"}).status_code == 403
    monkeypatch.setenv("BETA_TEST_MODE", "true")
    assert c.post("/api/demo/golden-job/seed", headers={"x-user": "op"}).status_code == 200


def test_seed_creates_org_scoped_data_and_is_idempotent(env, monkeypatch):
    c, db = env
    monkeypatch.delenv("BETA_TEST_MODE", raising=False)
    first = c.post("/api/demo/golden-job/seed", headers={"x-user": "mgr"}).json()
    again = c.post("/api/demo/golden-job/seed", headers={"x-user": "mgr"}).json()
    assert first["seeded"] is True and again["seeded"] is False
    assert [a["role"] for a in first["accounts"]] == ["operator", "lead_op", "supervisor", "management"]
    assert {a["email"] for a in first["accounts"]} >= {"operator@aegis.local", "supervisor@aegis.local"}

    async def counts():
        return {
            "jobs": await db.jobs.count_documents({"org_id": "orgA"}),
            "tasks": await db.approval_tasks.count_documents({"org_id": "orgA"}),
            "pending": await db.approval_requests.count_documents(
                {"org_id": "orgA", "kind": "parts_request", "status": "pending_supervisor"}),
            "survey": await db.surveys.count_documents({"org_id": "orgA"}),
            "other_org": await db.jobs.count_documents({"org_id": "orgB"}),
            "job": await db.jobs.find_one({"org_id": "orgA"}, {"_id": 0}),
        }

    import asyncio
    n = asyncio.new_event_loop().run_until_complete(counts())
    assert (n["jobs"], n["tasks"], n["pending"], n["survey"], n["other_org"]) == (1, 3, 1, 1, 0)
    v = n["job"]["values"]
    assert v["well"]["td_md_ft"] == 16400 and v["bha"] and v["string"] and v["survey"][-1]["md_ft"] == 16400

    other = c.post("/api/demo/golden-job/seed", headers={"x-user": "mgrB"}).json()
    assert other["job_id"] != first["job_id"] and other["org_id"] == "orgB"
