"""Iter 26 — Company Documents + ERP Templates + AI doc-injection."""
import io
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
_env = {}
with open("/app/backend/.env") as fh:
    for line in fh:
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.strip().partition("=")
            _env[k] = v.strip().strip('"').strip("'")
MONGO_URL = _env.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = _env.get("DB_NAME", "test_database")
DEMO_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL); yield c[DB_NAME]; c.close()


@pytest.fixture
def auth_headers():
    return {"Cookie": f"session_token={DEMO_TOKEN}"}


@pytest.fixture
def json_headers():
    return {"Cookie": f"session_token={DEMO_TOKEN}", "Content-Type": "application/json"}


def _tiny_pdf():
    return io.BytesIO(b"%PDF-1.4\n%fake test pdf\n%%EOF\n")


# ===== Documents =====
def test_doc_upload_invalid_category(auth_headers):
    r = requests.post(f"{BASE_URL}/api/documents", headers=auth_headers,
                      files={"file": ("x.pdf", _tiny_pdf(), "application/pdf")},
                      data={"name": "x", "category": "bogus"})
    assert r.status_code == 400


def test_doc_upload_bad_extension(auth_headers):
    r = requests.post(f"{BASE_URL}/api/documents", headers=auth_headers,
                      files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/x-msdownload")},
                      data={"name": "x", "category": "sop"})
    assert r.status_code == 400


def test_doc_full_lifecycle(auth_headers):
    r = requests.post(f"{BASE_URL}/api/documents", headers=auth_headers,
                      files={"file": ("sop.pdf", _tiny_pdf(), "application/pdf")},
                      data={"name": "iter26 test SOP", "category": "sop",
                            "description": "test", "tags": "unit,test"})
    assert r.status_code == 200, r.text
    did = r.json()["doc_id"]
    try:
        # list
        r2 = requests.get(f"{BASE_URL}/api/documents", headers=auth_headers)
        assert r2.status_code == 200
        assert any(d["doc_id"] == did for d in r2.json()["documents"])
        # patch
        r3 = requests.patch(f"{BASE_URL}/api/documents/{did}",
                             headers={**auth_headers, "Content-Type": "application/json"},
                             json={"description": "updated"})
        assert r3.status_code == 200
        assert r3.json()["description"] == "updated"
        # download
        r4 = requests.get(f"{BASE_URL}/api/documents/{did}/download", headers=auth_headers)
        assert r4.status_code == 200
        assert r4.headers.get("Content-Type", "").startswith("application/pdf")
    finally:
        requests.delete(f"{BASE_URL}/api/documents/{did}", headers=auth_headers)


def test_doc_outsider_cannot_download(mongo, auth_headers):
    """Create a doc on demo team; outsider in no team cannot access it."""
    r = requests.post(f"{BASE_URL}/api/documents", headers=auth_headers,
                      files={"file": ("sop.pdf", _tiny_pdf(), "application/pdf")},
                      data={"name": "iter26 private", "category": "sop"})
    did = r.json()["doc_id"]
    uid = f"iter26_u_{uuid.uuid4().hex[:8]}"
    tok = f"iter26_sess_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": uid, "email": f"{uid}@example.com", "name": "Outsider",
        "team_id": None, "subscription_status": "active",
        "created_at": datetime.now(timezone.utc),
    })
    mongo.user_sessions.insert_one({
        "session_token": tok, "user_id": uid, "email": f"{uid}@example.com",
        "expires_at": datetime.now(timezone.utc).replace(year=2099),
    })
    try:
        o = {"Cookie": f"session_token={tok}"}
        r2 = requests.get(f"{BASE_URL}/api/documents/{did}/download", headers=o)
        assert r2.status_code == 403
        # List returns empty for outsider (no team)
        r3 = requests.get(f"{BASE_URL}/api/documents", headers=o)
        assert r3.status_code == 200
        assert r3.json()["documents"] == []
    finally:
        requests.delete(f"{BASE_URL}/api/documents/{did}", headers=auth_headers)
        mongo.users.delete_one({"user_id": uid})
        mongo.user_sessions.delete_one({"session_token": tok})


# ===== ERP Templates =====
def test_erp_template_required_well_name(json_headers):
    r = requests.post(f"{BASE_URL}/api/erp-templates", headers=json_headers,
                      json={"well_name": "   "})
    assert r.status_code == 400


def test_erp_template_crud(json_headers):
    r = requests.post(f"{BASE_URL}/api/erp-templates", headers=json_headers, json={
        "well_name": "iter26 well", "rig_id": "7", "operation": "UBD",
        "muster_point": "100 m upwind", "h2s_zone": True,
        "nearest_hospital_name": "RMH"})
    assert r.status_code == 200
    tid = r.json()["template_id"]
    try:
        # get
        r2 = requests.get(f"{BASE_URL}/api/erp-templates/{tid}", headers=json_headers)
        assert r2.status_code == 200
        assert r2.json()["well_name"] == "iter26 well"
        # patch
        r3 = requests.patch(f"{BASE_URL}/api/erp-templates/{tid}",
                             headers=json_headers, json={"supervisor_name": "J. Smith"})
        assert r3.status_code == 200
        assert r3.json()["supervisor_name"] == "J. Smith"
        # list
        r4 = requests.get(f"{BASE_URL}/api/erp-templates", headers=json_headers)
        assert any(t["template_id"] == tid for t in r4.json())
    finally:
        requests.delete(f"{BASE_URL}/api/erp-templates/{tid}", headers=json_headers)


def test_erp_unauth():
    r = requests.get(f"{BASE_URL}/api/erp-templates")
    assert r.status_code == 401
    r2 = requests.post(f"{BASE_URL}/api/erp-templates", json={"well_name": "x"})
    assert r2.status_code == 401


# ===== AI document injection =====
def test_ai_sop_erp_references_uploaded_doc(auth_headers, json_headers):
    """When a team doc exists, the sop_erp AI should cite it BY NAME."""
    unique_name = f"PyTest-AcmeCo-UBD-SOP-{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{BASE_URL}/api/documents", headers=auth_headers,
                      files={"file": ("sop.pdf", _tiny_pdf(), "application/pdf")},
                      data={"name": unique_name, "category": "sop",
                            "description": "Operator-specific CT UBD drill-out SOP"})
    did = r.json()["doc_id"]
    try:
        resp = requests.post(f"{BASE_URL}/api/ai/chat", headers=json_headers, timeout=90, json={
            "mode": "sop_erp",
            "message": "What company SOPs cover this operation?",
            "context": {"drilling_mode": "underbalanced",
                        "inputs": "UBD drill-out at 5000 ft TVD"},
        })
        assert resp.status_code == 200
        body = resp.json().get("response", "")
        # The AI must reference the uploaded doc BY the exact unique name
        assert unique_name in body, (
            f"AI response did not reference '{unique_name}':\n{body[:1200]}"
        )
    finally:
        requests.delete(f"{BASE_URL}/api/documents/{did}", headers=auth_headers)
