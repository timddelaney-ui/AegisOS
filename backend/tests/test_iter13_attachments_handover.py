"""Iter 13 — Attachments (Object Storage) + Handover Summary alerts removal regression."""
import io
import os
import struct
import zlib
import pytest
import requests

def _resolve_base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not v:
        try:
            for line in open("/app/frontend/.env"):
                if line.startswith("REACT_APP_BACKEND_URL="):
                    v = line.split("=", 1)[1].strip()
                    break
        except Exception:
            pass
    return v.rstrip("/")


BASE_URL = _resolve_base_url()
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"

DEMO_SESSION = "demo_session_dade4ac57f0c496094fde437e8e91f00"


def _png_bytes(width=8, height=8):
    """Return a minimal valid PNG."""
    def _chunk(tag, data):
        return (
            struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b""
    for _ in range(height):
        raw += b"\x00" + b"\xff\x00\x00" * width
    idat = zlib.compress(raw)
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def demo_client():
    s = requests.Session()
    s.cookies.set("session_token", DEMO_SESSION)
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Demo session invalid: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def uploaded_attachment(demo_client):
    """Upload a PNG once and reuse across tests."""
    files = {"file": ("test.png", _png_bytes(), "image/png")}
    data = {"context": "equipment", "context_ref": "eq_test", "rig_id": "RIG1"}
    r = demo_client.post(f"{BASE_URL}/api/attachments", files=files, data=data, timeout=30)
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("attachment_id", "").startswith("att_")
    assert body.get("kind") == "image"
    assert body.get("size", 0) > 0
    assert body.get("download_url", "").startswith("/api/attachments/")
    return body


# ============ ATTACHMENTS ============
class TestAttachments:
    def test_upload_png(self, uploaded_attachment):
        assert uploaded_attachment["content_type"] == "image/png"
        assert uploaded_attachment["context"] == "equipment"

    def test_list_returns_uploaded(self, demo_client, uploaded_attachment):
        r = demo_client.get(
            f"{BASE_URL}/api/attachments",
            params={"context": "equipment", "context_ref": "eq_test"},
            timeout=15,
        )
        assert r.status_code == 200
        ids = [a["attachment_id"] for a in r.json()["attachments"]]
        assert uploaded_attachment["attachment_id"] in ids

    def test_download_cookie_auth(self, demo_client, uploaded_attachment):
        r = demo_client.get(
            f"{BASE_URL}/api/attachments/{uploaded_attachment['attachment_id']}/download",
            timeout=30,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")
        assert len(r.content) > 0

    def test_download_query_auth(self, uploaded_attachment):
        # No cookies; use ?auth=<session_token>
        r = requests.get(
            f"{BASE_URL}/api/attachments/{uploaded_attachment['attachment_id']}/download",
            params={"auth": DEMO_SESSION},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")

    def test_size_cap_413(self, demo_client):
        big = b"\x00" * (15 * 1024 * 1024 + 100)
        files = {"file": ("big.png", big, "image/png")}
        data = {"context": "equipment", "context_ref": "eq_test"}
        r = demo_client.post(f"{BASE_URL}/api/attachments", files=files, data=data, timeout=60)
        assert r.status_code == 413, f"expected 413, got {r.status_code} {r.text[:200]}"

    def test_mime_cap_400_exe(self, demo_client):
        files = {"file": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")}
        data = {"context": "equipment", "context_ref": "eq_test"}
        r = demo_client.post(f"{BASE_URL}/api/attachments", files=files, data=data, timeout=15)
        assert r.status_code == 400
        assert "Unsupported" in r.text or "type" in r.text.lower()

    def test_mime_cap_400_txt(self, demo_client):
        files = {"file": ("note.txt", b"hi", "text/plain")}
        data = {"context": "chat", "context_ref": "RIG1"}
        r = demo_client.post(f"{BASE_URL}/api/attachments", files=files, data=data, timeout=15)
        assert r.status_code == 400

    def test_download_unauth_401(self, uploaded_attachment):
        r = requests.get(
            f"{BASE_URL}/api/attachments/{uploaded_attachment['attachment_id']}/download",
            timeout=15,
        )
        assert r.status_code == 401

    def test_delete_soft_and_404(self, demo_client):
        # Upload dedicated one to delete
        files = {"file": ("todel.png", _png_bytes(), "image/png")}
        data = {"context": "equipment", "context_ref": "eq_test_del"}
        r = demo_client.post(f"{BASE_URL}/api/attachments", files=files, data=data, timeout=30)
        assert r.status_code == 200
        aid = r.json()["attachment_id"]

        # Delete
        r = demo_client.delete(f"{BASE_URL}/api/attachments/{aid}", timeout=15)
        assert r.status_code == 200
        assert r.json().get("success") is True

        # Download now 404
        r = demo_client.get(f"{BASE_URL}/api/attachments/{aid}/download", timeout=15)
        assert r.status_code == 404

        # List excludes it
        r = demo_client.get(
            f"{BASE_URL}/api/attachments",
            params={"context": "equipment", "context_ref": "eq_test_del"},
            timeout=15,
        )
        assert r.status_code == 200
        ids = [a["attachment_id"] for a in r.json()["attachments"]]
        assert aid not in ids


# ============ HANDOVER SUMMARY — alerts removed ============
class TestHandoverSummary:
    def test_alerts_always_empty(self, demo_client):
        r = demo_client.get(f"{BASE_URL}/api/crew/handover-summary?rig_id=RIG1&hours=24", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "alerts" in body
        assert body["alerts"] == [], f"expected empty alerts, got {body['alerts']}"
        # Regression: other sections still present
        for k in ("completed_tasks", "inventory_flags", "chat_notes"):
            assert k in body, f"missing {k}"


# ============ REGRESSION — prior endpoints still work ============
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/api/equipment",
        "/api/schedule",
        "/api/crew/chat",
        "/api/manager/dashboard",
        "/api/team/items/inventory",
    ])
    def test_endpoint_ok(self, demo_client, path):
        r = demo_client.get(f"{BASE_URL}{path}", timeout=20)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
