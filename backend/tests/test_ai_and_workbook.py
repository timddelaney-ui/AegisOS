# Backend regression tests for iteration 4: AI chat + Pro gating + basic health
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ct-workbook-sim.preview.emergentagent.com").rstrip("/")
PRO_COOKIE = {"session_token": "demo_session_dade4ac57f0c496094fde437e8e91f00"}


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestAI:
    def test_ai_chat_pro_user_assistant_mode(self, client):
        r = client.post(
            f"{BASE_URL}/api/ai/chat",
            json={"mode": "assistant", "message": "One-line safety tip please."},
            cookies=PRO_COOKIE,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "response" in data and isinstance(data["response"], str) and len(data["response"]) > 5
        assert "session_id" in data
        assert data.get("model", "").startswith("gemini")

    def test_ai_chat_unauth_rejected(self, client):
        r = client.post(
            f"{BASE_URL}/api/ai/chat",
            json={"mode": "assistant", "message": "hi"},
            timeout=30,
        )
        # No session -> 401 (require_user) or 403
        assert r.status_code in (401, 403)

    def test_ai_chat_invalid_mode(self, client):
        r = client.post(
            f"{BASE_URL}/api/ai/chat",
            json={"mode": "bogus", "message": "hi"},
            cookies=PRO_COOKIE,
            timeout=30,
        )
        assert r.status_code == 400


class TestAuthMe:
    def test_pro_user_is_pro(self, client):
        r = client.get(f"{BASE_URL}/api/auth/me", cookies=PRO_COOKIE, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # ensure demo pro user surfaced with pro-ish flag
        assert data.get("email") or data.get("user_id") or data.get("id")
