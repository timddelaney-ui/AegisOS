"""Iter 27 — Crew contacts & one-click shift-end handover email."""
import io
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
DEMO_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture
def json_headers():
    return {"Cookie": f"session_token={DEMO_TOKEN}", "Content-Type": "application/json"}


def _cleanup_contacts(json_headers):
    rows = requests.get(f"{BASE_URL}/api/crew/contacts", headers=json_headers).json()
    for c in rows.get("contacts", []):
        if c.get("name", "").startswith("iter27_"):
            requests.delete(f"{BASE_URL}/api/crew/contacts/{c['contact_id']}", headers=json_headers)


def test_contact_create_requires_valid_email(json_headers):
    r = requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers,
                      json={"name": "iter27_A", "email": "not-an-email"})
    assert r.status_code == 400


def test_contact_create_rejects_empty_name(json_headers):
    r = requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers,
                      json={"name": "   ", "email": "a@b.com"})
    assert r.status_code == 400


def test_contact_duplicate_email_rejected(json_headers):
    _cleanup_contacts(json_headers)
    r = requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers,
                      json={"name": "iter27_dup", "email": "iter27_dup@example.com"})
    assert r.status_code == 200
    try:
        r2 = requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers,
                           json={"name": "iter27_dup_B", "email": "iter27_dup@example.com"})
        assert r2.status_code == 409
    finally:
        _cleanup_contacts(json_headers)


def test_contact_full_crud(json_headers):
    _cleanup_contacts(json_headers)
    try:
        r = requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers, json={
            "name": "iter27_sup", "email": "iter27_sup@example.com",
            "role": "Day-shift Supervisor", "is_default_recipient": True,
        })
        cid = r.json()["contact_id"]
        # list
        lst = requests.get(f"{BASE_URL}/api/crew/contacts", headers=json_headers).json()
        assert any(c["contact_id"] == cid for c in lst["contacts"])
        # patch
        r2 = requests.patch(f"{BASE_URL}/api/crew/contacts/{cid}", headers=json_headers,
                             json={"is_default_recipient": False, "role": "Night-shift Supervisor"})
        assert r2.status_code == 200
        assert r2.json()["is_default_recipient"] is False
        assert r2.json()["role"] == "Night-shift Supervisor"
    finally:
        _cleanup_contacts(json_headers)


def test_shift_end_preview(json_headers):
    """Preview endpoint returns body + resolved recipients + from_display, no key needed."""
    _cleanup_contacts(json_headers)
    try:
        requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers, json={
            "name": "iter27_pre", "email": "iter27_pre@example.com", "is_default_recipient": True,
        })
        r = requests.post(f"{BASE_URL}/api/crew/shift-end-preview", headers=json_headers, json={
            "rig_id": "RIG1", "hours": 12,
        })
        assert r.status_code == 200
        d = r.json()
        assert "iter27_pre@example.com" in d["recipients"]
        assert "SHIFT-END HANDOVER" in d["body_text"]
        assert d["from_display"].startswith("Demo Pro User via CT Pocket")
        assert d["reply_to"] == "demo.pro@example.com"
        # Preview must NOT require a Resend key; configured flag reports accurately
        assert isinstance(d["configured"], bool)
    finally:
        _cleanup_contacts(json_headers)


def test_shift_end_requires_recipients(json_headers):
    _cleanup_contacts(json_headers)
    # no defaults, no extras → 400
    r = requests.post(f"{BASE_URL}/api/crew/shift-end-handover", headers=json_headers, json={
        "rig_id": "RIG1", "hours": 12,
    })
    assert r.status_code == 400


def test_shift_end_returns_503_without_key(json_headers):
    """When RESEND_API_KEY is missing, shift-end-handover returns a graceful 503."""
    _cleanup_contacts(json_headers)
    try:
        requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers, json={
            "name": "iter27_503", "email": "iter27_503@example.com", "is_default_recipient": True,
        })
        r = requests.post(f"{BASE_URL}/api/crew/shift-end-handover", headers=json_headers, json={
            "rig_id": "RIG1", "hours": 12,
        })
        # If no key configured in this env — 503. If configured — 200.
        assert r.status_code in (200, 503)
        if r.status_code == 503:
            assert "configured" in r.json().get("detail", "").lower()
    finally:
        _cleanup_contacts(json_headers)


def test_shift_end_body_structure(json_headers):
    _cleanup_contacts(json_headers)
    try:
        requests.post(f"{BASE_URL}/api/crew/contacts", headers=json_headers, json={
            "name": "iter27_s", "email": "iter27_s@example.com", "is_default_recipient": True,
        })
        r = requests.post(f"{BASE_URL}/api/crew/shift-end-preview", headers=json_headers, json={
            "rig_id": "RIG1", "hours": 24,
        })
        body = r.json()["body_text"]
        # The three mandatory sections
        assert "TREATMENT / OPERATIONS LOG" in body
        assert "CREW CHAT" in body
        assert "OPEN TO-DOS" in body
        assert "— End of handover —" in body
    finally:
        _cleanup_contacts(json_headers)


def test_unauth_rejected():
    r = requests.get(f"{BASE_URL}/api/crew/contacts")
    assert r.status_code == 401
    r2 = requests.post(f"{BASE_URL}/api/crew/shift-end-handover", json={"rig_id": "RIG1"})
    assert r2.status_code == 401
