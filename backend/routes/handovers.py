"""POST /api/handovers/send — structured shift summary via Email + SMS with HITL gate and sandbox fallback."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import smtplib
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

HITL_ACTION = "handover_email_send"
SANDBOX_MESSAGE = ("Sandbox Delivery Mode: no email/SMS provider keys configured, so the rendered handover "
                   "was stored in handover_logs instead of being sent.")

_NUM = dict(allow_inf_nan=False)


class HandoverSendRequest(BaseModel):
    rig_id: Optional[str] = Field(None, max_length=64)
    job_id: Optional[str] = Field(None, max_length=64)
    depth_ft: Optional[float] = Field(None, **_NUM)
    coil_pressure_psi: Optional[float] = Field(None, **_NUM)
    wh_pressure_psi: Optional[float] = Field(None, **_NUM)
    diff_pressure_psi: Optional[float] = Field(None, **_NUM)
    weight_lbf: Optional[float] = Field(None, **_NUM)
    fatigue_top_pct: Optional[float] = Field(None, **_NUM)
    fatigue_mid_pct: Optional[float] = Field(None, **_NUM)
    fatigue_bottom_pct: Optional[float] = Field(None, **_NUM)
    open_tasks: List[str] = Field(default_factory=list, max_length=100)
    pending_parts: List[str] = Field(default_factory=list, max_length=100)
    note: Optional[str] = Field(None, max_length=2000)
    subject: Optional[str] = Field(None, max_length=150)
    hours: int = Field(12, ge=1, le=72)
    recipients: List[str] = Field(default_factory=list, max_length=10)
    phones: List[str] = Field(default_factory=list, max_length=20)
    hitl_approval_id: Optional[str] = None


def _fmt(v: Any, unit: str = "") -> str:
    return "—" if v is None else f"{v:,.1f}{unit}" if isinstance(v, (int, float)) else str(v)


def render_summary(b: HandoverSendRequest, extra: str = "") -> str:
    lines = [
        f"Job ID: {b.job_id or '—'}",
        f"Depth: {_fmt(b.depth_ft, ' ft')}",
        f"Coil Pressure: {_fmt(b.coil_pressure_psi, ' psi')}",
        f"WH Pressure: {_fmt(b.wh_pressure_psi, ' psi')}",
        f"Diff Pressure: {_fmt(b.diff_pressure_psi, ' psi')}",
        f"Weight: {_fmt(b.weight_lbf, ' lbf')}",
        f"Fatigue — Top: {_fmt(b.fatigue_top_pct, '%')} | Mid: {_fmt(b.fatigue_mid_pct, '%')} | Bottom: {_fmt(b.fatigue_bottom_pct, '%')}",
        "Open Tasks: " + ("; ".join(b.open_tasks) if b.open_tasks else "none"),
        "Pending Parts: " + ("; ".join(b.pending_parts) if b.pending_parts else "none"),
    ]
    text = "\n".join(lines)
    if b.note:
        text = b.note.strip() + "\n\n" + text
    return text + ("\n\n" + extra if extra else "")


def _smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))


def _send_smtp(subject: str, text: str, to: List[str]) -> None:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = os.environ["SMTP_FROM"], ", ".join(to), subject
    msg.set_content(text)
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=20) as s:
        if os.environ.get("SMTP_STARTTLS", "true").lower() in {"1", "true", "yes", "on"}:
            s.starttls()
        if os.environ.get("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        s.send_message(msg)


def build_router(*, require_user, db, chain_audit, srv) -> APIRouter:
    """`srv` is the server module: its HITL gate, Resend and Twilio helpers are reused as-is."""
    r = APIRouter()

    async def _default_contacts(team_id: str):
        rows = await db.crew_contacts.find(
            {"team_id": team_id, "is_deleted": {"$ne": True}, "is_default_recipient": True}, {"_id": 0}
        ).to_list(200)
        return ([c["email"].strip().lower() for c in rows if c.get("email")],
                [c["phone"].strip() for c in rows if c.get("phone")])

    @r.post("/handovers/send")
    async def send_handover(body: HandoverSendRequest, user: dict = Depends(require_user)):
        team_id = user.get("team_id") or user.get("org_id")
        if not team_id:
            raise HTTPException(400, "Join or create a team first.")

        emails = [e.strip().lower() for e in body.recipients if srv._EMAIL_RE.match((e or "").strip().lower())]
        phones = [p.strip() for p in body.phones if p and p.strip()]
        if not emails and not phones:
            emails, phones = await _default_contacts(team_id)
        emails, phones = list(dict.fromkeys(emails))[:10], list(dict.fromkeys(phones))[:20]

        extra = ""
        if body.rig_id:
            try:
                extra = await srv._build_shift_end_body(team_id, body.rig_id, body.hours)
            except Exception:
                extra = ""
        text = render_summary(body, extra)
        rig_label = (body.rig_id or "").replace("RIG", "Rig ").replace("YARD", "Yard")
        subject = (body.subject or f"Shift handover — {rig_label or 'rig'} · Job {body.job_id or 'n/a'}")[:150]

        fingerprint = srv._hitl_payload_fingerprint({
            "rig_id": body.rig_id, "job_id": body.job_id, "emails": sorted(emails), "phones": sorted(phones),
            "summary_sha": hashlib.sha256(text.encode()).hexdigest(),
        })
        await srv._consume_hitl_approval(
            action=HITL_ACTION, approval_id=body.hitl_approval_id, user=user,
            endpoint="/api/handovers/send", payload_fingerprint=fingerprint)

        sender = user.get("name") or (user.get("email") or "crew").split("@")[0]
        channels: Dict[str, Any] = {}

        # Email: Resend first, SMTP second, otherwise sandbox.
        if emails:
            try:
                if srv.RESEND_API_KEY and srv._resend is not None:
                    params = {"from": f"{sender} via CT Pocket <{srv.RESEND_FROM_EMAIL}>", "to": emails,
                              "subject": subject, "text": text,
                              "html": srv._html_email_from_text(sender, rig_label, text, None)}
                    if user.get("email"):
                        params["reply_to"] = [user["email"]]
                    resp = await asyncio.to_thread(srv._resend.Emails.send, params)
                    channels["email"] = {"mode": "live", "provider": "resend", "to": emails,
                                         "provider_id": resp.get("id") if isinstance(resp, dict) else None}
                elif _smtp_configured():
                    await asyncio.to_thread(_send_smtp, subject, text, emails)
                    channels["email"] = {"mode": "live", "provider": "smtp", "to": emails}
                else:
                    channels["email"] = {"mode": "sandbox", "to": emails}
            except Exception as e:
                channels["email"] = {"mode": "error", "to": emails, "error": str(e)[:200]}

        if phones:
            if srv._sms_configured():
                sms_text = srv._build_sms_text_from_handover(text, None)
                sent, failed = [], []
                for n in phones:
                    try:
                        sent.append({"number": n, "provider_id": await srv._send_sms_twilio(n, sms_text)})
                    except Exception as e:
                        failed.append({"number": n, "error": str(e)[:200]})
                channels["sms"] = {"mode": "live" if sent else "error", "provider": "twilio",
                                   "sent": sent, "failed": failed}
            else:
                channels["sms"] = {"mode": "sandbox", "to": phones}

        modes = {c["mode"] for c in channels.values()}
        mode = "live" if modes == {"live"} else "sandbox" if modes <= {"sandbox"} else "partial"
        if not channels:
            channels["none"] = {"mode": "sandbox", "to": []}
            mode = "sandbox"

        log_id = f"hov_{uuid.uuid4().hex[:16]}"
        now = datetime.now(timezone.utc)
        needs_log = mode != "live"
        if needs_log:
            try:
                await db.handover_logs.insert_one({
                    "log_id": log_id, "team_id": team_id, "rig_id": body.rig_id, "job_id": body.job_id,
                    "sender_user_id": user.get("user_id"), "sender_email": user.get("email"),
                    "subject": subject, "rendered_text": text[:20000], "channels": channels,
                    "mode": mode, "created_at": now,
                })
            except Exception:
                pass

        for ch, info in channels.items():
            await chain_audit(
                user, f"handover.dispatch.{ch}", rig_id=body.rig_id, target=log_id,
                payload_hash=hashlib.sha256(json.dumps(
                    {"subject": subject, "text": text, "channel": ch}, sort_keys=True).encode()).hexdigest(),
                decision=info["mode"], meta={"mode": info["mode"], "provider": info.get("provider"),
                                             "recipients": len(info.get("to") or info.get("sent") or [])})

        result: Dict[str, Any] = {"mode": mode, "log_id": log_id, "channels": channels, "summary": text[:1500]}
        result["message"] = SANDBOX_MESSAGE if mode == "sandbox" else (
            "Handover dispatched." if mode == "live" else "Handover partially dispatched; see channel results.")
        return result

    return r
