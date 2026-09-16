"""Iteration 7 — Server-side metric-native thresholds for Skipper Watchdog.

Verifies each new/regressed threshold on POST /api/crew/safety-eval:
- CT_Milling: density_hi, rate_hi, wob_high, wob_neg
- CT_Drilling: rop_hi, wob_high
- Frac_Through_CT: density_hi, surfp_hi
- Annular_Frac: surfp_hi
- Sand_Cleanout: rate_hi, vann_low

Notes on dedupe: server dedupes per (team_id, threshold_id) within 60s.
Because several threshold_ids are re-used across sheets (surfp_hi appears in
Frac_Through_CT AND Annular_Frac; density_hi in CT_Milling AND Frac_Through_CT;
rate_hi in CT_Milling AND Sand_Cleanout), we can't guarantee each POST returns
a non-empty `alerts` list. Instead we verify per-rule firing by matching the
resulting Skipper alert in the crew chat (which has both threshold_id AND
sheet_key persisted).
"""
import os
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
DEMO_SESSION = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.cookies.set("session_token", DEMO_SESSION)
    return s


@pytest.fixture(scope="module", autouse=True)
def ensure_team(client):
    r = client.get(f"{BASE_URL}/api/auth/me", timeout=10)
    assert r.status_code == 200, r.text
    me = r.json()
    if not me.get("team_id"):
        r2 = client.post(f"{BASE_URL}/api/teams", json={"name": "Iter7 Crew"}, timeout=10)
        assert r2.status_code == 200, r2.text
    yield


def _post_eval(client, sheet_key, values):
    r = client.post(
        f"{BASE_URL}/api/crew/safety-eval",
        json={"sheet_key": sheet_key, "values": values},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _chat_has_alert(client, sheet_key, threshold_id, within_seconds=120):
    """Return True if a Skipper alert exists in chat for this (sheet_key,threshold_id)
    within the recent window. Robust against 60s dedupe."""
    r = client.get(f"{BASE_URL}/api/crew/chat", timeout=15)
    assert r.status_code == 200
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=within_seconds)
    for m in r.json().get("messages", []):
        if not (m.get("is_skipper") and m.get("is_alert")):
            continue
        if m.get("threshold_id") != threshold_id:
            continue
        if m.get("sheet_key") != sheet_key:
            continue
        # parse created_at
        try:
            raw = m["created_at"]
            if isinstance(raw, str):
                ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            else:
                ts = raw
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            return True
        if ts >= cutoff:
            return True
    return False


def _last_fire_seconds_ago(client, threshold_id):
    """Return seconds since the most recent Skipper alert for this threshold_id,
    or None if not found in chat."""
    r = client.get(f"{BASE_URL}/api/crew/chat", timeout=15)
    if r.status_code != 200:
        return None
    now = datetime.now(timezone.utc)
    latest = None
    for m in r.json().get("messages", []):
        if not (m.get("is_skipper") and m.get("is_alert")):
            continue
        if m.get("threshold_id") != threshold_id:
            continue
        try:
            raw = m["created_at"]
            ts = datetime.fromisoformat(raw.replace("Z", "+00:00")) if isinstance(raw, str) else raw
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if latest is None or ts > latest:
            latest = ts
    if latest is None:
        return None
    return (now - latest).total_seconds()


def _wait_for_dedupe_clear(client, threshold_id, buffer=3):
    """Sleep until the 60s dedupe window has cleared for this threshold_id."""
    ago = _last_fire_seconds_ago(client, threshold_id)
    if ago is not None and ago < 60:
        wait_s = 60 - ago + buffer
        print(f"  [dedupe] {threshold_id} fired {ago:.1f}s ago; sleeping {wait_s:.1f}s...")
        time.sleep(wait_s)


def _verify_rule_fires_fresh(client, sheet_key, values, threshold_id, expected_msg_substr=None):
    """Wait for dedupe window to clear, then fire; assert the POST response
    contains the expected threshold_id AND (optionally) the sheet-specific msg."""
    _wait_for_dedupe_clear(client, threshold_id)
    data = _post_eval(client, sheet_key, values)
    fired = {a["threshold_id"]: a["msg"] for a in data.get("alerts", [])}
    if threshold_id not in fired:
        return False, f"alerts did not include {threshold_id}: got {list(fired.keys())}"
    if expected_msg_substr and expected_msg_substr not in fired[threshold_id]:
        return False, f"msg mismatch: expected substr '{expected_msg_substr}' in '{fired[threshold_id]}'"
    return True, "ok"


# ==== NEW METRIC-NATIVE THRESHOLDS ====
# Each of the six new rules is verified with a fresh dedupe window so that
# sibling sheets (which share threshold_id) both get exercised.

class TestNewMetricThresholds:
    def test_ct_milling_density_hi(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "CT_Milling", {"density_ppg": 16.5}, "density_hi",
            expected_msg_substr="1798 kg/m³",
        )
        assert ok, why

    def test_ct_milling_rate_hi(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "CT_Milling", {"rate_bpm": 7.5}, "rate_hi",
            expected_msg_substr="milling",
        )
        assert ok, why

    def test_ct_drilling_rop_hi(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "CT_Drilling", {"rop_ftph": 150}, "rop_hi",
        )
        assert ok, why

    def test_frac_through_ct_density_hi(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "Frac_Through_CT", {"density_ppg": 13}, "density_hi",
            expected_msg_substr="Frac fluid",
        )
        assert ok, why

    def test_annular_frac_surfp_hi(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "Annular_Frac", {"surfp": 5500}, "surfp_hi",
            expected_msg_substr="Annular treating pressure",
        )
        assert ok, why

    def test_sand_cleanout_rate_hi(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "Sand_Cleanout", {"rate_bpm": 6}, "rate_hi",
            expected_msg_substr="Cleanout",
        )
        assert ok, why


# ==== REGRESSION — Original thresholds ====

class TestRegressionThresholds:
    def test_ct_milling_wob_high(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "CT_Milling", {"rih": 20000, "tagged": 17000}, "wob_high",
        )
        assert ok, why

    def test_ct_milling_wob_neg(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "CT_Milling", {"rih": 15000, "tagged": 16000}, "wob_neg",
        )
        assert ok, why

    def test_ct_drilling_wob_high(self, client):
        # Same threshold_id as CT_Milling wob_high → wait for dedupe.
        ok, why = _verify_rule_fires_fresh(
            client, "CT_Drilling", {"rih": 22000, "tagged": 19000}, "wob_high",
        )
        assert ok, why

    def test_frac_through_ct_surfp_hi(self, client):
        # Sibling of Annular_Frac surfp_hi → wait for dedupe.
        ok, why = _verify_rule_fires_fresh(
            client, "Frac_Through_CT", {"surfp": 11000}, "surfp_hi",
            expected_msg_substr="10,000 psi",
        )
        assert ok, why

    def test_sand_cleanout_vann_low(self, client):
        ok, why = _verify_rule_fires_fresh(
            client, "Sand_Cleanout", {"vann_ftmin": 60}, "vann_low",
        )
        assert ok, why


# ==== DEDUPE ====

class TestDedupe:
    def test_60s_dedupe_same_threshold(self, client):
        """Second call with same threshold_id within 60s returns empty alerts."""
        # Use a rare threshold that's unlikely to have been fired: Annular_Frac surfp_hi
        # But we don't know—so fire it once (may or may not add), then fire again → must be empty.
        _post_eval(client, "Annular_Frac", {"surfp": 5500})
        # Second call — guaranteed deduped
        r2 = _post_eval(client, "Annular_Frac", {"surfp": 5500})
        assert r2["alerts"] == [], f"Expected empty alerts on repeat, got {r2['alerts']}"


# ==== Auth / shape ====

class TestShape:
    def test_returns_200_and_alerts_list(self, client):
        data = _post_eval(client, "CT_Milling", {"rih": 15000, "tagged": 15000})
        assert "alerts" in data
        assert isinstance(data["alerts"], list)

    def test_unknown_sheet_key_no_crash(self, client):
        data = _post_eval(client, "Nonexistent_Sheet", {"anything": 1})
        assert data["alerts"] == []

    def test_requires_auth(self):
        s = requests.Session()  # no cookie
        r = s.post(
            f"{BASE_URL}/api/crew/safety-eval",
            json={"sheet_key": "CT_Milling", "values": {"rih": 20000, "tagged": 17000}},
            timeout=10,
        )
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"
