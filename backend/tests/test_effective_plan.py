import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402

NOW = datetime.now(timezone.utc)


def plan(**kw):
    return server.get_effective_plan(kw)


def test_plan_resolution():
    assert plan(trial_expires_at=NOW + timedelta(days=3)) == "free"
    assert plan(trial_expires_at=NOW - timedelta(days=1)) == "free"
    assert plan(subscription_status="active", subscription_plan="workbook_pro") == "workbook_pro"
    assert plan(subscription_status="active", subscription_expires_at=NOW - timedelta(days=1)) == "free"
    assert plan(subscription_status="active", subscription_plan="aegis_fleet") == "aegis_fleet"
    assert plan(subscription_status="active", subscription_plan="field_pilot",
                pilot_expires_at=NOW + timedelta(days=60)) == "field_pilot"
    assert plan(subscription_status="active", subscription_plan="field_pilot",
                pilot_expires_at=NOW - timedelta(days=1)) == "free"
    assert plan(organization_plan="field_pilot",
                organization_pilot_expires_at=NOW + timedelta(days=60)) == "field_pilot"
    assert plan(organization_plan="field_pilot",
                organization_pilot_expires_at=NOW - timedelta(days=1)) == "free"
    assert plan(subscription_status="active", subscription_plan="invite",
                subscription_expires_at=NOW + timedelta(days=1)) == "workbook_pro"
    assert plan(subscription_status="active") == "free"
    assert plan(subscription_status="canceled") == "free"
    assert plan(admin_unlocked=True) == "aegis_fleet"


def test_legacy_trial_timestamp_does_not_unlock_paid_services():
    legacy_trial = {"trial_expires_at": NOW + timedelta(days=30)}
    assert not server._user_is_pro(legacy_trial)
    assert not server._user_has_ai_access(legacy_trial)
    assert server._user_is_pro({"subscription_status": "active", "subscription_plan": "workbook_pro"})


def test_plan_path_groups():
    for p in ("/api/rbac/promote", "/api/job-packages/1/acknowledge",
              "/api/timecards/approve-payroll", "/api/rigs/lead-assignment",
              "/api/org/rigs", "/api/approvals"):
        assert server._is_fleet_only_path(p), p
    for p in ("/api/reels", "/api/reels/x", "/api/fatigue/state",
              "/api/rigs/status", "/api/liveops/stream", "/api/daq/configs",
              "/api/surveys/x"):
        assert server._is_pilot_only_path(p), p
    for p in ("/api/jobs", "/api/teams", "/api/team/items", "/api/crew/chat",
              "/api/share-links"):
        assert server._is_pro_only_path(p), p
    for p in ("/api/ai/chat",):
        assert not server._is_fleet_only_path(p)
        assert not server._is_pilot_only_path(p)
        assert not server._is_pro_only_path(p)


def test_paypal_sync_activates_workbook_pro(monkeypatch):
    import asyncio

    updates = []

    class Users:
        async def update_one(self, query, update):
            updates.append((query, update["$set"]))

    class FakeDb:
        users = Users()

    async def fake_paypal(method, path, **kw):
        return {"status": "ACTIVE", "plan_id": "P-Y", "custom_id": "u1",
                "billing_info": {"next_billing_time": "2027-01-01T00:00:00Z"}}

    monkeypatch.setattr(server, "db", FakeDb())
    monkeypatch.setattr(server, "_paypal", fake_paypal)
    monkeypatch.setitem(server.PAYPAL_PLAN_IDS, "ct_pro_monthly", "P-Y")
    assert asyncio.run(server._sync_paypal_subscription("I-1")) == "ACTIVE"
    query, fields = updates[0]
    assert query == {"user_id": "u1"}
    assert fields["subscription_status"] == "active"
    assert fields["subscription_plan"] == "workbook_pro"
    assert fields["paypal_subscription_id"] == "I-1"
