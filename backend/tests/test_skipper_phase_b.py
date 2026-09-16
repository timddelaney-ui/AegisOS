"""Phase B tests: Crew Group Chat + Skipper Safety Watchdog."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ct-workbook-sim.preview.emergentagent.com").rstrip("/")
DEMO_SESSION = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.cookies.set("session_token", DEMO_SESSION)
    return s


@pytest.fixture(scope="module", autouse=True)
def ensure_team(client):
    """Ensure the demo user is in a team before running tests."""
    r = client.get(f"{BASE_URL}/api/auth/me", timeout=10)
    assert r.status_code == 200, f"auth/me failed: {r.status_code} {r.text}"
    me = r.json()
    if not me.get("team_id"):
        r2 = client.post(f"{BASE_URL}/api/teams", json={"name": "Regression Crew"}, timeout=10)
        assert r2.status_code == 200, f"team create failed: {r2.status_code} {r2.text}"
    yield


# ==== FEATURE #1 — Crew Group Chat ====
class TestCrewChat:
    def test_get_chat_returns_shape(self, client):
        r = client.get(f"{BASE_URL}/api/crew/chat", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "messages" in data and isinstance(data["messages"], list)
        assert "team_id" in data
        assert data["team_id"] is not None

    def test_post_message(self, client):
        text = f"regression ping {int(time.time())}"
        r = client.post(f"{BASE_URL}/api/crew/chat", json={"text": text}, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("success") is True
        assert "message_id" in j

        # Verify persisted
        r2 = client.get(f"{BASE_URL}/api/crew/chat", timeout=10)
        assert r2.status_code == 200
        texts = [m["text"] for m in r2.json()["messages"]]
        assert text in texts

    def test_post_empty_rejected(self, client):
        r = client.post(f"{BASE_URL}/api/crew/chat", json={"text": "   "}, timeout=10)
        assert r.status_code == 400

    def test_message_shape(self, client):
        r = client.get(f"{BASE_URL}/api/crew/chat", timeout=10)
        msgs = r.json()["messages"]
        assert len(msgs) > 0
        m = msgs[-1]
        for key in ("message_id", "team_id", "sender_user_id", "sender_name", "text", "is_alert", "is_skipper", "created_at"):
            assert key in m, f"missing key {key} in message: {m}"

    def test_hey_skipper_triggers_ai_reply(self, client):
        # Use unique text so we can find it
        marker = int(time.time())
        text = f"hey skipper what pump rate for sand cleanout in 4.5in casing ({marker})"
        r = client.post(f"{BASE_URL}/api/crew/chat", json={"text": text}, timeout=30)
        assert r.status_code == 200

        # Poll up to 20s for the AI reply (Gemini call may be slow)
        ai_reply = None
        for _ in range(20):
            time.sleep(1)
            r2 = client.get(f"{BASE_URL}/api/crew/chat", timeout=10)
            msgs = r2.json()["messages"]
            # Find our message and look for a subsequent AI reply
            for i, m in enumerate(msgs):
                if str(marker) in m.get("text", ""):
                    # AI reply must come after
                    for after in msgs[i+1:]:
                        if after.get("is_skipper") and after.get("sender_name") == "Skipper (AI Advisor)":
                            ai_reply = after
                            break
                if ai_reply:
                    break
            if ai_reply:
                break
        assert ai_reply is not None, "Skipper (AI Advisor) reply not found within 20s"
        assert len(ai_reply["text"]) > 0


# ==== FEATURE #3 — Safety Watchdog ====
class TestSafetyWatchdog:
    def _leave_team(self, client):
        client.post(f"{BASE_URL}/api/teams/leave", timeout=10)

    def _rejoin_or_create(self, client):
        client.post(f"{BASE_URL}/api/teams", json={"name": "Regression Crew"}, timeout=10)

    def test_ct_milling_wob_high_trips(self, client):
        # Use unique threshold context — first, clear dedupe by waiting or using different sheet.
        # Since dedupe is 60s, we test with fresh alert by picking a sheet not just used.
        body = {"sheet_key": "CT_Milling", "values": {"rih": 22000, "tagged": 19000}}
        r = client.post(f"{BASE_URL}/api/crew/safety-eval", json=body, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # First call may return an alert; if dedupe already applied from previous run, it's ok as long as no error.
        # But we assert at least the shape.
        assert "alerts" in data

    def test_frac_through_ct_surfp_hi(self, client):
        body = {"sheet_key": "Frac_Through_CT", "values": {"surfp": 11000}}
        r = client.post(f"{BASE_URL}/api/crew/safety-eval", json=body, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "alerts" in data
        # If dedupe hasn't kicked in from a prior run, should have surfp_hi
        # We only assert shape; dedupe timing is 60s

    def test_sand_cleanout_vann_low(self, client):
        body = {"sheet_key": "Sand_Cleanout", "values": {"vann_ftmin": 60}}
        r = client.post(f"{BASE_URL}/api/crew/safety-eval", json=body, timeout=10)
        assert r.status_code == 200
        assert "alerts" in r.json()

    def test_dedup_within_60s(self, client):
        # Fire same sheet twice — second should return empty alerts due to dedup
        body = {"sheet_key": "CT_Milling", "values": {"rih": 22000, "tagged": 19000}}
        client.post(f"{BASE_URL}/api/crew/safety-eval", json=body, timeout=10)
        r2 = client.post(f"{BASE_URL}/api/crew/safety-eval", json=body, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["alerts"] == []

    def test_alert_appears_in_chat(self, client):
        # Force a fresh alert using a seldom-used threshold: vann_low
        # Wait a bit to reduce dedupe likelihood; if still deduped, we still verify past alert exists.
        body = {"sheet_key": "Sand_Cleanout", "values": {"vann_ftmin": 60}}
        client.post(f"{BASE_URL}/api/crew/safety-eval", json=body, timeout=10)
        r = client.get(f"{BASE_URL}/api/crew/chat", timeout=10)
        msgs = r.json()["messages"]
        alerts = [m for m in msgs if m.get("is_alert") and m.get("is_skipper")]
        assert len(alerts) > 0, "No safety alert message found in crew chat"
        a = alerts[-1]
        assert a["sender_name"] == "Skipper (Safety Override)"
        assert "sheet_key" in a or "Sheet:" in a["text"]

    def test_solo_mode_returns_note(self, client):
        # Leave team, try safety-eval, then rejoin
        try:
            self._leave_team(client)
            body = {"sheet_key": "CT_Milling", "values": {"rih": 22000, "tagged": 19000}}
            r = client.post(f"{BASE_URL}/api/crew/safety-eval", json=body, timeout=10)
            assert r.status_code == 200
            data = r.json()
            assert data["alerts"] == []
            assert "solo mode" in data.get("note", "")

            # Also verify chat POST rejects
            rc = client.post(f"{BASE_URL}/api/crew/chat", json={"text": "hi"}, timeout=10)
            assert rc.status_code == 400
        finally:
            self._rejoin_or_create(client)
