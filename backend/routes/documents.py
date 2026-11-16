"""Document upload helpers (local-disk fallback) and org-scoped inline preview."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response

UPLOAD_ROOT = Path(__file__).resolve().parents[1] / "uploads"
MAX_DOC_BYTES = 25 * 1024 * 1024
DOC_EXT_MIME = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
                "jpeg": "image/jpeg", "webp": "image/webp"}


def _safe(part: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", part or "")[:128] or "_"


def validate_upload(filename: Optional[str], size: int) -> str:
    """Returns the lowercase extension or raises 415 (type) / 413 (size) / 400 (empty)."""
    name = (filename or "").strip()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in DOC_EXT_MIME:
        raise HTTPException(415, f"Unsupported file type .{ext or '?'}. Allowed: {sorted(DOC_EXT_MIME)}")
    if size > MAX_DOC_BYTES:
        raise HTTPException(413, f"File too large ({size/1024/1024:.1f} MB). Max 25 MB.")
    if size == 0:
        raise HTTPException(400, "Empty file.")
    return ext


def save_local(org_id: str, doc_id: str, ext: str, data: bytes) -> dict:
    folder = UPLOAD_ROOT / _safe(org_id)
    folder.mkdir(parents=True, exist_ok=True)
    rel = f"{_safe(org_id)}/{_safe(doc_id)}.{_safe(ext)}"
    (UPLOAD_ROOT / rel).write_bytes(data)
    return {"path": rel, "size": len(data), "storage_backend": "local"}


def read_local(rel_path: str) -> tuple:
    p = (UPLOAD_ROOT / rel_path).resolve()
    if UPLOAD_ROOT.resolve() not in p.parents or not p.is_file():
        raise HTTPException(404, "File not found in storage.")
    return p.read_bytes(), DOC_EXT_MIME.get(p.suffix.lstrip(".").lower(), "application/octet-stream")


def build_router(*, db, get_current_user, get_object, is_admin) -> APIRouter:
    r = APIRouter()

    @r.get("/documents/{doc_id}/file")
    async def preview_file(doc_id: str, auth: Optional[str] = None, user: Optional[dict] = Depends(get_current_user)):
        """Inline preview (iframe/img friendly). `?auth=<session_token>` supported like /download."""
        if not user and auth:
            sess = await db.user_sessions.find_one({"session_token": auth}, {"_id": 0})
            if sess and sess.get("user_id"):
                user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(401, "Not authenticated.")
        rec = await db.company_documents.find_one({"doc_id": doc_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        org = user.get("org_id") or user.get("team_id")
        if not rec:
            raise HTTPException(404, "Not found.")
        if (not rec.get("team_id") or rec["team_id"] != org) and not is_admin(user):
            raise HTTPException(403, "Document belongs to another organization.")
        try:
            data, ctype = get_object(rec["storage_path"], rec.get("storage_backend", "emergent"))
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, "Document storage unavailable.")
        return Response(content=data, media_type=rec.get("content_type") or ctype, headers={
            "Content-Disposition": f'inline; filename="{_safe(rec.get("filename") or "doc.pdf")}"',
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        })

    return r
