import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

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


def test_admin_email_allowlist_grants_fleet_access_case_insensitively(monkeypatch):
    monkeypatch.setattr(server, "ADMIN_EMAILS", ["owner@example.com"])
    owner = server._apply_admin_unlock({"email": " Owner@Example.com "})
    assert owner["admin_unlocked"] is True
    assert owner["role"] == "ops_manager"
    assert server.get_effective_plan(owner) == "aegis_fleet"


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


def test_staging_startup_skips_daq_and_mqtt_consumers(monkeypatch):
    monkeypatch.setattr(server, "ALLOW_RIG_CONNECTIONS", False)
    monkeypatch.setattr(server, "_daq_orchestrator", None)
    monkeypatch.setattr(server, "_mqtt_service", None)

    asyncio.run(server._start_daq_orchestrator())
    asyncio.run(server._start_mqtt_consumer())

    assert server._daq_orchestrator is None
    assert server._mqtt_service is None


@pytest.mark.parametrize("amount,currency,interval,setup_fee,trial,allowed", [
    ("9.99", "USD", "MONTH", "0", False, True),
    ("69.00", "CAD", "MONTH", "0", False, False),
    ("69.00", "USD", "MONTH", "0", False, False),
    ("9.99", "CAD", "MONTH", "0", False, False),
    ("9.99", "USD", "YEAR", "0", False, False),
    ("9.99", "USD", "MONTH", "5", False, False),
    ("9.99", "USD", "MONTH", "0", True, False),
    ("invalid", "USD", "MONTH", "0", False, False),
])
def test_checkout_requires_matching_usd_monthly_plan(
    monkeypatch, amount, currency, interval, setup_fee, trial, allowed,
):
    import asyncio

    calls = []
    records = []
    cycle = {
        "tenure_type": "REGULAR", "total_cycles": 0,
        "frequency": {"interval_unit": interval, "interval_count": 1},
        "pricing_scheme": {"fixed_price": {"currency_code": currency, "value": amount}},
    }

    async def fake_paypal(method, path, **kwargs):
        calls.append((method, path))
        if method == "GET":
            return {
                "status": "ACTIVE",
                "billing_cycles": [cycle, {**cycle, "tenure_type": "TRIAL"}] if trial else [cycle],
                "payment_preferences": {"setup_fee": {"currency_code": currency, "value": setup_fee}},
            }
        return {"id": "I-new", "links": [{"rel": "approve", "href": "https://www.paypal.com/approve"}]}

    class Transactions:
        async def insert_one(self, record):
            records.append(record)

    class FakeDb:
        payment_transactions = Transactions()

    monkeypatch.setattr(server, "_paypal", fake_paypal)
    monkeypatch.setattr(server, "db", FakeDb())
    monkeypatch.setitem(server.PAYPAL_PLAN_IDS, "ct_pro_monthly", "P-new")
    request = server.CheckoutRequest(lookup_key="ct_pro_monthly", origin_url=server.PUBLIC_APP_URL)
    checkout = server.create_checkout(request, {"user_id": "u1", "email": "buyer@example.com"})
    if allowed:
        result = asyncio.run(checkout)
        assert result["session_id"] == "I-new"
        assert records[0]["currency"] == "USD"
        assert calls[-1] == ("POST", "/v1/billing/subscriptions")
    else:
        with pytest.raises(server.HTTPException) as exc:
            asyncio.run(checkout)
        assert exc.value.status_code == 503
        assert calls == [("GET", "/v1/billing/plans/P-new")]
        assert not records
