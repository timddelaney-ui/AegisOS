import re
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routes.handovers import build_router


class Coll:
    def __init__(self):
        self.rows = []

    async def insert_one(self, d):
        self.rows.append(d)

    def find(self, *a, **k):
        rows = self.rows

        class C:
            async def to_list(self, n):
                return rows
        return C()


def make_client(*, enforce=False, sms=False, resend=None):
    db = SimpleNamespace(handover_logs=Coll(), crew_contacts=Coll())
    audits = []

    async def chain_audit(user, action, **kw):
        audits.append((action, kw))

    async def consume(*, action, approval_id, user, endpoint, payload_fingerprint=None):
        if enforce and not approval_id:
            raise HTTPException(428, "HITL approval required.")

    async def twilio(n, t):
        return "SM123"

    srv = SimpleNamespace(
        _EMAIL_RE=re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$"),
        _hitl_payload_fingerprint=lambda p: "fp",
        _consume_hitl_approval=consume,
        _build_shift_end_body=None,
        RESEND_API_KEY="k" if resend else "", RESEND_FROM_EMAIL="a@b.co", _resend=resend,
        _html_email_from_text=lambda *a: "<p>x</p>",
        _sms_configured=lambda: sms, _send_sms_twilio=twilio,
        _build_sms_text_from_handover=lambda t, n: t[:100],
    )

    async def user():
        return {"user_id": "u1", "team_id": "t1", "email": "u@x.co", "name": "U"}

    app = FastAPI()
    app.include_router(build_router(require_user=user, db=db, chain_audit=chain_audit, srv=srv), prefix="/api")
    return TestClient(app), db, audits


PAYLOAD = {"rig_id": "RIG1", "job_id": "J-42", "depth_ft": 9500, "coil_pressure_psi": 4200, "wh_pressure_psi": 800,
           "diff_pressure_psi": -150, "weight_lbf": -2300, "fatigue_top_pct": 12, "fatigue_mid_pct": 8,
           "fatigue_bottom_pct": 31, "open_tasks": ["Replace stripper"], "pending_parts": ["Pack-off"],
           "recipients": ["boss@example.com"], "phones": ["+14035551234"]}


def test_sandbox_mode_without_keys():
    c, db, audits = make_client()
    r = c.post("/api/handovers/send", json=PAYLOAD)
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "sandbox" and j["message"]
    log = db.handover_logs.rows[0]
    for needle in ("J-42", "9,500.0 ft", "Diff Pressure: -150.0", "Top: 12.0%", "Replace stripper", "Pack-off"):
        assert needle in log["rendered_text"]
    assert {a[0] for a in audits} == {"handover.dispatch.email", "handover.dispatch.sms"}


def test_hitl_enforced_blocks_without_approval():
    c, db, audits = make_client(enforce=True)
    assert c.post("/api/handovers/send", json=PAYLOAD).status_code == 428
    assert not db.handover_logs.rows and not audits
    assert c.post("/api/handovers/send", json={**PAYLOAD, "hitl_approval_id": "hr_1"}).status_code == 200


def test_live_email_and_sms():
    sent = []
    resend = SimpleNamespace(Emails=SimpleNamespace(send=lambda p: sent.append(p) or {"id": "em_1"}))
    c, db, audits = make_client(sms=True, resend=resend)
    j = c.post("/api/handovers/send", json=PAYLOAD).json()
    assert j["mode"] == "live" and sent[0]["to"] == ["boss@example.com"]
    assert j["channels"]["sms"]["sent"][0]["provider_id"] == "SM123"
    assert len(audits) == 2


def test_provider_failure_never_500():
    def boom(p):
        raise RuntimeError("provider down")
    c, _, _ = make_client(resend=SimpleNamespace(Emails=SimpleNamespace(send=boom)))
    r = c.post("/api/handovers/send", json={**PAYLOAD, "phones": []})
    assert r.status_code == 200 and r.json()["channels"]["email"]["mode"] == "error"
