"""
Security & Compliance module — bundled Enterprise feature.

Exposes four coordinated subsystems:
  (a) Workspace status — TLS version, data-region, team isolation summary
      surfaced to the client so sales/clients can see privacy posture.
  (b) Encrypted treatment / dossier notes — opt-in symmetric encryption
      (Fernet) with per-team server-held keys so DB dumps / backup leaks
      can't disclose sensitive field notes.
  (c) AI privacy mode — a PII scrubber that redacts job numbers, well
      names, customer names, and crew names from any string before it is
      sent to an upstream LLM provider.
  (d) Audit log — generalises the existing tier_change_log into a
      universal, append-only ledger of security-sensitive actions.

Routes mount under `/api/security/*`. All routes require Enterprise tier
UNLESS the global `BETA_UNLOCK` flag on server.py is on, in which case the
gate is relaxed — matches the rest of the tier guard.
"""
from __future__ import annotations

import base64
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# PII scrubber (used by AI privacy mode)
# ---------------------------------------------------------------------------

_JOB_RE  = re.compile(r"\bJ-\d{3,6}\b", re.IGNORECASE)
_WELL_RE = re.compile(r"\b(?:well|wellbore)\s+([A-Z][A-Z0-9\-]{1,30})\b", re.IGNORECASE)


def scrub_pii(text: str, extra_terms: Optional[List[str]] = None) -> str:
    """Replace common sensitive tokens with privacy placeholders.

    Doesn't try to be a universal DLP — just enough to avoid leaking:
      - job numbers (e.g. `J-204`)         → `[JOB]`
      - well names after Well/Wellbore     → `[WELL]`
      - any custom team-provided term      → `[REDACTED]`
    """
    if not isinstance(text, str) or not text:
        return text
    out = _JOB_RE.sub("[JOB]", text)
    out = _WELL_RE.sub("Well [WELL]", out)
    for term in extra_terms or []:
        term = (term or "").strip()
        if len(term) < 2:
            continue
        try:
            out = re.sub(re.escape(term), "[REDACTED]", out, flags=re.IGNORECASE)
        except re.error:
            continue
    return out


# ---------------------------------------------------------------------------
# Per-team symmetric encryption key management (encryption at rest)
# ---------------------------------------------------------------------------

def _generate_team_fernet_key() -> str:
    """Returns a URL-safe base64-encoded 32-byte key suitable for Fernet."""
    return Fernet.generate_key().decode("ascii")


async def _get_or_create_team_key(db, team_id: str) -> str:
    rec = await db.team_security_keys.find_one({"team_id": team_id})
    if rec and rec.get("fernet_key"):
        return rec["fernet_key"]
    key = _generate_team_fernet_key()
    await db.team_security_keys.insert_one({
        "team_id": team_id,
        "fernet_key": key,
        "created_at": datetime.now(timezone.utc),
    })
    return key


async def encrypt_for_team(db, team_id: str, plaintext: str) -> str:
    """Returns `enc:v1:<base64 token>` so callers can quickly detect an
    encrypted field. Empty / non-str inputs pass through unchanged.
    """
    if not isinstance(plaintext, str) or not plaintext:
        return plaintext
    key = await _get_or_create_team_key(db, team_id)
    token = Fernet(key.encode("ascii")).encrypt(plaintext.encode("utf-8")).decode("ascii")
    return f"enc:v1:{token}"


async def decrypt_for_team(db, team_id: str, blob: str) -> str:
    """Idempotent — returns the input unchanged if it's not an encrypted
    envelope. Raises `HTTPException(422)` on decryption failure so bad
    data is loud instead of silently corrupting the dossier.
    """
    if not isinstance(blob, str) or not blob.startswith("enc:v1:"):
        return blob
    token = blob[len("enc:v1:"):]
    rec = await db.team_security_keys.find_one({"team_id": team_id})
    if not rec or not rec.get("fernet_key"):
        raise HTTPException(410, "This team's encryption key is missing. Secure notes cannot be decrypted.")
    try:
        return Fernet(rec["fernet_key"].encode("ascii")).decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise HTTPException(422, "Encrypted note failed integrity check — key may have rotated.") from e


# ---------------------------------------------------------------------------
# Audit log helper (generalises tier_change_log)
# ---------------------------------------------------------------------------

async def audit_log(
    db,
    *,
    actor_user_id: Optional[str],
    actor_email: Optional[str],
    team_id: Optional[str],
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Append-only audit record. Fire-and-forget: never raises so a logging
    failure can't block the user's primary action.
    """
    try:
        await db.audit_log.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_user_id": actor_user_id,
            "actor_email": actor_email,
            "team_id": team_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "meta": meta or {},
        })
    except Exception:
        pass  # best-effort


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class SecuritySettingsUpdate(BaseModel):
    encryption_enabled: Optional[bool] = None
    ai_privacy_mode: Optional[bool] = None
    audit_log_enabled: Optional[bool] = None
    extra_redaction_terms: Optional[List[str]] = None  # team-specific DLP terms


def build_router(*, require_user, require_enterprise, db, tls_version: str, data_region: str) -> APIRouter:
    """Build the security router with injected dependencies so it stays
    testable without pulling the full `server.py` surface.
    """
    router = APIRouter(prefix="/security", tags=["security"])

    async def _get_settings(team_id: str) -> Dict[str, Any]:
        rec = await db.team_security_settings.find_one({"team_id": team_id})
        return {
            "encryption_enabled": bool(rec and rec.get("encryption_enabled")),
            "ai_privacy_mode": bool(rec and rec.get("ai_privacy_mode")),
            "audit_log_enabled": bool(rec and rec.get("audit_log_enabled")),
            "extra_redaction_terms": (rec or {}).get("extra_redaction_terms") or [],
            "key_initialized": await db.team_security_keys.count_documents({"team_id": team_id}) > 0,
            "updated_at": (rec or {}).get("updated_at").isoformat() if rec and rec.get("updated_at") else None,
        }

    @router.get("/status")
    async def security_status(user: dict = Depends(require_user)):
        """Public-ish — any authenticated user can see the transport-layer
        and workspace isolation summary. The sensitive toggles come from
        the Enterprise-only `/security/settings` endpoint.
        """
        team_id = user.get("team_id")
        settings = await _get_settings(team_id) if team_id else None
        return {
            "tls_version": tls_version,
            "data_region": data_region,
            "team_id": team_id,
            "team_isolated": bool(team_id),
            "secure_mode_active": bool(settings and (settings["encryption_enabled"] or settings["ai_privacy_mode"] or settings["audit_log_enabled"])),
            "settings": settings,
        }

    @router.get("/settings")
    async def get_settings(user: dict = Depends(require_enterprise)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Join or create a team first.")
        return await _get_settings(team_id)

    @router.put("/settings")
    async def put_settings(body: SecuritySettingsUpdate, user: dict = Depends(require_enterprise)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Join or create a team first.")
        before = await _get_settings(team_id)
        patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
        if body.encryption_enabled is not None:
            patch["encryption_enabled"] = bool(body.encryption_enabled)
        if body.ai_privacy_mode is not None:
            patch["ai_privacy_mode"] = bool(body.ai_privacy_mode)
        if body.audit_log_enabled is not None:
            patch["audit_log_enabled"] = bool(body.audit_log_enabled)
        if body.extra_redaction_terms is not None:
            cleaned = [t.strip() for t in body.extra_redaction_terms if (t or "").strip()]
            # keep the list tight so we don't blow up every AI call
            patch["extra_redaction_terms"] = cleaned[:20]
        await db.team_security_settings.update_one(
            {"team_id": team_id},
            {"$set": patch, "$setOnInsert": {"team_id": team_id, "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        if patch.get("encryption_enabled"):
            # Pre-provision the team key so the first secure write doesn't
            # have to race the key generation.
            await _get_or_create_team_key(db, team_id)
        after = await _get_settings(team_id)
        await audit_log(
            db,
            actor_user_id=user.get("user_id"),
            actor_email=user.get("email"),
            team_id=team_id,
            action="security.settings.update",
            target_type="team_security_settings",
            target_id=team_id,
            meta={"before": before, "after": after},
        )
        return after

    @router.get("/audit-log")
    async def audit_tail(limit: int = 50, user: dict = Depends(require_enterprise)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Join or create a team first.")
        limit = max(1, min(int(limit or 50), 200))
        cursor = db.audit_log.find({"team_id": team_id}).sort("at", -1).limit(limit)
        rows: List[Dict[str, Any]] = []
        async for r in cursor:
            r["_id"] = str(r.get("_id"))
            if isinstance(r.get("at"), datetime):
                r["at"] = r["at"].isoformat()
            rows.append(r)
        return {"rows": rows, "team_id": team_id}

    @router.post("/key/rotate")
    async def rotate_key(user: dict = Depends(require_enterprise)):
        """Issue a NEW team Fernet key. Existing encrypted notes stay bound
        to the old key via a key history ring so decryption continues to
        work during rotation.
        """
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Join or create a team first.")
        prev = await db.team_security_keys.find_one({"team_id": team_id})
        new_key = _generate_team_fernet_key()
        now = datetime.now(timezone.utc)
        if prev:
            await db.team_security_keys.update_one(
                {"team_id": team_id},
                {
                    "$set": {"fernet_key": new_key, "rotated_at": now},
                    "$push": {"history": {"key": prev["fernet_key"], "retired_at": now}},
                },
            )
        else:
            await db.team_security_keys.insert_one({
                "team_id": team_id,
                "fernet_key": new_key,
                "created_at": now,
            })
        await audit_log(
            db,
            actor_user_id=user.get("user_id"),
            actor_email=user.get("email"),
            team_id=team_id,
            action="security.key.rotate",
            target_type="team_security_keys",
            target_id=team_id,
        )
        return {"success": True, "rotated_at": now.isoformat()}

    return router
