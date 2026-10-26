"""Iter 28 — Shift-end SMS preview/send API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
DEMO_TOKEN = os.environ.get("DEMO_SESSION_TOKEN", "demo_session_dade4ac57f0c496094fde437e8e91f00")


@pytest.fixture
def json_headers():
    return {"Cookie": f"session_token={DEMO_TOKEN}", "Content-Type": "application/json"}


def _cleanup_contacts(json_headers):
    rows = requests.get(f"{BASE_URL}/api/crew/contacts", headers=json_headers).json()
    for c in rows.get("contacts", []):
        if c.get("name", "").startswith("iter28_"):
            requests.delete(f"{BASE_URL}/api/crew/contacts/{c['contact_id']}", headers=json_headers)


def test_contact_can_store_phone(json_headers):
    _cleanup_contacts(json_headers)
    marker = uuid.uuid4().hex[:6]
    try:
        r = requests.post(
            f"{BASE_URL}/api/crew/contacts",
            headers=json_headers,
            json={
                "name": f"iter28_{marker}",
                "email": f"iter28_{marker}@example.com",
                "phone": "+14035551234",
                "is_default_recipient": True,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json().get("phone") == "+14035551234"
    finally:
        _cleanup_contacts(json_headers)


def test_sms_preview_resolves_numbers(json_headers):
    _cleanup_contacts(json_headers)
    marker = uuid.uuid4().hex[:6]
    try:
        requests.post(
            f"{BASE_URL}/api/crew/contacts",
            headers=json_headers,
            json={
                "name": f"iter28_{marker}",
                "email": f"iter28_{marker}@example.com",
                "phone": "+14035550001",
                "is_default_recipient": True,
            },
        )
        r = requests.post(
            f"{BASE_URL}/api/crew/shift-end-sms-preview",
            headers=json_headers,
            json={"rig_id": "RIG1", "hours": 12, "extra_numbers": ["+14035550002"]},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.get("numbers", [])) >= {"+14035550001", "+14035550002"}
        assert "SHIFT-END HANDOVER" in data.get("body_text", "")
        assert isinstance(data.get("configured"), bool)
    finally:
        _cleanup_contacts(json_headers)


def test_sms_send_requires_config_when_numbers_exist(json_headers):
    _cleanup_contacts(json_headers)
    marker = uuid.uuid4().hex[:6]
    try:
        requests.post(
            f"{BASE_URL}/api/crew/contacts",
            headers=json_headers,
            json={
                "name": f"iter28_{marker}",
                "email": f"iter28_{marker}@example.com",
                "phone": "+14035550011",
                "is_default_recipient": True,
            },
        )
        r = requests.post(
            f"{BASE_URL}/api/crew/shift-end-sms",
            headers=json_headers,
            json={"rig_id": "RIG1", "hours": 12},
        )
        assert r.status_code in (200, 503), r.text
        if r.status_code == 503:
            assert "SMS sending isn't configured yet" in r.json().get("detail", "")
    finally:
        _cleanup_contacts(json_headers)

