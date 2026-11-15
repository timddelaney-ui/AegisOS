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
    assert plan(trial_expires_at=NOW + timedelta(days=3)) == "trial"
    assert plan(trial_expires_at=NOW - timedelta(days=1)) == "free"
    assert plan(subscription_status="active", subscription_plan="workbook_pro") == "workbook_pro"
    assert plan(subscription_status="active", subscription_expires_at=NOW - timedelta(days=1)) == "free"
    assert plan(subscription_status="active", subscription_plan="aegis_fleet") == "aegis_fleet"
    assert plan(subscription_status="canceled") == "free"
    assert plan(admin_unlocked=True) == "aegis_fleet"


def test_fleet_paths():
    for p in ("/api/reels", "/api/reels/x", "/api/fatigue/state", "/api/rbac/promote",
              "/api/job-packages/1/acknowledge", "/api/timecards/approve-payroll",
              "/api/rigs/status", "/api/liveops/stream", "/api/daq/configs"):
        assert server._is_fleet_only_path(p), p
    for p in ("/api/ai/chat", "/api/jobs", "/api/teams", "/api/surveys/x", "/api/plugs", "/api/timecards"):
        assert not server._is_fleet_only_path(p), p
