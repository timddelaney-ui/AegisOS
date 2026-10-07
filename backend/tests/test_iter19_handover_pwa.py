"""Iter 19 — Handover email endpoint + PWA static asset tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ct-workbook-sim.preview.emergentagent.com").rstrip("/")
SESSION = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture
def client():
    s = requests.Session()
    s.cookies.set("session_token", SESSION)
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- /api/crew/handover-email ----------
class TestHandoverEmail:
    def _payload(self, **over):
        p = {
            "rig_id": "RIG1",
            "hours": 12,
            "recipients": ["a@b.com"],
            "body_text": "Handover body text here",
        }
        p.update(over)
        return p

    def test_missing_key_returns_503(self, client):
        r = client.post(f"{BASE_URL}/api/crew/handover-email", json=self._payload())
        assert r.status_code == 503, r.text
        detail = r.json().get("detail", "")
        assert "Email sending isn't configured" in detail

    def test_empty_recipients_returns_400(self, client):
        r = client.post(f"{BASE_URL}/api/crew/handover-email", json=self._payload(recipients=[]))
        assert r.status_code == 400
        assert "at least one valid email" in r.json().get("detail", "")

    def test_only_invalid_recipients_returns_400(self, client):
        r = client.post(f"{BASE_URL}/api/crew/handover-email", json=self._payload(recipients=["notanemail", "foo"]))
        assert r.status_code == 400
        assert "at least one valid email" in r.json().get("detail", "")

    def test_too_many_recipients_returns_400(self, client):
        emails = [f"user{i}@x.com" for i in range(6)]
        r = client.post(f"{BASE_URL}/api/crew/handover-email", json=self._payload(recipients=emails))
        assert r.status_code == 400
        assert "Max 5 recipients" in r.json().get("detail", "")

    def test_empty_body_text_returns_400(self, client):
        r = client.post(f"{BASE_URL}/api/crew/handover-email", json=self._payload(body_text="   "))
        assert r.status_code == 400
        assert "body is empty" in r.json().get("detail", "")

    def test_valid_dedupe_passes_validation(self, client):
        # Mix valid + invalid + duplicate → should pass validation, then hit 503 (no key)
        r = client.post(f"{BASE_URL}/api/crew/handover-email", json=self._payload(
            recipients=["a@b.com", "A@B.COM", "notanemail", "c@d.com"]
        ))
        # Reached config check means validation accepted dedup+valids
        assert r.status_code == 503, f"Expected 503 (config), got {r.status_code}: {r.text}"


# ---------- PWA ----------
class TestPWA:
    def test_manifest(self):
        r = requests.get(f"{BASE_URL}/manifest.json")
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "json" in ct or "text/plain" in ct, ct
        data = r.json()
        assert data["start_url"] == "/hub"
        assert data["display"] == "standalone"
        assert data["theme_color"] == "#0D6535"
        sizes = {i["sizes"] for i in data["icons"]}
        assert {"192x192", "512x512"}.issubset(sizes)
        shorts = {s["short_name"] for s in data.get("shortcuts", [])}
        assert {"Treatment", "Schedule", "Workbook"}.issubset(shorts)

    def test_service_worker(self):
        r = requests.get(f"{BASE_URL}/service-worker.js")
        assert r.status_code == 200
        assert "javascript" in r.headers.get("content-type", "").lower() or len(r.text) > 100

    @pytest.mark.parametrize("asset", [
        "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png",
    ])
    def test_icons(self, asset):
        r = requests.get(f"{BASE_URL}{asset}")
        assert r.status_code == 200, f"{asset} -> {r.status_code}"
        assert r.headers.get("content-type", "").startswith("image/png"), r.headers.get("content-type")
