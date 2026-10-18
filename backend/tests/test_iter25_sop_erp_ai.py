"""Iteration 25 — AI SOP/ERP mode with scenario context."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
DEMO_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture
def auth_headers():
    return {"Cookie": f"session_token={DEMO_TOKEN}", "Content-Type": "application/json"}


def test_sop_erp_mode_registered(auth_headers):
    """Reject an unknown mode but accept sop_erp."""
    r = requests.post(f"{BASE_URL}/api/ai/chat", headers=auth_headers,
                      json={"mode": "nonsense_mode", "message": "hi"})
    assert r.status_code == 400
    assert "Invalid mode" in r.json().get("detail", "")


def test_sop_erp_returns_structured_response(auth_headers):
    """SOP/ERP responses MUST include ACTION NOW, SOP CHECKLIST, ERP TRIGGERS sections."""
    body = {
        "mode": "sop_erp",
        "message": "Build the SOP + ERP for this scenario",
        "context": {
            "sheet_key": "CT_DRILLING_CALC",
            "drilling_mode": "underbalanced",
            "unit_system": "imp",
            "inputs": "TVD=5000ft, N2=900 SCFM, Qliq=1.5 BPM, rho=8.6 ppg",
            "results": "BHP 707 psi; UB 1618 psi; ECD 2.72 ppg; GLR 600 SCF/bbl",
            "warnings": "[warn] severe underbalance; [warn] low annular velocity",
            "standards_focus": "AER Directive 008, IADC UBO/MPD Handbook",
        },
    }
    r = requests.post(f"{BASE_URL}/api/ai/chat", headers=auth_headers, json=body, timeout=90)
    assert r.status_code == 200, r.text
    resp = r.json().get("response", "")
    upper = resp.upper()
    # The three required sections
    assert "ACTION NOW" in upper, f"Missing ACTION NOW:\n{resp[:800]}"
    assert "SOP CHECKLIST" in upper, f"Missing SOP CHECKLIST:\n{resp[:800]}"
    assert "ERP TRIGGERS" in upper, f"Missing ERP TRIGGERS:\n{resp[:800]}"
    # Must cite at least one AER/API/OH&S/IWCF/IADC/CSA standard in brackets
    import re
    has_bracket_citation = bool(re.search(
        r"[\[\(](?:API\b|AER\b|OH&S|CSA|IWCF|IADC|CGA)", resp
    ))
    assert has_bracket_citation, f"No bracketed standard citations in response:\n{resp[:800]}"
    # Advisory footer required
    assert "advisory" in resp.lower()


def test_sop_erp_unauth_rejected():
    r = requests.post(f"{BASE_URL}/api/ai/chat",
                      json={"mode": "sop_erp", "message": "hi"})
    assert r.status_code == 401
