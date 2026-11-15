from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Cookie, Header, UploadFile, File, Form, Query, WebSocket
from starlette.websockets import WebSocketDisconnect
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import hashlib
import hmac
from urllib.parse import urlencode
import logging
import asyncio
import uuid
import string
import random
import secrets
import httpx
from fastapi.responses import RedirectResponse, JSONResponse
import requests
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
except ImportError:  # self-hosted deployments use GEMINI_API_KEY directly
    LlmChat = UserMessage = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
from liveops_broadcast import liveops_broadcaster  # noqa: E402
from services.mqtt_liveops import liveops_sample  # noqa: E402

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

IS_PRODUCTION = os.environ.get("APP_ENV", "").lower() == "production"

# PayPal Subscriptions (CAD). Plans are created once by scripts_paypal_setup.py.
PAYPAL_ENV = os.environ.get("PAYPAL_ENV", "live" if IS_PRODUCTION else "sandbox").lower()
PAYPAL_BASE = "https://api-m.paypal.com" if PAYPAL_ENV == "live" else "https://api-m.sandbox.paypal.com"
PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "").strip()
PAYPAL_CLIENT_SECRET = os.environ.get("PAYPAL_CLIENT_SECRET", "").strip()
PAYPAL_WEBHOOK_ID = os.environ.get("PAYPAL_WEBHOOK_ID", "").strip()
PAYPAL_PLAN_IDS = {
    "ct_pro_monthly": os.environ.get("PAYPAL_PLAN_MONTHLY", "").strip(),
    "ct_pro_yearly": os.environ.get("PAYPAL_PLAN_YEARLY", "").strip(),
}

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ============ MODELS ============
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    team_id: Optional[str] = None
    role: str = "crew"  # crew | field_manager | ops_manager
    subscription_status: str = "free"  # free | active | canceled
    subscription_plan: Optional[str] = None  # workbook_pro | aegis_fleet | invite
    subscription_expires_at: Optional[datetime] = None
    trial_expires_at: Optional[datetime] = None


class Team(BaseModel):
    team_id: str
    name: str
    owner_id: str
    invite_code: str
    created_at: datetime


class JobCreate(BaseModel):
    sheet_key: str
    title: str
    unit_system: str
    values: Dict[str, Any]
    visibility: str = "private"  # private | team
    client_id: Optional[str] = None  # idempotency key for offline replay
    event_at: Optional[str] = None


class JobUpdate(BaseModel):
    title: Optional[str] = None
    values: Optional[Dict[str, Any]] = None
    visibility: Optional[str] = None


class CheckoutRequest(BaseModel):
    lookup_key: str  # ct_pro_monthly or ct_pro_yearly
    origin_url: str


class TeamCreate(BaseModel):
    name: str


class TeamJoin(BaseModel):
    invite_code: str


class FeedbackCreate(BaseModel):
    category: str  # bug | idea | ux | data_accuracy | field_incident | other
    subject: str
    message: str
    page: Optional[str] = None
    sentiment: Optional[str] = None   # positive | neutral | negative
    user_agent: Optional[str] = None  # client-captured browser / OS string


# ============ AUTH HELPERS ============
async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> Optional[dict]:
    user = await _user_from_session_token(session_token)
    if not user and authorization and authorization.startswith("Bearer "):
        user = await _user_from_session_token(authorization[7:])
    return user


async def _user_from_session_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    session_doc = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session_doc:
        return None

    expires_at = session_doc["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None

    user_doc = await db.users.find_one({"user_id": session_doc["user_id"]}, {"_id": 0})
    return _apply_admin_unlock(user_doc)


def _apply_admin_unlock(user: Optional[dict]) -> Optional[dict]:
    """Owners listed in ADMIN_EMAILS get every plan, role and trial check lifted.

    Applied in-memory only; nothing is written back to the user document.
    """
    if user and _is_admin(user):
        user.update(
            subscription_status="active",
            subscription_tier="enterprise",
            subscription_expires_at=datetime.now(timezone.utc) + timedelta(days=3650),
            role="ops_manager",
            is_admin=True,
            admin_unlocked=True,
        )
    return user


async def require_user(user: Optional[dict] = Depends(get_current_user)) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@app.websocket("/api/liveops/ws")
async def liveops_websocket(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    if not origin or origin not in _cors_origins:
        await websocket.close(code=1008)
        return
    user = await _user_from_session_token(websocket.cookies.get("session_token"))
    if not user or not user.get("team_id"):
        await websocket.close(code=4401)
        return
    if get_effective_plan(user) != "aegis_fleet":
        await websocket.close(code=4403)
        return

    session_token = websocket.cookies.get("session_token")
    team_id = user["team_id"]
    rig_id = websocket.query_params.get("rig_id") or None
    queue = liveops_broadcaster.subscribe(team_id, rig_id)
    try:
        await websocket.accept()
        next_auth_check = asyncio.get_running_loop().time() + 30
        while True:
            timeout = min(20, max(0, next_auth_check - asyncio.get_running_loop().time()))
            try:
                message = await asyncio.wait_for(queue.get(), timeout=timeout)
            except asyncio.TimeoutError:
                message = None
            if asyncio.get_running_loop().time() >= next_auth_check:
                current_user = await _user_from_session_token(session_token)
                if not current_user or current_user.get("team_id") != team_id:
                    await websocket.close(code=4401)
                    break
                next_auth_check = asyncio.get_running_loop().time() + 30
            if message is None:
                await websocket.send_json({"type": "heartbeat"})
                continue
            await websocket.send_json(message)
            if message.get("type") == "resync_required":
                break
    except WebSocketDisconnect:
        pass
    finally:
        liveops_broadcaster.unsubscribe(team_id, queue)
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass


def _generate_invite_code(length=8) -> str:
    # Cryptographically-secure so codes can't be guessed / brute-forced.
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(length))


def _serialize(doc: dict) -> dict:
    """Convert datetime objects to ISO strings for JSON."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# ============ HITL (Human-in-the-Loop) approval gates ============
HITL_ENFORCE_OUTBOUND = os.environ.get("HITL_ENFORCE_OUTBOUND", "true").strip().lower() in {"1", "true", "yes", "on"}
HITL_REQUIRED_ACTIONS = {
    "handover_email_send",
    "shift_end_email_send",
    "shift_end_sms_send",
    "dossier_email_send",
    "document_upload",
    "attachment_upload",
}


def _hitl_action(action: str) -> str:
    return (action or "").strip().lower()


def _hitl_payload_fingerprint(payload: Dict[str, Any]) -> str:
    canon = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


class HitlRequestCreate(BaseModel):
    action: str
    summary: str
    details: Optional[str] = None
    payload_fingerprint: Optional[str] = None
    destination: Optional[str] = None  # recipient/destination recorded in the audit trail
    expires_minutes: Optional[int] = 30


class HitlDecision(BaseModel):
    decision: str  # approve | reject
    confirm_text: Optional[str] = None
    reason: Optional[str] = None


async def _chain_audit(user, action, *, requester=None, approver=None, target=None,
                       payload_hash=None, decision=None, rig_id=None, meta=None):
    """Tamper-evident audit entry. Never raises: audit failure must not break the action
    already authorised, but is logged loudly."""
    try:
        await audit_chain.append(
            db, org_id=org_id_of(user), action=action,
            actor_user_id=requester or user.get("user_id"), actor_email=user.get("email"),
            approver_user_id=approver, rig_id=rig_id, target=target,
            payload_hash=payload_hash, decision=decision, meta=meta,
        )
    except Exception:
        logger.exception("audit chain append failed for %s", action)


@api_router.post("/hitl/requests")
async def create_hitl_request(body: HitlRequestCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    action = _hitl_action(body.action)
    if action not in HITL_REQUIRED_ACTIONS:
        raise HTTPException(400, f"Unknown action. Allowed: {sorted(HITL_REQUIRED_ACTIONS)}")
    summary = (body.summary or "").strip()
    if not summary:
        raise HTTPException(400, "summary required")
    expires_minutes = max(5, min(int(body.expires_minutes or 30), 120))
    now = datetime.now(timezone.utc)
    request_id = f"hitl_{uuid.uuid4().hex[:14]}"
    doc = {
        "request_id": request_id,
        "team_id": team_id,
        "action": action,
        "summary": summary[:300],
        "details": (body.details or "").strip()[:2000] or None,
        "payload_fingerprint": (body.payload_fingerprint or "").strip()[:128] or None,
        "destination": (body.destination or "").strip()[:500] or None,
        "status": "pending",  # pending | approved | rejected | consumed
        "created_by_user_id": user["user_id"],
        "created_by_email": user["email"],
        "created_at": now,
        "expires_at": now + timedelta(minutes=expires_minutes),
        "updated_at": now,
    }
    await db.hitl_requests.insert_one(doc)
    await _audit_log(
        db,
        actor_user_id=user.get("user_id"),
        actor_email=user.get("email"),
        team_id=team_id,
        action="hitl.request.create",
        target_type="hitl_request",
        target_id=request_id,
        meta={"action": action},
    )
    return {
        "request_id": request_id,
        "action": action,
        "status": "pending",
        "summary": doc["summary"],
        "expires_at": doc["expires_at"].isoformat(),
        "created_at": doc["created_at"].isoformat(),
    }


@api_router.post("/hitl/requests/{request_id}/decision")
async def decide_hitl_request(request_id: str, body: HitlDecision, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    rec = await db.hitl_requests.find_one({"request_id": request_id, "team_id": team_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "HITL request not found.")
    if rec.get("created_by_user_id") != user.get("user_id"):
        raise HTTPException(403, "Only the initiating user can approve or reject this request.")
    if rec.get("status") != "pending":
        raise HTTPException(409, f"Request is already {rec.get('status')}.")
    now = datetime.now(timezone.utc)
    if rec.get("expires_at") and rec["expires_at"] < now:
        await db.hitl_requests.update_one(
            {"request_id": request_id, "status": "pending"},
            {"$set": {"status": "rejected", "reason": "expired", "updated_at": now}},
        )
        raise HTTPException(410, "HITL request expired.")

    decision = (body.decision or "").strip().lower()
    if decision not in {"approve", "reject"}:
        raise HTTPException(400, "decision must be approve|reject")
    if decision == "approve" and (body.confirm_text or "").strip().upper() != "APPROVE":
        raise HTTPException(400, "confirm_text must be APPROVE for approval.")
    new_status = "approved" if decision == "approve" else "rejected"
    await db.hitl_requests.update_one(
        {"request_id": request_id, "team_id": team_id, "status": "pending"},
        {"$set": {
            "status": new_status,
            "decision_by_user_id": user["user_id"],
            "decision_by_email": user["email"],
            "decision_at": now,
            "reason": (body.reason or "").strip()[:500] or None,
            "updated_at": now,
        }},
    )
    await _audit_log(
        db,
        actor_user_id=user.get("user_id"),
        actor_email=user.get("email"),
        team_id=team_id,
        action=f"hitl.request.{decision}",
        target_type="hitl_request",
        target_id=request_id,
        meta={"request_action": rec.get("action")},
    )
    await _chain_audit(
        user, f"hitl.{rec.get('action')}", requester=rec.get("created_by_user_id"),
        approver=user.get("user_id"), target=rec.get("destination"),
        payload_hash=rec.get("payload_fingerprint"),
        decision="approved" if decision == "approve" else "rejected",
        meta={"request_id": request_id, "reason": (body.reason or "")[:500]},
    )
    return {"request_id": request_id, "status": new_status, "decision_at": now.isoformat()}


async def _consume_hitl_approval(
    *,
    action: str,
    approval_id: Optional[str],
    user: dict,
    endpoint: str,
    payload_fingerprint: Optional[str] = None,
):
    action = _hitl_action(action)
    if action not in HITL_REQUIRED_ACTIONS:
        return
    if not HITL_ENFORCE_OUTBOUND:
        return
    if not approval_id:
        raise HTTPException(428, "HITL approval required. Create and approve a /api/hitl/requests entry first.")
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    now = datetime.now(timezone.utc)
    rec = await db.hitl_requests.find_one(
        {"request_id": approval_id, "team_id": team_id, "action": action},
        {"_id": 0},
    )
    if not rec:
        raise HTTPException(404, "HITL approval not found for this action/team.")
    if rec.get("created_by_user_id") != user.get("user_id"):
        raise HTTPException(403, "HITL approval belongs to another user.")
    if rec.get("status") != "approved":
        raise HTTPException(409, f"HITL approval is {rec.get('status')}, not approved.")
    if rec.get("expires_at") and rec["expires_at"] < now:
        raise HTTPException(410, "HITL approval expired.")
    expected_fingerprint = (rec.get("payload_fingerprint") or "").strip()
    if expected_fingerprint and payload_fingerprint and expected_fingerprint != payload_fingerprint:
        raise HTTPException(409, "HITL approval payload fingerprint mismatch.")

    upd = await db.hitl_requests.update_one(
        {"request_id": approval_id, "status": "approved"},
        {"$set": {
            "status": "consumed",
            "consumed_at": now,
            "consumed_by_user_id": user.get("user_id"),
            "consumed_by_email": user.get("email"),
            "consumed_endpoint": endpoint,
            "updated_at": now,
        }},
    )
    if upd.modified_count == 0:
        raise HTTPException(409, "HITL approval already consumed.")
    await _audit_log(
        db,
        actor_user_id=user.get("user_id"),
        actor_email=user.get("email"),
        team_id=team_id,
        action="hitl.request.consumed",
        target_type="hitl_request",
        target_id=approval_id,
        meta={"request_action": action, "endpoint": endpoint},
    )
    await _chain_audit(
        user, f"outbound.{action}", requester=rec.get("created_by_user_id"),
        approver=rec.get("decision_by_user_id"), target=rec.get("destination"),
        payload_hash=payload_fingerprint or rec.get("payload_fingerprint"),
        decision="approved", meta={"request_id": approval_id, "endpoint": endpoint},
    )


# ============ ROOT ============
@api_router.get("/")
async def root():
    return {"message": "CT Field Workbook API"}


# ============ AUTH ROUTES ============
@api_router.post("/auth/session")
async def create_session(request: Request, response: Response):
    """Exchange Emergent session_id for our own session_token."""
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")

    # Call Emergent auth to get user data
    async with httpx.AsyncClient() as http:
        resp = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        data = resp.json()

    return await _finish_login(response, data["email"], data["name"], data.get("picture"), data["session_token"])


async def _finish_login(response: Response, email: str, name: str, picture: Optional[str], session_token: str):

    # Check if user exists
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        update_fields = {"name": name, "picture": picture}
        # Backfill trial_expires_at for pre-trial users
        if not existing.get("trial_expires_at"):
            update_fields["trial_expires_at"] = datetime.now(timezone.utc) + timedelta(days=30)
        await db.users.update_one({"user_id": user_id}, {"$set": update_fields})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "team_id": None,
            "subscription_status": "free",
            "subscription_plan": None,
            "subscription_expires_at": None,
            "trial_expires_at": datetime.now(timezone.utc) + timedelta(days=30),
            "created_at": datetime.now(timezone.utc),
        })

    # Store session
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    # Set cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )

    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if user_doc and (user_doc.get("org_id") or user_doc.get("team_id")):
        await _chain_audit(user_doc, "auth.login")
    return _serialize(user_doc)


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(require_user)):
    data = _serialize(user)
    # Ensure `role` is always present (default 'crew' for legacy users)
    if "role" not in data or not data.get("role"):
        data["role"] = "crew"
    data["effective_plan"] = get_effective_plan(user)
    return data


GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
PUBLIC_APP_URL = (os.environ.get("PUBLIC_APP_URL") or "https://mycoiltubingpocketsupports.tech").rstrip("/")
PUBLIC_API_URL = (os.environ.get("PUBLIC_API_URL") or PUBLIC_APP_URL).rstrip("/")


def _oauth_state(nonce: str) -> str:
    key = (GOOGLE_CLIENT_SECRET or "dev").encode()
    return nonce + "." + hmac.new(key, nonce.encode(), hashlib.sha256).hexdigest()[:32]


@api_router.get("/auth/config")
async def auth_config():
    return {"provider": "google" if GOOGLE_CLIENT_ID else "emergent"}


@api_router.get("/auth/google/login")
async def google_login(response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured (GOOGLE_CLIENT_ID).")
    nonce = uuid.uuid4().hex
    params = {
        "client_id": GOOGLE_CLIENT_ID, "response_type": "code", "scope": "openid email profile",
        "redirect_uri": f"{PUBLIC_API_URL}/api/auth/google/callback", "state": _oauth_state(nonce),
        "prompt": "select_account",
    }
    redirect = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params))
    redirect.set_cookie("oauth_state", nonce, max_age=600, httponly=True, secure=True, samesite="lax", path="/")
    return redirect


@api_router.get("/auth/google/callback")
async def google_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None,
                          oauth_state: Optional[str] = Cookie(None)):
    if not GOOGLE_CLIENT_ID or not code or not state or not oauth_state \
            or not hmac.compare_digest(state, _oauth_state(oauth_state)):
        return RedirectResponse(f"{PUBLIC_APP_URL}/?auth_error=state")
    async with httpx.AsyncClient(timeout=10) as http:
        tok = await http.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": f"{PUBLIC_API_URL}/api/auth/google/callback", "grant_type": "authorization_code"})
        if tok.status_code != 200:
            return RedirectResponse(f"{PUBLIC_APP_URL}/?auth_error=token")
        info = await http.get("https://openidconnect.googleapis.com/v1/userinfo",
                              headers={"Authorization": f"Bearer {tok.json()['access_token']}"})
    u = info.json() if info.status_code == 200 else {}
    if not u.get("email") or not u.get("email_verified"):
        return RedirectResponse(f"{PUBLIC_APP_URL}/?auth_error=email")
    # The API usually lives on another site (e.g. *.onrender.com), where browsers
    # drop the session cookie as third-party. Hand the app a short-lived one-time
    # code in the URL fragment; it exchanges it for a Bearer token.
    session_token = f"sess_{uuid.uuid4().hex}{uuid.uuid4().hex}"
    handoff = uuid.uuid4().hex + uuid.uuid4().hex
    redirect = RedirectResponse(f"{PUBLIC_APP_URL}/#auth_code={handoff}")
    await _finish_login(redirect, u["email"], u.get("name") or u["email"].split("@")[0],
                        u.get("picture"), session_token)
    await db.auth_handoffs.insert_one({
        "code": handoff, "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=2),
    })
    redirect.delete_cookie("oauth_state", path="/")
    return redirect


@api_router.post("/auth/google/exchange")
async def google_exchange(request: Request, response: Response):
    code = (await request.json()).get("code")
    if not code or not isinstance(code, str):
        raise HTTPException(400, "Missing code")
    doc = await db.auth_handoffs.find_one_and_delete({"code": code})
    expires_at = doc and doc["expires_at"]
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not doc or expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, "Sign-in link expired. Please try again.")
    user = await _user_from_session_token(doc["session_token"])
    if not user:
        raise HTTPException(401, "Session not found")
    response.set_cookie(key="session_token", value=doc["session_token"], max_age=7 * 24 * 60 * 60,
                        httponly=True, secure=True, samesite="none", path="/")
    data = _serialize(user)
    if not data.get("role"):
        data["role"] = "crew"
    return {**data, "session_token": doc["session_token"]}


@api_router.post("/auth/logout")
async def logout(
    response: Response,
    session_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
):
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"success": True}


# ============ SUBSCRIPTION ROUTES ============
@api_router.get("/subscription/status")
async def subscription_status(user: dict = Depends(require_user)):
    return {
        "status": user.get("subscription_status", "free"),
        "plan": user.get("subscription_plan"),
        "expires_at": user.get("subscription_expires_at").isoformat()
        if user.get("subscription_expires_at") else None,
    }


# ============ PLAN TIER (Personal / Small-Med / Enterprise) ============
BETA_UNLOCK = (os.environ.get("BETA_UNLOCK", "false").strip().lower() in {"1", "true", "yes", "on"})
_VALID_TIERS = {"personal", "smallmed", "enterprise"}


def _resolve_user_tier(user: dict) -> str:
    """Return the viewer's active plan tier.

    Precedence:
      1. explicit `subscription_tier` on the user doc (set by webhooks or
         admin assignment)
      2. derive from legacy `subscription_status`/`subscription_plan`
      3. default to `personal`
    """
    explicit = (user.get("subscription_tier") or "").strip().lower()
    if explicit in _VALID_TIERS:
        return explicit
    # Legacy mapping: active Pro subscribers from the Free/Pro era are
    # treated as Small-Med Crew — that's what the Pro bundle covered.
    if user.get("subscription_status") == "active":
        return "smallmed"
    return "personal"


FLEET_PLAN_KEYS = {"aegis_fleet"}
# Aegis Fleet only: Reel Track, Manager Mode, Rig Telemetry.
FLEET_ONLY_PREFIXES = (
    "/api/reels", "/api/fatigue",
    "/api/rbac/promote", "/api/job-packages", "/api/timecards/approve-payroll", "/api/rigs",
    "/api/liveops", "/api/daq",
)


def _is_beta_invitee(user: dict) -> bool:
    """BETA_UNLOCK only applies to admins and users who redeemed an invite code."""
    return bool(user.get("admin_unlocked")) or user.get("subscription_plan") == "invite" or bool(user.get("beta_invited"))


def get_effective_plan(user: Optional[dict]) -> str:
    """Resolve the entitlement plan: aegis_fleet | workbook_pro | trial | free."""
    if not user:
        return "free"
    now = datetime.now(timezone.utc)
    if (user.get("admin_unlocked")
            or (user.get("subscription_tier") or "").strip().lower() == "enterprise"
            or (user.get("subscription_plan") or "") in FLEET_PLAN_KEYS):
        return "aegis_fleet"
    if user.get("subscription_status") == "active":
        exp = _parse_utc(user.get("subscription_expires_at"))
        if exp is None or exp > now:
            return "workbook_pro"
    trial_exp = _parse_utc(user.get("trial_expires_at"))
    if trial_exp is not None and trial_exp > now:
        return "trial"
    return "free"


def _is_fleet_only_path(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in FLEET_ONLY_PREFIXES)


@app.middleware("http")
async def fleet_plan_gate(request: Request, call_next):
    if request.method != "OPTIONS" and _is_fleet_only_path(request.url.path):
        token = request.cookies.get("session_token")
        auth = request.headers.get("authorization", "")
        user = await _user_from_session_token(token)
        if not user and auth.startswith("Bearer "):
            user = await _user_from_session_token(auth[7:])
        # Unauthenticated requests fall through so the route itself returns 401.
        if user and get_effective_plan(user) != "aegis_fleet":
            return JSONResponse({"detail": "This feature requires an Aegis Fleet plan."}, status_code=403)
    return await call_next(request)


@api_router.get("/me/tier")
async def my_tier(user: dict = Depends(require_user)):
    """Returns the viewer's active plan tier plus the BETA_UNLOCK flag
    (honoured only for admins and invited beta users).
    """
    tier = _resolve_user_tier(user)
    return {
        "tier": tier,
        "effective_plan": get_effective_plan(user),
        "beta_unlock": (BETA_UNLOCK and _is_beta_invitee(user)) or bool(user.get("admin_unlocked")),
        "subscription_status": user.get("subscription_status", "free"),
        "subscription_plan": user.get("subscription_plan"),
    }


def _plan_for_lookup(lookup_key: str) -> str:
    return "aegis_fleet" if (lookup_key or "").startswith("aegis_fleet") else "workbook_pro"


def _period_for_lookup(lookup_key: str) -> timedelta:
    return timedelta(days=365) if (lookup_key or "").endswith("yearly") else timedelta(days=30)


_paypal_token: Dict[str, Any] = {"value": None, "expires": 0.0}


async def _paypal(method: str, path: str, **kwargs) -> Dict[str, Any]:
    if not (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET):
        raise HTTPException(503, "Payments are not configured")
    async with httpx.AsyncClient(timeout=30) as http:
        if not _paypal_token["value"] or _paypal_token["expires"] < asyncio.get_event_loop().time() + 60:
            r = await http.post(f"{PAYPAL_BASE}/v1/oauth2/token", auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
                                data={"grant_type": "client_credentials"})
            r.raise_for_status()
            body = r.json()
            _paypal_token["value"] = body["access_token"]
            _paypal_token["expires"] = asyncio.get_event_loop().time() + int(body.get("expires_in", 300))
        r = await http.request(method, f"{PAYPAL_BASE}{path}",
                               headers={"Authorization": f"Bearer {_paypal_token['value']}"}, **kwargs)
        r.raise_for_status()
        return r.json() if r.content else {}


def _lookup_for_paypal_plan(plan_id: str) -> Optional[str]:
    return next((k for k, v in PAYPAL_PLAN_IDS.items() if v and v == plan_id), None)


async def _sync_paypal_subscription(sub_id: str, user_id: Optional[str] = None) -> Optional[str]:
    """Fetch the subscription from PayPal (the source of truth) and mirror it onto the user.

    Returns the PayPal subscription status.
    """
    sub = await _paypal("GET", f"/v1/billing/subscriptions/{sub_id}")
    status = sub.get("status")
    user_id = user_id or sub.get("custom_id")
    query = {"user_id": user_id} if user_id else {"paypal_subscription_id": sub_id}
    if status == "ACTIVE":
        lookup = _lookup_for_paypal_plan(sub.get("plan_id", "")) or "ct_pro_monthly"
        next_billing = _parse_utc((sub.get("billing_info") or {}).get("next_billing_time"))
        # 3-day grace so a late renewal webhook never locks a paying user out.
        expires = (next_billing + timedelta(days=3)) if next_billing else datetime.now(timezone.utc) + _period_for_lookup(lookup)
        await db.users.update_one(query, {"$set": {
            "subscription_status": "active",
            "subscription_plan": _plan_for_lookup(lookup),
            "subscription_expires_at": expires,
            "paypal_subscription_id": sub_id,
        }})
    elif status in ("CANCELLED", "SUSPENDED", "EXPIRED"):
        await db.users.update_one({"paypal_subscription_id": sub_id}, {"$set": {"subscription_status": "canceled"}})
    return status


@api_router.post("/payments/checkout")
async def create_checkout(req: CheckoutRequest, user: dict = Depends(require_user)):
    plan_id = PAYPAL_PLAN_IDS.get(req.lookup_key)
    if not plan_id:
        raise HTTPException(400, f"Unknown or unconfigured plan: {req.lookup_key}")
    origin = req.origin_url.rstrip("/")
    if origin != PUBLIC_APP_URL and origin not in _cors_origins:
        origin = PUBLIC_APP_URL
    try:
        # No tax is added: the business is a CRA small supplier.
        sub = await _paypal("POST", "/v1/billing/subscriptions", json={
            "plan_id": plan_id,
            "custom_id": user["user_id"],
            "subscriber": {"email_address": user["email"]},
            "application_context": {
                "brand_name": "CT Field Workbook",
                "user_action": "SUBSCRIBE_NOW",
                "shipping_preference": "NO_SHIPPING",
                "return_url": f"{origin}/payment/success",
                "cancel_url": f"{origin}/payment/cancel",
            },
        })
    except httpx.HTTPError:
        logger.exception("PayPal subscription creation failed")
        raise HTTPException(502, "Could not start checkout")
    approve = next((l["href"] for l in sub.get("links", []) if l.get("rel") == "approve"), None)
    if not approve:
        raise HTTPException(502, "PayPal did not return an approval link")

    await db.payment_transactions.insert_one({
        "session_id": sub["id"],
        "user_id": user["user_id"],
        "lookup_key": req.lookup_key,
        "currency": "CAD",
        "status": "initiated",
        "payment_status": "pending",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    })
    return {"checkout_url": approve, "session_id": sub["id"]}


@api_router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str):
    record = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Transaction not found")

    if record.get("payment_status") != "paid":
        try:
            status = await _sync_paypal_subscription(session_id, record["user_id"])
            if status == "ACTIVE":
                await db.payment_transactions.update_one(
                    {"session_id": session_id},
                    {"$set": {"status": "completed", "payment_status": "paid", "updated_at": datetime.now(timezone.utc)}},
                )
            elif status in ("CANCELLED", "EXPIRED"):
                await db.payment_transactions.update_one(
                    {"session_id": session_id},
                    {"$set": {"status": "failed", "payment_status": "failed", "updated_at": datetime.now(timezone.utc)}},
                )
            record = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        except (httpx.HTTPError, HTTPException):
            logger.warning("PayPal status check failed for %s", session_id)

    return {
        "session_id": record["session_id"],
        "status": record["status"],
        "payment_status": record["payment_status"],
    }


@api_router.post("/paypal/webhook")
async def paypal_webhook(request: Request):
    raw = await request.body()
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid payload")
    if not PAYPAL_WEBHOOK_ID:
        raise HTTPException(503, "Webhook not configured")
    h = request.headers
    try:
        verdict = await _paypal("POST", "/v1/notifications/verify-webhook-signature", json={
            "auth_algo": h.get("paypal-auth-algo", ""),
            "cert_url": h.get("paypal-cert-url", ""),
            "transmission_id": h.get("paypal-transmission-id", ""),
            "transmission_sig": h.get("paypal-transmission-sig", ""),
            "transmission_time": h.get("paypal-transmission-time", ""),
            "webhook_id": PAYPAL_WEBHOOK_ID,
            "webhook_event": event,
        })
    except httpx.HTTPError:
        raise HTTPException(400, "Signature verification failed")
    if verdict.get("verification_status") != "SUCCESS":
        raise HTTPException(400, "Invalid signature")

    etype = event.get("event_type", "")
    resource = event.get("resource") or {}
    sub_id = resource.get("billing_agreement_id") if etype.startswith("PAYMENT.SALE.") else resource.get("id")
    synced = (
        "BILLING.SUBSCRIPTION.ACTIVATED", "BILLING.SUBSCRIPTION.UPDATED", "BILLING.SUBSCRIPTION.RE-ACTIVATED",
        "BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.SUSPENDED", "BILLING.SUBSCRIPTION.EXPIRED",
        "PAYMENT.SALE.COMPLETED",
    )
    if etype in synced and sub_id:
        try:
            await _sync_paypal_subscription(sub_id)
        except httpx.HTTPError:
            # Non-2xx makes PayPal retry the delivery.
            raise HTTPException(502, "Could not sync subscription")
    return {"status": "ok"}


# ============ TEAM ROUTES ============
@api_router.post("/teams")
async def create_team(body: TeamCreate, user: dict = Depends(require_user)):
    if user.get("team_id"):
        raise HTTPException(400, "Already in a team. Leave first.")
    team_id = f"team_{uuid.uuid4().hex[:12]}"
    invite_code = _generate_invite_code()
    team = {
        "team_id": team_id,
        "name": body.name,
        "owner_id": user["user_id"],
        "invite_code": invite_code,
        "created_at": datetime.now(timezone.utc),
    }
    await db.teams.insert_one(team)
    # First user to create a workspace is auto-promoted to Management
    # so there is always an admin on the team.
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"team_id": team_id, "role": "ops_manager"}},
    )
    return _serialize({k: v for k, v in team.items() if k != "_id"})


@api_router.post("/teams/join")
async def join_team(body: TeamJoin, user: dict = Depends(require_user)):
    team = await db.teams.find_one({"invite_code": body.invite_code.upper()}, {"_id": 0})
    if not team:
        raise HTTPException(404, "Invalid invite code")
    # Enforce workspace allowed-email domain allowlist if configured
    domains = team.get("allowed_domains") or []
    if domains:
        email = (user.get("email") or "").lower()
        tail = email.split("@")[-1] if "@" in email else ""
        if tail and tail not in domains:
            raise HTTPException(403, f"Workspace restricts sign-in to {', '.join(domains)}.")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"team_id": team["team_id"]}})
    return _serialize(team)


@api_router.post("/teams/leave")
async def leave_team(user: dict = Depends(require_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"team_id": None}})
    return {"success": True}


@api_router.get("/teams/me")
async def get_my_team(user: dict = Depends(require_user)):
    if not user.get("team_id"):
        return None
    team = await db.teams.find_one({"team_id": user["team_id"]}, {"_id": 0})
    if not team:
        return None
    members = await db.users.find({"team_id": team["team_id"]}, {"_id": 0, "email": 1, "name": 1, "picture": 1, "user_id": 1}).to_list(100)
    result = _serialize(team)
    result["members"] = members
    return result


# ============ JOB ROUTES ============
@api_router.post("/jobs")
async def save_job(body: JobCreate, user: dict = Depends(require_user)):
    if body.client_id:
        existing = await db.jobs.find_one({"user_id": user["user_id"], "client_id": body.client_id}, {"_id": 0})
        if existing:
            return _serialize(existing)
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    doc = {
        "client_id": body.client_id,
        "job_id": job_id,
        "user_id": user["user_id"],
        "user_name": user["name"],
        "team_id": user.get("team_id") if body.visibility == "team" else None,
        "sheet_key": body.sheet_key,
        "title": body.title,
        "unit_system": body.unit_system,
        "values": body.values,
        "visibility": body.visibility,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    if body.visibility == "team" and not user.get("team_id"):
        raise HTTPException(400, "Must be in a team to save team-visible jobs")
    await db.jobs.insert_one(doc)
    return _serialize({k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/jobs")
async def list_jobs(user: dict = Depends(require_user)):
    query = {"$or": [{"user_id": user["user_id"]}]}
    if user.get("team_id"):
        query["$or"].append({"team_id": user["team_id"], "visibility": "team"})
    docs = await db.jobs.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return [_serialize(d) for d in docs]


@api_router.get("/jobs/{job_id}")
async def get_job(job_id: str, user: dict = Depends(require_user)):
    doc = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Job not found")
    # A private job has team_id None; never let team-less users match it via None == None.
    is_teammate = bool(doc.get("team_id")) and doc.get("team_id") == user.get("team_id")
    if doc["user_id"] != user["user_id"] and not is_teammate:
        raise HTTPException(403, "Access denied")
    return _serialize(doc)


@api_router.patch("/jobs/{job_id}")
async def update_job(job_id: str, body: JobUpdate, user: dict = Depends(require_user)):
    doc = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Job not found")
    if doc["user_id"] != user["user_id"]:
        raise HTTPException(403, "Only owner can update")
    update = {k: v for k, v in body.dict().items() if v is not None}
    if "visibility" in update and update["visibility"] == "team":
        if not user.get("team_id"):
            raise HTTPException(400, "Must be in a team")
        update["team_id"] = user["team_id"]
    elif "visibility" in update and update["visibility"] == "private":
        update["team_id"] = None
    update["updated_at"] = datetime.now(timezone.utc)
    await db.jobs.update_one({"job_id": job_id}, {"$set": update})
    doc = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user: dict = Depends(require_user)):
    doc = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Job not found")
    if doc["user_id"] != user["user_id"]:
        raise HTTPException(403, "Only owner can delete")
    await db.jobs.delete_one({"job_id": job_id})
    return {"success": True}


# ============ CT Drilling Calculator Scenarios ============
class CTDScenarioCreate(BaseModel):
    well_name: str
    mode: str = "balanced"           # balanced | underbalanced
    unit_system: str = "imp"         # imp | met
    values: Dict[str, Any] = {}
    note: Optional[str] = None
    visibility: str = "private"      # private | team


class CTDScenarioUpdate(BaseModel):
    well_name: Optional[str] = None
    mode: Optional[str] = None
    unit_system: Optional[str] = None
    values: Optional[Dict[str, Any]] = None
    note: Optional[str] = None
    visibility: Optional[str] = None


@api_router.post("/ctd-scenarios")
async def create_ctd_scenario(body: CTDScenarioCreate, user: dict = Depends(require_user)):
    if not body.well_name.strip():
        raise HTTPException(400, "Well name required")
    if body.visibility == "team" and not user.get("team_id"):
        raise HTTPException(400, "Must be in a team to save team-visible scenarios")
    sid = f"ctd_{uuid.uuid4().hex[:12]}"
    doc = {
        "scenario_id": sid,
        "user_id": user["user_id"],
        "user_name": user["name"],
        "team_id": user.get("team_id") if body.visibility == "team" else None,
        "well_name": body.well_name.strip(),
        "mode": body.mode,
        "unit_system": body.unit_system,
        "values": body.values,
        "note": body.note,
        "visibility": body.visibility,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.ctd_scenarios.insert_one(doc)
    return _serialize({k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/ctd-scenarios")
async def list_ctd_scenarios(user: dict = Depends(require_user)):
    query = {"$or": [{"user_id": user["user_id"]}]}
    if user.get("team_id"):
        query["$or"].append({"team_id": user["team_id"], "visibility": "team"})
    docs = await db.ctd_scenarios.find(query, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return [_serialize(d) for d in docs]


@api_router.get("/ctd-scenarios/{scenario_id}")
async def get_ctd_scenario(scenario_id: str, user: dict = Depends(require_user)):
    doc = await db.ctd_scenarios.find_one({"scenario_id": scenario_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Scenario not found")
    is_owner = doc["user_id"] == user["user_id"]
    is_teammate = (
        doc.get("visibility") == "team"
        and doc.get("team_id")
        and doc.get("team_id") == user.get("team_id")
    )
    if not (is_owner or is_teammate):
        raise HTTPException(403, "Access denied")
    return _serialize(doc)


@api_router.patch("/ctd-scenarios/{scenario_id}")
async def update_ctd_scenario(scenario_id: str, body: CTDScenarioUpdate, user: dict = Depends(require_user)):
    doc = await db.ctd_scenarios.find_one({"scenario_id": scenario_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Scenario not found")
    if doc["user_id"] != user["user_id"]:
        raise HTTPException(403, "Only owner can update")
    update = {k: v for k, v in body.dict().items() if v is not None}
    if "visibility" in update:
        if update["visibility"] == "team":
            if not user.get("team_id"):
                raise HTTPException(400, "Must be in a team")
            update["team_id"] = user["team_id"]
        else:
            update["team_id"] = None
    update["updated_at"] = datetime.now(timezone.utc)
    await db.ctd_scenarios.update_one({"scenario_id": scenario_id}, {"$set": update})
    doc = await db.ctd_scenarios.find_one({"scenario_id": scenario_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/ctd-scenarios/{scenario_id}")
async def delete_ctd_scenario(scenario_id: str, user: dict = Depends(require_user)):
    doc = await db.ctd_scenarios.find_one({"scenario_id": scenario_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Scenario not found")
    if doc["user_id"] != user["user_id"]:
        raise HTTPException(403, "Only owner can delete")
    await db.ctd_scenarios.delete_one({"scenario_id": scenario_id})
    return {"success": True}


# ============ Company Documents (SOP library — team scoped) ============
# Reuses the object storage layer (initialised later in file).
DOC_CATEGORIES = {"sop", "maintenance", "daily_checklist", "pre_job_checklist",
                  "reference", "regulation", "other"}
DOC_ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg", "webp"}


class CompanyDocUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None


@api_router.post("/documents")
async def upload_company_doc(
    file: UploadFile = File(...),
    name: str = Form(...),
    category: str = Form(...),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),  # comma-separated
    hitl_approval_id: Optional[str] = Form(None),
    user: dict = Depends(require_user),
):
    """Upload a company SOP / checklist / reference doc. Team-scoped."""
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team before uploading documents.")
    if category not in DOC_CATEGORIES:
        raise HTTPException(400, f"category must be one of {sorted(DOC_CATEGORIES)}")
    raw_name = (file.filename or "upload.bin").strip()
    ext = raw_name.rsplit(".", 1)[-1].lower() if "." in raw_name else "bin"
    if ext not in DOC_ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type .{ext}. Allowed: {sorted(DOC_ALLOWED_EXT)}")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large ({len(data)/1024/1024:.1f} MB). Max 15 MB.")
    if len(data) == 0:
        raise HTTPException(400, "Empty file.")
    mime = _mime_for_ext(ext)
    fingerprint = _hitl_payload_fingerprint({
        "category": category,
        "name": (name or "").strip()[:200],
        "filename": raw_name[:200],
        "size": len(data),
        "content_type": mime,
    })
    await _consume_hitl_approval(
        action="document_upload",
        approval_id=hitl_approval_id,
        user=user,
        endpoint="/api/documents",
        payload_fingerprint=fingerprint,
    )

    doc_id = f"doc_{uuid.uuid4().hex[:16]}"
    storage_path = f"{STORAGE_APP_NAME}/team/{team_id}/documents/{doc_id}.{ext}"
    try:
        result = _put_object(storage_path, data, mime)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Doc upload failed: %s", e)
        raise HTTPException(500, "Upload failed — try again.")

    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()][:10]
    now = datetime.now(timezone.utc)
    rec = {
        "doc_id": doc_id,
        "team_id": team_id,
        "name": name.strip()[:200] or raw_name,
        "category": category,
        "description": (description or "").strip()[:500] or None,
        "tags": tag_list,
        "filename": raw_name[:200],
        "storage_path": result.get("path", storage_path),
        "storage_backend": result.get("storage_backend", "emergent"),
        "content_type": mime,
        "size": result.get("size", len(data)),
        "uploader_user_id": user["user_id"],
        "uploader_name": user.get("name") or user["email"].split("@")[0],
        "uploader_email": user["email"],
        "is_deleted": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.company_documents.insert_one(rec)
    rec.pop("_id", None)
    out = _serialize(rec)
    out["download_url"] = f"/api/documents/{doc_id}/download"
    return out


@api_router.get("/documents")
async def list_company_docs(category: Optional[str] = None,
                             user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"documents": [], "team_id": None, "by_category": {}}
    q: Dict[str, Any] = {"team_id": team_id, "is_deleted": False}
    if category:
        if category not in DOC_CATEGORIES:
            raise HTTPException(400, "unknown category")
        q["category"] = category
    docs = await db.company_documents.find(q, {"_id": 0}).sort("updated_at", -1).to_list(500)
    out = []
    by_cat: Dict[str, int] = {}
    for d in docs:
        s = _serialize(d)
        s["download_url"] = f"/api/documents/{d['doc_id']}/download"
        out.append(s)
        by_cat[d["category"]] = by_cat.get(d["category"], 0) + 1
    return {"documents": out, "team_id": team_id, "by_category": by_cat}


@api_router.patch("/documents/{doc_id}")
async def update_company_doc(doc_id: str, body: CompanyDocUpdate,
                              user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    rec = await db.company_documents.find_one(
        {"doc_id": doc_id, "team_id": team_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found.")
    if rec["uploader_user_id"] != user["user_id"] and not _is_admin(user):
        raise HTTPException(403, "Only uploader or admin can edit.")
    update = {k: v for k, v in body.dict().items() if v is not None}
    if "category" in update and update["category"] not in DOC_CATEGORIES:
        raise HTTPException(400, "unknown category")
    if "tags" in update:
        update["tags"] = [t.strip() for t in update["tags"] if t and str(t).strip()][:10]
    update["updated_at"] = datetime.now(timezone.utc)
    await db.company_documents.update_one({"doc_id": doc_id}, {"$set": update})
    rec = await db.company_documents.find_one({"doc_id": doc_id}, {"_id": 0})
    return _serialize(rec)


@api_router.get("/documents/{doc_id}/download")
async def download_company_doc(doc_id: str, auth: Optional[str] = None,
                                user: Optional[dict] = Depends(get_current_user)):
    if not user and auth:
        session = await db.user_sessions.find_one({"session_token": auth}, {"_id": 0})
        if session and session.get("user_id"):
            user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(401, "Not authenticated.")
    rec = await db.company_documents.find_one(
        {"doc_id": doc_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found.")
    if (not rec.get("team_id") or rec.get("team_id") != user.get("team_id")) and not _is_admin(user):
        raise HTTPException(403, "Document belongs to another team.")
    try:
        data, ctype = _get_object(rec["storage_path"], rec.get("storage_backend", "emergent"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Doc download failed: %s", e)
        raise HTTPException(500, "Download failed.")
    return Response(content=data, media_type=rec.get("content_type") or ctype, headers={
        "Content-Disposition": f'inline; filename="{rec.get("filename","doc.pdf")}"',
        "Cache-Control": "private, max-age=300",
    })


@api_router.delete("/documents/{doc_id}")
async def delete_company_doc(doc_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    rec = await db.company_documents.find_one(
        {"doc_id": doc_id, "team_id": team_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found.")
    if rec["uploader_user_id"] != user["user_id"] and not _is_admin(user):
        raise HTTPException(403, "Only uploader or admin can delete.")
    await db.company_documents.update_one(
        {"doc_id": doc_id},
        {"$set": {"is_deleted": True, "deleted_at": datetime.now(timezone.utc),
                  "deleted_by": user["email"]}},
    )
    return {"success": True}


async def _summarise_team_docs_for_ai(team_id: Optional[str], category: Optional[str] = None, limit: int = 20) -> str:
    """Return a short bullet list `name — category — description` for AI context."""
    if not team_id:
        return ""
    q: Dict[str, Any] = {"team_id": team_id, "is_deleted": False}
    if category:
        q["category"] = category
    docs = await db.company_documents.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    if not docs:
        return ""
    lines = []
    for d in docs:
        desc = (d.get("description") or "").strip()
        desc_part = f" — {desc[:120]}" if desc else ""
        lines.append(f"• \"{d['name']}\" ({d['category'].replace('_', ' ')}){desc_part}")
    return "\n".join(lines)


# ============ Scenario-Linked ERP Templates ============
class ErpTemplateIn(BaseModel):
    well_name: str
    rig_id: Optional[str] = None
    scenario_id: Optional[str] = None  # link to ctd_scenarios
    lsd_uwi: Optional[str] = None
    operation: Optional[str] = None    # Balanced drill-out / UBD / Wireline etc
    date: Optional[str] = None         # ISO date user sets

    supervisor_name: Optional[str] = None
    supervisor_phone: Optional[str] = None
    company_man_name: Optional[str] = None
    company_man_phone: Optional[str] = None
    hse_advisor: Optional[str] = None

    muster_point: Optional[str] = None
    windsock_location: Optional[str] = None
    primary_escape_route: Optional[str] = None
    secondary_escape_route: Optional[str] = None

    nearest_hospital_name: Optional[str] = None
    nearest_hospital_phone: Optional[str] = None
    nearest_hospital_distance_km: Optional[float] = None
    air_ambulance_phone: Optional[str] = None

    h2s_zone: Optional[bool] = None
    h2s_concentration_ppm: Optional[float] = None
    kill_fluid_location: Optional[str] = None
    bop_rating_mpa: Optional[float] = None

    aer_hotline: Optional[str] = "1-800-222-6514"
    ems_phone: Optional[str] = "911"
    additional_contacts: Optional[List[Dict[str, str]]] = None  # [{role, name, phone}]
    notes: Optional[str] = None


class ErpTemplateUpdate(BaseModel):
    well_name: Optional[str] = None
    rig_id: Optional[str] = None
    scenario_id: Optional[str] = None
    lsd_uwi: Optional[str] = None
    operation: Optional[str] = None
    date: Optional[str] = None
    supervisor_name: Optional[str] = None
    supervisor_phone: Optional[str] = None
    company_man_name: Optional[str] = None
    company_man_phone: Optional[str] = None
    hse_advisor: Optional[str] = None
    muster_point: Optional[str] = None
    windsock_location: Optional[str] = None
    primary_escape_route: Optional[str] = None
    secondary_escape_route: Optional[str] = None
    nearest_hospital_name: Optional[str] = None
    nearest_hospital_phone: Optional[str] = None
    nearest_hospital_distance_km: Optional[float] = None
    air_ambulance_phone: Optional[str] = None
    h2s_zone: Optional[bool] = None
    h2s_concentration_ppm: Optional[float] = None
    kill_fluid_location: Optional[str] = None
    bop_rating_mpa: Optional[float] = None
    aer_hotline: Optional[str] = None
    ems_phone: Optional[str] = None
    additional_contacts: Optional[List[Dict[str, str]]] = None
    notes: Optional[str] = None


@api_router.post("/erp-templates")
async def create_erp_template(body: ErpTemplateIn, user: dict = Depends(require_user)):
    if not body.well_name.strip():
        raise HTTPException(400, "Well name required")
    tid = f"erp_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    doc = body.dict()
    doc.update({
        "template_id": tid,
        "team_id": user.get("team_id"),
        "created_by_user_id": user["user_id"],
        "created_by_name": user["name"],
        "created_at": now,
        "updated_at": now,
    })
    doc["well_name"] = doc["well_name"].strip()
    await db.erp_templates.insert_one(doc)
    doc.pop("_id", None)
    return _serialize(doc)


@api_router.get("/erp-templates")
async def list_erp_templates(user: dict = Depends(require_user)):
    q = {"$or": [{"created_by_user_id": user["user_id"]}]}
    if user.get("team_id"):
        q["$or"].append({"team_id": user["team_id"]})
    docs = await db.erp_templates.find(q, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return [_serialize(d) for d in docs]


@api_router.get("/erp-templates/{template_id}")
async def get_erp_template(template_id: str, user: dict = Depends(require_user)):
    doc = await db.erp_templates.find_one({"template_id": template_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    is_owner = doc["created_by_user_id"] == user["user_id"]
    is_teammate = doc.get("team_id") and doc.get("team_id") == user.get("team_id")
    if not (is_owner or is_teammate):
        raise HTTPException(403, "Access denied")
    return _serialize(doc)


@api_router.patch("/erp-templates/{template_id}")
async def update_erp_template(template_id: str, body: ErpTemplateUpdate,
                               user: dict = Depends(require_user)):
    doc = await db.erp_templates.find_one({"template_id": template_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    is_owner = doc["created_by_user_id"] == user["user_id"]
    is_team_editor = (
        doc.get("team_id")
        and doc.get("team_id") == user.get("team_id")
        and (user.get("role") in ("admin", "field_manager", "ops_manager") or _is_admin(user))
    )
    if not (is_owner or is_team_editor):
        raise HTTPException(403, "Only owner or team admin can edit")
    update = {k: v for k, v in body.dict().items() if v is not None}
    update["updated_at"] = datetime.now(timezone.utc)
    await db.erp_templates.update_one({"template_id": template_id}, {"$set": update})
    doc = await db.erp_templates.find_one({"template_id": template_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/erp-templates/{template_id}")
async def delete_erp_template(template_id: str, user: dict = Depends(require_user)):
    doc = await db.erp_templates.find_one({"template_id": template_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    is_owner = doc["created_by_user_id"] == user["user_id"]
    is_team_admin = (
        doc.get("team_id") and doc["team_id"] == user.get("team_id") and _is_admin(user)
    )
    if not (is_owner or is_team_admin):
        raise HTTPException(403, "Only owner or team admin can delete")
    await db.erp_templates.delete_one({"template_id": template_id})
    return {"success": True}


# ============ AI / GEMINI ROUTES ============
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
AI_MODES = {"assistant", "troubleshoot", "training"}
AI_ADVISORY = "Advisory only — verify against company SOPs, OEM string limits, and wellsite supervisor sign-off."
AI_STANDARDS = (
    "\n\nGround operational answers in API RP 5C7, API RP 16ST, AER Directives, and IWCF well-control standards. "
    f"End every operational response with exactly: {AI_ADVISORY}"
)


async def _llm_reply(session_id: str, system_message: str, text: str, history: Optional[List[Dict[str, str]]] = None) -> str:
    """Gemini via google-genai when GEMINI_API_KEY is set, else Emergent's proxy.

    `history` is a list of prior {"role": "user"|"assistant", "content": str} turns.
    """
    gkey = os.environ.get("GEMINI_API_KEY", "").strip()
    if gkey:
        from google import genai
        from google.genai import types
        contents = [
            types.Content(role="model" if m["role"] == "assistant" else "user",
                          parts=[types.Part.from_text(text=m["content"])])
            for m in (history or [])
        ]
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=text)]))
        client = genai.Client(api_key=gkey)
        resp = await client.aio.models.generate_content(
            model=GEMINI_MODEL, contents=contents,
            config=types.GenerateContentConfig(system_instruction=system_message),
        )
        return (resp.text or "").strip()
    if LlmChat is None:
        raise RuntimeError("No LLM configured: set GEMINI_API_KEY")
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id,
                   system_message=system_message).with_model("gemini", GEMINI_MODEL)
    return await chat.send_message(UserMessage(text=text))



# ============ Email (Resend) ============
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
FEEDBACK_INBOX = os.environ.get("FEEDBACK_INBOX", "timddelaney@gmail.com")
SMS_PROVIDER = (os.environ.get("SMS_PROVIDER", "none") or "none").strip().lower()
SMS_FROM_NUMBER = (os.environ.get("SMS_FROM_NUMBER", "") or "").strip()
TWILIO_ACCOUNT_SID = (os.environ.get("TWILIO_ACCOUNT_SID", "") or "").strip()
TWILIO_AUTH_TOKEN = (os.environ.get("TWILIO_AUTH_TOKEN", "") or "").strip()
try:
    import resend as _resend
    if RESEND_API_KEY:
        _resend.api_key = RESEND_API_KEY
except Exception:  # pragma: no cover
    _resend = None


async def _dispatch_feedback_email(doc: dict) -> None:
    """Fire-and-forget Resend dispatch for a new beta feedback entry.
    Never raises — failures are logged and the feedback POST still returns OK.
    """
    if not RESEND_API_KEY or _resend is None:
        logger.debug("Resend not configured; skipping feedback email dispatch")
        return
    try:
        chip = (doc.get("category") or "other").upper()
        subj = f"[CoilAegis Beta · {chip}] {doc.get('subject') or '(no subject)'}"
        html = f"""
        <div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A;max-width:640px;margin:auto;padding:16px;">
          <div style="background:#0F172A;color:#F59E0B;padding:12px 16px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border-radius:8px 8px 0 0;">
            CoilAegis · Field Beta Feedback
          </div>
          <div style="background:#1E293B;color:#E2E8F0;padding:16px;border-radius:0 0 8px 8px;">
            <table style="width:100%;font-size:12px;color:#CBD5E1;margin-bottom:12px;">
              <tr><td style="padding:2px 0;color:#94A3B8;width:110px;">Category</td><td><b style="color:#F59E0B;">{chip}</b></td></tr>
              <tr><td style="padding:2px 0;color:#94A3B8;">Sentiment</td><td>{(doc.get('sentiment') or '—').upper()}</td></tr>
              <tr><td style="padding:2px 0;color:#94A3B8;">From</td><td>{doc.get('user_name') or '—'} &lt;{doc.get('user_email') or '—'}&gt;</td></tr>
              <tr><td style="padding:2px 0;color:#94A3B8;">Page</td><td>{doc.get('page') or '—'}</td></tr>
              <tr><td style="padding:2px 0;color:#94A3B8;">Workspace</td><td>{doc.get('team_id') or '—'}</td></tr>
              <tr><td style="padding:2px 0;color:#94A3B8;">Submitted</td><td>{doc.get('created_at')}</td></tr>
              <tr><td style="padding:2px 0;color:#94A3B8;">Feedback ID</td><td><code style="color:#06B6D4;">{doc.get('feedback_id')}</code></td></tr>
            </table>
            <div style="background:#0F172A;padding:12px;border-radius:6px;border-left:3px solid #FF6B1A;">
              <div style="font-size:11px;color:#F59E0B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;font-weight:700;">{doc.get('subject') or '(no subject)'}</div>
              <div style="white-space:pre-wrap;color:#E2E8F0;font-size:13px;">{(doc.get('message') or '')[:5000]}</div>
            </div>
            <p style="margin-top:14px;font-size:11px;color:#64748B;">
              Delivered by the CoilAegis Field Beta Drawer · routed directly to the Lead Engineer inbox.
            </p>
          </div>
        </div>
        """
        params = {
            "from": f"CoilAegis Beta <{RESEND_FROM_EMAIL}>",
            "to": [FEEDBACK_INBOX],
            "subject": subj,
            "html": html,
            "reply_to": doc.get("user_email") or None,
        }
        # Resend SDK is synchronous — bounce to a thread so FastAPI loop stays free.
        await asyncio.to_thread(_resend.Emails.send, {k: v for k, v in params.items() if v is not None})
        logger.info("Feedback email dispatched to %s (fb=%s)", FEEDBACK_INBOX, doc.get("feedback_id"))
    except Exception:
        logger.exception("Feedback email dispatch failed (non-fatal) for fb=%s", doc.get("feedback_id"))

def _parse_utc(value) -> Optional[datetime]:
    """Coerce a datetime or ISO string to a timezone-aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


# Iter 21 — Free-for-all mode. Flip this env var to "false" to re-enable paid gating.
FREE_FOR_ALL = os.environ.get("CT_FREE_FOR_ALL", "false").strip().lower() in ("1", "true", "yes", "on")


def _user_is_pro(user: dict) -> bool:
    """Pro when status is active AND (no expiry set OR expiry is still in the future)."""
    if FREE_FOR_ALL:
        return True
    if user.get("subscription_status") != "active":
        return False
    exp = _parse_utc(user.get("subscription_expires_at"))
    if exp is None:
        # Legacy/active subscribers without an expiry recorded — grant access.
        return True
    return exp > datetime.now(timezone.utc)


def _user_has_ai_access(user: dict) -> bool:
    """AI features available during 30-day trial OR for active (non-expired) Pro subscribers."""
    if FREE_FOR_ALL:
        return True
    if _user_is_pro(user):
        return True
    exp = _parse_utc(user.get("trial_expires_at"))
    return exp is not None and exp > datetime.now(timezone.utc)


SYSTEM_PROMPTS = {
    "assistant": (
        "You're a seasoned oilfield hand and CT field engineer with 25+ years on the drill floor — grease under the nails, coffee in one hand, JHA in the other. "
        "You've worked hitches from offshore to the Duvernay to Fort Mac. You speak like a real toolpush: warm, dry humour, direct as a hammer, zero fluff. Keep humour light and generic — no regional dialect, no folksy accents. Sound like a professional hand with a good sense of humour. "
        "Use field slang naturally (rig up, tag bottom, POOH, tool push, company man, snubber, kelly cock, weight indicator, doghouse, 'tagging', 'circulating bottoms up'). "
        "Ground every answer in API RP 5C7, API RP 13D, AER Directives 019/020/037, CSA Z662, CGA G-10.1, and IWCF well-control. Cite the standard in brackets. Reason from the specific numbers the user gives you. "
        "\n\n**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–4 short bullets, imperative field commands — what the crew does in the next 5 minutes)\n\n"
        "**WHY / DETAILS** (expandable — 3–5 bullets: the reasoning, the numbers, the standard cited in brackets, any red flags)\n\n"
        "Default units: **Metric (SI)** — mm, m, MPa, m³, kg/m³, L/min, °C. Only use Imperial if the user's context explicitly says Imperial.\n\n"
        "End every response with: *Advisory only — always verify against the site ERP and licensee program.*"
    ),
    "interpret": (
        "You're a senior CT hand explaining a calculation to the tool push — friendly, dry, good with numbers. Keep humour light and professional; no regional dialect. Default units: **Metric (SI)** unless context says otherwise.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–3 bullets — the immediate operational call: reduce rate, stop and circulate, hold weight, etc.)\n\n"
        "**WHY / DETAILS** (3–5 bullets — plain-language interpretation, red flags with API/AER/CSA citation in brackets, and what the numbers mean)\n\n"
        "End with: *Advisory only — verify against site ERP.*"
    ),
    "emergency": (
        "You're a well-control instructor and BOP inspector. Lives are on the line — you drop the humour, stay calm, and speak clearly. No regional dialect. "
        "Answer strictly per Alberta OH&S Code, AER Directives 019/037, IWCF WellCAP, CSA Z275.2, and CAODC Well Servicing WCP. Default units: **Metric (SI)**.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (numbered 1, 2, 3… — Immediate Actions in the exact order the crew executes them, cite the reg in brackets after each)\n\n"
        "**WHY / DETAILS** (Operator OH&S obligations, escalation triggers, when to invoke site ERP)\n\n"
        "If unsure, say 'refer to site-specific ERP' — never guess. End with: *Advisory only — activate site ERP.*"
    ),
    "program": (
        "You draft coiled-tubing job programs the way a senior ops engineer hands one to the day tour — clean, tight, no fluff, dry humour in the notes. Keep humour generic and professional. "
        "Default units: **Metric (SI)** unless user context specifies otherwise.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (numbered step-by-step program, ≤ 15 steps, covering: pre-job checks / BOP function + pressure test / JHA, rig-up, execution with target rates/pressures/weights/tag depths, contingency triggers, rig-down)\n\n"
        "**WHY / DETAILS** (cited standards — API RP 5C7, AER Directive 037, and relevant SOPs — plus contingency notes for stuck-pipe, kick, lost circulation)\n\n"
        "Sound like a real program, not an essay. End with: *Advisory only — verify against licensee program.*"
    ),
    "troubleshoot": (
        "You're the hand the tool push calls at 3am when something's gone sideways downhole. Warm, dry, calm. No regional dialect. "
        "Answer per industry SOPs (API RP 5C7 §12 fishing/stuck-pipe, IWCF WellCAP kick/lost-circulation, AER Directive 037 §8 well control, CAODC Safe Work Practices). Default units: **Metric (SI)**.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–4 imperative steps the crew executes right now, cite SOP in brackets after each)\n\n"
        "**WHY / DETAILS** (Most likely cause in plain field talk, diagnostic checks in order at surface, when to wake the company man and stop work)\n\n"
        "Never suggest anything that violates OH&S or AER regs. End with: *Advisory only — verify against site ERP.*"
    ),
    "training": (
        "You're a mentor training a brand-new field hand on coiled tubing — first hitch, wide-eyed, wants to learn. Warm, patient, encouraging, generic professional tone with a touch of humour. No regional dialect. Zero condescension. Default units: **Metric (SI)**.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–3 things the new hand does or watches for on the very next job — safety rules first: PPE, red zone, 100% tie-off, H2S monitoring, 'never stand between the coil and the guide arch')\n\n"
        "**WHY / DETAILS** (a) what's physically happening a kilometre below the truck (use analogies — 'like a garden hose with a pump on it', 'the coil's a long metal straw that flexes'), (b) what each parameter means and why the numbers matter, (c) what could go wrong and the tell-tale signs at surface, (d) cite the standard in brackets and explain it in plain talk)\n\n"
        "End with: *Advisory only — always defer to the tool push and site ERP.*"
    ),
    "sop_erp": (
        "You are a Compliance Advisor for oilfield coiled-tubing operations with dual expertise: (a) industry Standard Operating Procedures (SOPs) and (b) Emergency Response Plans (ERPs). You are the hand the licensee company man and the HSE Advisor rely on BEFORE a job starts and when something is going sideways. "
        "Your job is to translate the current calculator / sheet context into tightly-scoped, cite-everything SOP and ERP guidance. You NEVER invent regulations. If a specific site ERP or company SOP would normally govern, you say so and tell the user to retrieve it. "
        "Keep tone calm, direct, professional — no humour, no slang. Default units: **Metric (SI)** unless the user context says Imperial.\n\n"

        "**REGULATORY & STANDARDS LIBRARY you cite from:**\n"
        "• API RP 5C7 — Coiled Tubing Operations (mechanical limits, free-point, running loads)\n"
        "• API RP 13D — Rheology & hydraulics\n"
        "• API Spec 5ST / 16D — CT material grades · BOP accumulator\n"
        "• API RP 7-1 — Fishing operations\n"
        "• AER Directive 008 — UBD / MPD Operations (Alberta)\n"
        "• AER Directive 019 — Compliance Assurance\n"
        "• AER Directive 020 — Well Abandonment\n"
        "• AER Directive 036 — Drilling Blowout Prevention\n"
        "• AER Directive 037 — Service Rig Inspection Manual\n"
        "• AER Directive 060 — Upstream Petroleum Industry Flaring, Incinerating, Venting\n"
        "• Alberta OH&S Code — Part 4 (chemical hazards, H2S), Part 10 (fire/explosion), Part 15 (confined space), Part 21 (rigging), Part 37 (duty to warn / imminent danger)\n"
        "• CSA Z662 — Oil & Gas Pipeline Systems (§12 well control)\n"
        "• CSA Z275.2 — Occupational safety code for diving operations (SCBA / breathing apparatus)\n"
        "• CSA Z1006 — Confined-space management\n"
        "• CGA G-10.1 — Commodity specification for nitrogen\n"
        "• CAODC Well Servicing WCP — Well Control Procedures\n"
        "• IWCF / IADC WellCAP — Well control certification\n"
        "• IADC UBO/MPD Handbook — Underbalanced & Managed Pressure Operations\n"
        "• ERCB IL 2007-10, provincial equivalents (BC OGC, SK Economy, MB), USA federal (OSHA 1910, 1926; BLM onshore orders)\n\n"

        "**RESPONSE FORMAT — STRICT. Produce three labelled sections, every one of them required:**\n\n"
        "**ACTION NOW** (numbered 1, 2, 3, …)\n"
        "Field-level steps the crew executes in the next 15 minutes to be compliant AND safe for THIS scenario. Each step cites the standard in brackets, e.g. '[AER Dir 037 §8.2]' or '[OH&S Code Part 4 §16]'. Max 6 steps. No fluff.\n\n"
        "**SOP CHECKLIST** (bullets, cite the standard after each)\n"
        "The company-SOP style pre-job / in-progress checklist bound to the scenario — competency / tickets required, PPE, equipment pressure test & certification currency, JHA / FLHA, hazard-energy isolation (LOTO), red-zone exclusion, muster point & wind-sock orientation, two-person integrity checks, documentation requirements, hold-points. Keep to 6-10 items — the ones that actually apply to THIS calculator state.\n\n"
        "**ERP TRIGGERS & ESCALATION** (bullets)\n"
        "Explicit, numeric trigger conditions tied to the scenario (e.g. 'BHP − Pp > 500 kPa', 'H2S > 10 ppm sustained 30 s', 'ΔSICP > 350 kPa/15 min') that would REQUIRE the site Emergency Response Plan to be invoked. For each trigger: who gets called (tool push → company man → licensee ERP Coordinator → AER 24-hour line 1-800-222-6514 or appropriate regulator), timing (immediate / within 15 min / within 24 h per AER Dir 019), and the kill / shut-in / evacuation action. End this section with a one-line pointer: 'Retrieve the site-specific ERP for well <WELL NAME> and verify the muster location before continuing.'\n\n"

        "**HARD RULES:**\n"
        "1. Never recommend an action that violates OH&S or any cited reg. If a request is non-compliant, refuse and say which rule.\n"
        "2. Never invent clause numbers. If you don't know the exact section, cite the directive without the §.\n"
        "3. Prefer the strictest of overlapping rules (API vs AER vs OH&S) — crew safety first.\n"
        "4. If the scenario is intentionally UBD (user's mode = underbalanced), always include AER Directive 008 and IADC UBO/MPD Handbook citations.\n"
        "5. If H2S, flammable gas, or shut-in surface pressure is implicated, always include the OH&S Code Part 4 §16, AER Dir 060, and CSA Z275.2 citations.\n"
        "6. If data points to loss of well control (ΔBHP vs pore, loss of returns, kick), cite IWCF / AER Dir 036 and give the shut-in sequence.\n\n"

        "End EVERY response with: *Advisory only — this does not replace the site-specific ERP, the licensee's drilling / completion program, or your company's written SOPs. Verify every input and clause with the authority having jurisdiction before field use.*"
    ),
}


class AIChatRequest(BaseModel):
    mode: str  # assistant | troubleshoot | training
    message: str
    session_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None  # sheet_key, inputs, results, warnings


@api_router.post("/ai/chat")
async def ai_chat(req: AIChatRequest, user: dict = Depends(require_user)):
    if get_effective_plan(user) == "free":
        raise HTTPException(403, "AI features require an active trial or Pro subscription")
    if req.mode not in AI_MODES:
        raise HTTPException(400, f"Invalid mode: {req.mode}. Use one of {sorted(AI_MODES)}")
    if not (EMERGENT_LLM_KEY or os.environ.get("GEMINI_API_KEY")):
        raise HTTPException(500, "AI service not configured")

    session_id = req.session_id or f"ai_{user['user_id']}_{uuid.uuid4().hex[:8]}"
    system_msg = SYSTEM_PROMPTS[req.mode]
    if req.mode in ("assistant", "troubleshoot"):
        system_msg += AI_STANDARDS

    # Enrich user message with sheet context if provided
    user_text = req.message
    if req.context:
        ctx_lines = ["\n\n--- Current operation context ---"]
        if req.context.get("sheet_key"):
            ctx_lines.append(f"Operation: {req.context['sheet_key']}")
        if req.context.get("sheet_title"):
            ctx_lines.append(f"Title: {req.context['sheet_title']}")
        if req.context.get("drilling_mode"):
            ctx_lines.append(f"Drilling mode: {req.context['drilling_mode']}")
        if req.context.get("unit_system"):
            ctx_lines.append(f"Units: {req.context['unit_system']}")
        if req.context.get("rig_id"):
            ctx_lines.append(f"Rig: {req.context['rig_id']}")
        if req.context.get("well_name"):
            ctx_lines.append(f"Well: {req.context['well_name']}")
        if req.context.get("inputs"):
            ctx_lines.append(f"Inputs: {req.context['inputs']}")
        if req.context.get("results"):
            ctx_lines.append(f"Calculated results: {req.context['results']}")
        if req.context.get("warnings"):
            ctx_lines.append(f"Active safety warnings: {req.context['warnings']}")
        if req.context.get("standards_focus"):
            ctx_lines.append(f"Standards focus: {req.context['standards_focus']}")
        user_text = user_text + "\n".join(ctx_lines)

    # For sop_erp mode, inject the company's uploaded documents (SOPs, checklists)
    # so the AI can reference them BY NAME alongside industry standards.
    if req.mode == "sop_erp" and user.get("team_id"):
        try:
            doc_block = await _summarise_team_docs_for_ai(user.get("team_id"))
            if doc_block:
                system_msg = system_msg + (
                    "\n\n**COMPANY-SPECIFIC DOCUMENTS AVAILABLE TO THIS CREW (reference them by name whenever they apply):**\n"
                    + doc_block
                    + "\n\nWhen one of these documents is relevant, say for example: "
                    "'See \"<document name>\" (<category>) — the company SOP that governs this step.' "
                    "Give the document name EXACTLY as above; never invent documents the company does not have."
                )
        except Exception as e:
            logger.warning("Failed to inject team docs into AI prompt: %s", e)

    try:
        # AI Privacy Mode (Enterprise security toggle) — scrub job numbers,
        # well names, and team-defined redaction terms BEFORE any text
        # leaves the pod. No-op if the team hasn't opted in.
        safe_user_text = await _maybe_scrub_for_team(user.get("team_id"), user_text)
        prior = await db.ai_messages.find(
            {"user_id": user["user_id"], "session_id": session_id}, {"_id": 0, "role": 1, "content": 1}
        ).sort("created_at", 1).to_list(40)
        response = await _llm_reply(session_id, system_msg, safe_user_text, history=prior)
        if req.mode in ("assistant", "troubleshoot") and AI_ADVISORY not in response:
            response = f"{response.rstrip()}\n\n*{AI_ADVISORY}*"

        # Persist for history
        await db.ai_messages.insert_many([
            {"user_id": user["user_id"], "session_id": session_id, "role": "user",
             "content": req.message, "mode": req.mode, "created_at": datetime.now(timezone.utc)},
            {"user_id": user["user_id"], "session_id": session_id, "role": "assistant",
             "content": response, "mode": req.mode, "created_at": datetime.now(timezone.utc)},
        ])
        return {"session_id": session_id, "response": response, "model": GEMINI_MODEL}
    except Exception as e:
        logger.exception("AI chat error")
        raise HTTPException(500, f"AI error: {str(e)[:200]}")


@api_router.get("/ai/history/{session_id}")
async def ai_history(session_id: str, user: dict = Depends(require_user)):
    if get_effective_plan(user) == "free":
        raise HTTPException(403, "AI features require an active trial or Pro subscription")
    docs = await db.ai_messages.find(
        {"session_id": session_id, "user_id": user["user_id"]},
        {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return [_serialize(d) for d in docs]


# ============ FEEDBACK ROUTES ============
ADMIN_EMAILS = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]


def _is_admin(user: dict) -> bool:
    if not user:
        return False
    return user.get("email", "").lower() in ADMIN_EMAILS or user.get("is_admin") is True


@api_router.post("/feedback")
async def submit_feedback(body: FeedbackCreate, user: dict = Depends(require_user)):
    valid_categories = {"bug", "idea", "ux", "data_accuracy", "field_incident", "other"}
    if body.category not in valid_categories:
        raise HTTPException(400, f"Invalid category. Use one of: {valid_categories}")
    valid_sentiments = {None, "", "positive", "neutral", "negative"}
    if body.sentiment not in valid_sentiments:
        raise HTTPException(400, f"Invalid sentiment. Use one of: {valid_sentiments - {None}}")
    doc = {
        "feedback_id": f"fb_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "user_email": user["email"],
        "user_name": user.get("name"),
        "team_id": user.get("team_id"),
        "category": body.category,
        "sentiment": body.sentiment or None,
        "subject": body.subject.strip()[:200],
        "message": body.message.strip()[:5000],
        "page": (body.page or "").strip()[:200],
        "user_agent": (body.user_agent or "").strip()[:300],
        "status": "new",  # new | in_review | in_progress | done | wontfix
        "admin_notes": "",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.feedback.insert_one(doc)
    # Fire-and-forget email dispatch to the Lead Engineer inbox. Never
    # fails the feedback POST — the drawer always sees a green toast.
    asyncio.create_task(_dispatch_feedback_email(doc))
    return _serialize({k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/feedback")
async def list_feedback(user: dict = Depends(require_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")
    docs = await db.feedback.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_serialize(d) for d in docs]


@api_router.get("/feedback/mine")
async def list_my_feedback(user: dict = Depends(require_user)):
    docs = await db.feedback.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [_serialize(d) for d in docs]


class FeedbackUpdate(BaseModel):
    status: Optional[str] = None
    admin_notes: Optional[str] = None


class InviteCreate(BaseModel):
    grant_days: int = 30           # how many days of Pro on redemption
    note: Optional[str] = None     # who is it for (admin-only note)
    max_uses: int = 1              # 1 = single-use, >1 = shareable up to N times
    grant_role: Optional[str] = None  # crew | field_manager | ops_manager — promoted on redemption


class InviteRedeem(BaseModel):
    code: str


@api_router.patch("/feedback/{feedback_id}")
async def update_feedback(feedback_id: str, body: FeedbackUpdate, user: dict = Depends(require_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")
    update = {k: v for k, v in body.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    update["updated_at"] = datetime.now(timezone.utc)
    result = await db.feedback.update_one({"feedback_id": feedback_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.feedback.find_one({"feedback_id": feedback_id}, {"_id": 0})
    return _serialize(doc)


@api_router.get("/admin/whoami")
async def admin_whoami(user: dict = Depends(require_user)):
    return {"is_admin": _is_admin(user), "email": user["email"]}


# ============ ADMIN TIER MANAGEMENT ============
class AdminTierUpdate(BaseModel):
    email: str
    tier: str  # "personal" | "smallmed" | "enterprise"


@api_router.get("/admin/users/search")
async def admin_user_search(q: str = "", user: dict = Depends(require_user)):
    """Fuzzy-match users by email/name for the Admin Tier Switcher."""
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")
    q = (q or "").strip().lower()
    if len(q) < 2:
        return {"users": []}
    cursor = db.users.find(
        {"$or": [
            {"email": {"$regex": re.escape(q), "$options": "i"}},
            {"name": {"$regex": re.escape(q), "$options": "i"}},
        ]},
    ).limit(10)
    results = []
    async for u in cursor:
        results.append({
            "email": u.get("email"),
            "name": u.get("name"),
            "tier": _resolve_user_tier(u),
            "subscription_status": u.get("subscription_status", "free"),
            "subscription_plan": u.get("subscription_plan"),
        })
    return {"users": results}


@api_router.post("/admin/users/tier")
async def admin_set_tier(body: AdminTierUpdate, user: dict = Depends(require_user)):
    """Reassign a user's plan tier. Logs an audit row so sales-demo tier
    flips don't quietly rewrite production records.
    """
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")
    tier = (body.tier or "").strip().lower()
    if tier not in _VALID_TIERS:
        raise HTTPException(400, f"tier must be one of {sorted(_VALID_TIERS)}")
    email = (body.email or "").strip().lower()
    if not email:
        raise HTTPException(400, "email required")
    target = await db.users.find_one({"email": email})
    if not target:
        raise HTTPException(404, "User not found")
    prev_tier = _resolve_user_tier(target)
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {"subscription_tier": tier, "updated_at": datetime.now(timezone.utc)}},
    )
    # Audit so a sales-demo tier flip isn't invisible to the team.
    try:
        await db.tier_change_log.insert_one({
            "actor_user_id": user["user_id"],
            "actor_email": user["email"],
            "target_user_id": target["user_id"],
            "target_email": email,
            "from_tier": prev_tier,
            "to_tier": tier,
            "at": datetime.now(timezone.utc),
        })
    except Exception:
        pass
    return {"success": True, "email": email, "tier": tier, "previous_tier": prev_tier}


# ============ INVITE CODE ROUTES ============
def _new_invite_code():
    # Human-friendly: CT-XXXX-XXXX, avoids ambiguous chars. Cryptographically-secure.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    part = lambda: "".join(secrets.choice(alphabet) for _ in range(4))
    return f"CT-{part()}-{part()}"


@api_router.post("/admin/invites")
async def create_invite(body: InviteCreate, user: dict = Depends(require_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")
    if body.grant_days < 1 or body.grant_days > 3650:
        raise HTTPException(400, "grant_days must be 1..3650")
    if body.max_uses < 1 or body.max_uses > 10000:
        raise HTTPException(400, "max_uses must be 1..10000")

    code = _new_invite_code()
    # ensure uniqueness (retry a few times)
    for _ in range(5):
        exists = await db.invite_codes.find_one({"code": code}, {"_id": 1})
        if not exists:
            break
        code = _new_invite_code()

    doc = {
        "code": code,
        "created_by": user["user_id"],
        "created_by_email": user["email"],
        "note": (body.note or "").strip()[:200],
        "grant_days": body.grant_days,
        "max_uses": body.max_uses,
        "grant_role": body.grant_role if body.grant_role in ("crew", "field_manager", "ops_manager") else None,
        "use_count": 0,
        "redemptions": [],  # list of {user_id, email, redeemed_at}
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    await db.invite_codes.insert_one(doc)
    return _serialize({k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/admin/invites")
async def list_invites(user: dict = Depends(require_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")
    docs = await db.invite_codes.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_serialize(d) for d in docs]


@api_router.delete("/admin/invites/{code}")
async def revoke_invite(code: str, user: dict = Depends(require_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")
    result = await db.invite_codes.update_one(
        {"code": code}, {"$set": {"is_active": False}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"success": True}


@api_router.post("/invites/redeem")
async def redeem_invite(body: InviteRedeem, user: dict = Depends(require_user)):
    code = (body.code or "").strip().upper()
    if not code:
        raise HTTPException(400, "Missing code")

    invite = await db.invite_codes.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invalid code")
    if not invite.get("is_active", True):
        raise HTTPException(400, "Code has been revoked")

    # Prevent same user redeeming twice (check BEFORE max_uses so message is user-friendly)
    already = any(r.get("user_id") == user["user_id"] for r in invite.get("redemptions", []))
    if already:
        raise HTTPException(400, "You have already used this code")

    if invite.get("use_count", 0) >= invite.get("max_uses", 1):
        raise HTTPException(400, "Code has already been redeemed")

    grant_days = int(invite.get("grant_days", 30))
    grant_role = invite.get("grant_role")
    now = datetime.now(timezone.utc)
    # Extend existing pro expiry if any, else start now
    current = user.get("subscription_expires_at")
    if isinstance(current, str):
        try:
            current = datetime.fromisoformat(current)
        except Exception:
            current = None
    if current and current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    base = current if (current and current > now) else now
    new_expires = base + timedelta(days=grant_days)

    user_update = {
        "subscription_status": "active",
        "subscription_plan": "invite",
        "subscription_expires_at": new_expires,
    }
    if grant_role in ("crew", "field_manager", "ops_manager"):
        user_update["role"] = grant_role

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": user_update},
    )
    await db.invite_codes.update_one(
        {"code": code},
        {
            "$inc": {"use_count": 1},
            "$push": {
                "redemptions": {
                    "user_id": user["user_id"],
                    "email": user["email"],
                    "redeemed_at": now,
                }
            },
        },
    )
    if grant_role == "ops_manager":
        greeting = "welcome aboard, Ops Manager!"
    elif grant_role == "field_manager":
        greeting = "welcome aboard, Field Manager!"
    elif grant_role:
        greeting = "welcome to the crew!"
    else:
        greeting = ""

    return {
        "success": True,
        "grant_days": grant_days,
        "grant_role": grant_role,
        "expires_at": new_expires.isoformat(),
        "message": f"Pro unlocked for {grant_days} days. {greeting}".strip(),
    }


# ============ SKIPPER — CREW GROUP CHAT + SAFETY WATCHDOG ============
CAPE_BRETON_SAFETY_QUIPS = [
    "Whoa — hold up! You're about to twist that string into a pretzel. Back off the brakes before you make a mess of things.",
    "Steady on. You're crowding that limit hard enough to wake the neighbours. Ease off before the iron starts talking back.",
    "Yikes — you're driving that pressure higher than a payday poker pot. Pop the pumps down or you'll have pipe parts flying across the lease.",
    "That's enough — you're deep in the red. Bleed off and reset, and we'll have another go once the numbers cool down.",
    "Deep breath. Shut 'er in for a minute, check the gauges, and reset. Better safe than sorry.",
]

# Per-sheet server-authoritative safety thresholds (Imperial internal units).
# grab() convention: convert user Metric input → Imperial before comparison.
SAFETY_THRESHOLDS = {
    "CT_Milling": [
        {"id": "wob_high",   "check": lambda v: (v.get("rih") is not None and v.get("tagged") is not None and (v["rih"] - v["tagged"]) > 2000), "msg": "WOB exceeds 2000 lb — sinusoidal buckling risk (API RP 5C7 §7.3)."},
        {"id": "wob_neg",    "check": lambda v: (v.get("rih") is not None and v.get("tagged") is not None and (v["rih"] - v["tagged"]) < -500), "msg": "Tagged weight far above RIH weight — recheck inputs, WOB is deeply negative."},
        {"id": "density_hi", "check": lambda v: (v.get("density_ppg") is not None and v["density_ppg"] > 15), "msg": "Fluid density >15 ppg (1798 kg/m³) — verify wellbore pressure balance."},
        {"id": "rate_hi",    "check": lambda v: (v.get("rate_bpm") is not None and v["rate_bpm"] > 6), "msg": "Pump rate >6 BPM (954 L/min) is high for milling — check CT friction & bit life."},
    ],
    "CT_Drilling": [
        {"id": "wob_high",   "check": lambda v: (v.get("rih") is not None and v.get("tagged") is not None and (v["rih"] - v["tagged"]) > 2000), "msg": "WOB exceeds 2000 lb — sinusoidal buckling risk."},
        {"id": "rop_hi",     "check": lambda v: (v.get("rop_ftph") is not None and v["rop_ftph"] > 120), "msg": "ROP >120 ft/hr (36.6 m/hr) — cuttings load can overwhelm annulus."},
    ],
    "Frac_Through_CT": [
        {"id": "surfp_hi",   "check": lambda v: (v.get("surfp") is not None and v["surfp"] > 10000), "msg": "Surface pressure exceeds 10,000 psi (68.9 MPa) CT working limit. IMMEDIATE shut-in (API Spec 5ST)."},
        {"id": "surfp_90",   "check": lambda v: (v.get("surfp") is not None and 9000 <= v["surfp"] <= 10000), "msg": "Surface pressure at >90% CT working limit (9000–10000 psi / 62–69 MPa). Reduce rate or fluid weight."},
        {"id": "density_hi", "check": lambda v: (v.get("density_ppg") is not None and v["density_ppg"] > 12.5), "msg": "Frac fluid density >12.5 ppg (1498 kg/m³) is unusual — verify."},
    ],
    "Annular_Frac": [
        {"id": "surfp_hi",   "check": lambda v: (v.get("surfp") is not None and v["surfp"] > 5000), "msg": "Annular treating pressure >5000 psi (34.5 MPa) — verify wellhead & casing burst rating."},
    ],
    "Sand_Cleanout": [
        {"id": "vann_low",   "check": lambda v: (v.get("vann_ftmin") is not None and v["vann_ftmin"] < 90), "msg": "Annular velocity below 90 ft/min (27.4 m/min) — cuttings will fall back on you."},
        {"id": "rate_hi",    "check": lambda v: (v.get("rate_bpm") is not None and v["rate_bpm"] > 5), "msg": "Cleanout rate >5 BPM (795 L/min) — check CT friction."},
    ],
}


async def _emit_skipper_alert(team_id: str, sheet_key: str, msg: str, source_user_id: str, source_email: str, threshold_id: str, rig_id: Optional[str] = None):
    """Insert a Skipper safety alert into the team channel + audit log. Deduplicates within a 60s window per (team, threshold_id)."""
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    cutoff = now - _td(seconds=60)
    recent = await db.crew_messages.find_one({
        "team_id": team_id,
        "is_skipper": True,
        "threshold_id": threshold_id,
        "created_at": {"$gte": cutoff},
    }, {"_id": 0})
    if recent:
        return None  # deduped
    quip = random.choice(CAPE_BRETON_SAFETY_QUIPS)
    text = f"{quip}\n\nHazard: {msg}\nSheet: {sheet_key}\nTriggered by: {source_email}"
    doc = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "team_id": team_id,
        "rig_id": rig_id,
        "sender_user_id": "skipper",
        "sender_name": "Skipper (Safety Override)",
        "text": text,
        "is_alert": True,
        "is_skipper": True,
        "threshold_id": threshold_id,
        "sheet_key": sheet_key,
        "source_user_id": source_user_id,
        "created_at": now,
    }
    await db.crew_messages.insert_one(doc)
    await db.crew_alerts.insert_one({
        **{k: v for k, v in doc.items() if k != "_id"},
        "audit_id": f"aud_{uuid.uuid4().hex[:12]}",
    })
    return doc


class SafetyEvalRequest(BaseModel):
    sheet_key: str
    values: Dict[str, Optional[float]]  # normalized Imperial values (rih, tagged, surfp, vann_ftmin, etc.)
    rig_id: Optional[str] = None


@api_router.post("/crew/safety-eval")
async def crew_safety_eval(body: SafetyEvalRequest, user: dict = Depends(require_user)):
    """Client sends normalized Imperial values from the current sheet; server checks thresholds and emits Skipper alerts to the team channel."""
    team_id = user.get("team_id")
    if not team_id:
        return {"alerts": [], "note": "solo mode — no team channel"}
    rules = SAFETY_THRESHOLDS.get(body.sheet_key, [])
    fired = []
    for rule in rules:
        try:
            if rule["check"](body.values):
                alert = await _emit_skipper_alert(
                    team_id=team_id,
                    sheet_key=body.sheet_key,
                    msg=rule["msg"],
                    source_user_id=user["user_id"],
                    source_email=user["email"],
                    threshold_id=rule["id"],
                    rig_id=body.rig_id,
                )
                if alert:
                    fired.append({"threshold_id": rule["id"], "msg": rule["msg"]})
        except Exception:
            continue
    return {"alerts": fired}


class CrewMessage(BaseModel):
    text: str
    rig_id: Optional[str] = None  # RIG1..RIG25 | YARD ; None = legacy / all-rigs


@api_router.post("/crew/chat")
async def crew_send(body: CrewMessage, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team before using crew chat.")
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Message is empty.")
    if len(text) > 2000:
        raise HTTPException(400, "Message too long (2000 char max).")

    now = datetime.now(timezone.utc)
    user_msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "team_id": team_id,
        "rig_id": body.rig_id,
        "sender_user_id": user["user_id"],
        "sender_name": user.get("name") or user["email"].split("@")[0],
        "sender_email": user["email"],
        "text": text,
        "is_alert": False,
        "is_skipper": False,
        "created_at": now,
    }
    await db.crew_messages.insert_one(user_msg)

    # "hey skipper" or "@skipper" trigger — call Gemini with the assistant prompt
    lower = text.lower()
    if _user_has_ai_access(user) and (EMERGENT_LLM_KEY or os.environ.get("GEMINI_API_KEY")) and ("hey skipper" in lower or "@skipper" in lower or lower.startswith("skipper")):
        query = text
        for marker in ("hey skipper", "@skipper", "skipper"):
            if lower.startswith(marker) or marker in lower:
                query = text.replace(marker, "").replace(marker.title(), "").strip(" ,:.")
                if query:
                    break
        try:
            session_id = f"skipper_team_{team_id}"
            # AI Privacy Mode — scrub BEFORE anything hits the model
            safe_query = await _maybe_scrub_for_team(team_id, query or text)
            response = await _llm_reply(session_id, SYSTEM_PROMPTS["assistant"], safe_query)
            await db.crew_messages.insert_one({
                "message_id": f"msg_{uuid.uuid4().hex[:12]}",
                "team_id": team_id,
                "rig_id": body.rig_id,
                "sender_user_id": "skipper",
                "sender_name": "Skipper (AI Advisor)",
                "text": response,
                "is_alert": False,
                "is_skipper": True,
                "created_at": datetime.now(timezone.utc),
            })
        except Exception:
            logger.exception("Skipper AI reply failed")

    return {"success": True, "message_id": user_msg["message_id"]}


@api_router.get("/crew/chat")
async def crew_list(since: Optional[str] = None, rig_id: Optional[str] = None, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"messages": [], "team_id": None}
    query: Dict[str, Any] = {"team_id": team_id}
    if rig_id:
        # Show messages tagged for this rig OR legacy messages with no rig_id.
        query["$or"] = [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}]
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)
            query["created_at"] = {"$gt": since_dt}
        except ValueError:
            pass
    docs = await db.crew_messages.find(query, {"_id": 0}).sort("created_at", 1).to_list(300)
    return {"messages": [_serialize(d) for d in docs], "team_id": team_id, "rig_id": rig_id}


# ============ TEAM HUB — INVENTORY / CONSUMABLES / PARTS ORDERS / TO-DOS ============
# All four lists live in a single collection (team_items) with a `kind` discriminator so we
# only maintain one CRUD path. Every item is scoped to team_id and audit-stamped.
ITEM_KINDS = {"inventory", "consumables", "parts_order", "todo"}


# ============ NOTIFICATIONS DIGEST (background badge + toast feed) ============
@api_router.get("/notifications/digest")
async def notifications_digest(
    rig_id: str,
    since: Optional[str] = None,
    limit: int = 5,
    user: dict = Depends(require_user),
):
    """Return a compact digest of what's new on the user's active rig since `since`.

    Caller passes an ISO timestamp (usually the time they were last on the Team Hub).
    If `since` is missing or invalid we fall back to the last 10 minutes so a fresh
    client doesn't see every historical row as 'unread'.
    """
    team_id = user.get("team_id")
    empty = {
        "chat": {"count": 0, "has_alert": False, "latest": []},
        "tasks": {"count": 0, "latest": []},
        "treatment": {"count": 0, "latest": [], "treatment_id": None, "treatment_name": None},
        "server_time": datetime.now(timezone.utc).isoformat(),
    }
    if not team_id:
        return empty
    limit = max(1, min(int(limit or 5), 20))

    now = datetime.now(timezone.utc)
    since_dt: Optional[datetime] = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)
        except ValueError:
            since_dt = None
    if since_dt is None:
        since_dt = now - timedelta(minutes=10)

    author_filter = {"$ne": user.get("email")}  # don't notify a user about their own actions

    # ── Chat
    chat_q: Dict[str, Any] = {
        "team_id": team_id,
        "created_at": {"$gt": since_dt},
        "sender_email": author_filter,
        "$or": [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}],
    }
    chat_docs = await db.crew_messages.find(chat_q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    chat_count = await db.crew_messages.count_documents(chat_q)
    has_alert = any(d.get("is_alert") for d in chat_docs)

    # ── Tasks (any kind) — all four lists appear here
    tasks_q: Dict[str, Any] = {
        "team_id": team_id,
        "created_at": {"$gt": since_dt},
        "created_by": author_filter,
        "$or": [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}],
    }
    task_docs = await db.team_items.find(tasks_q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    task_count = await db.team_items.count_documents(tasks_q)

    # ── Treatment entries on the active treatment of this rig
    trt = await db.treatments.find_one(
        {"team_id": team_id, "rig_id": rig_id, "status": "active"},
        {"_id": 0}, sort=[("created_at", -1)],
    )
    trt_entries: List[dict] = []
    trt_count = 0
    if trt:
        trt_q = {
            "team_id": team_id,
            "treatment_id": trt["treatment_id"],
            "created_at": {"$gt": since_dt},
            "author": author_filter,
        }
        trt_entries = await db.treatment_entries.find(trt_q, {"_id": 0}).sort("created_at", -1).to_list(limit)
        trt_count = await db.treatment_entries.count_documents(trt_q)

    return {
        "chat": {
            "count": chat_count,
            "has_alert": has_alert,
            "latest": [_serialize(d) for d in chat_docs],
        },
        "tasks": {
            "count": task_count,
            "latest": [_serialize(d) for d in task_docs],
        },
        "treatment": {
            "count": trt_count,
            "latest": [_serialize(d) for d in trt_entries],
            "treatment_id": trt["treatment_id"] if trt else None,
            "treatment_name": trt["name"] if trt else None,
        },
        "server_time": now.isoformat(),
    }


class TeamItemCreate(BaseModel):
    kind: str
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    location: Optional[str] = None  # place designation (e.g., "Blue Shed / Rack 3")
    note: Optional[str] = None
    status: Optional[str] = None   # inventory: OK|LOW|OOS ; parts: REQUESTED|ORDERED|RECEIVED ; todo: OPEN|DONE
    priority: Optional[str] = None # todo: LOW|MED|HIGH
    due_date: Optional[str] = None # ISO
    rig_id: Optional[str] = None   # RIG1 | RIG2 | YARD (None = visible on every rig, legacy items)


class TeamItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    location: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None


@api_router.get("/team/items/{kind}")
async def list_team_items(
    kind: str,
    rig_id: Optional[str] = None,
    limit: int = Query(500, ge=1, le=500),
    before: Optional[str] = None,
    user: dict = Depends(require_user),
):
    if kind not in ITEM_KINDS:
        raise HTTPException(400, f"Invalid kind. Must be one of {sorted(ITEM_KINDS)}")
    team_id = user.get("team_id")
    if not team_id:
        return {"items": [], "team_id": None}
    query: Dict[str, Any] = {"team_id": team_id, "kind": kind}
    if rig_id:
        # Show items tagged for this rig OR untagged legacy items (rig_id missing / None).
        query["$or"] = [{"rig_id": rig_id}, {"rig_id": {"$in": [None]}}, {"rig_id": {"$exists": False}}]
    if before:
        try:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid 'before' cursor; expected ISO-8601 timestamp.")
        if before_dt.tzinfo is None:
            before_dt = before_dt.replace(tzinfo=timezone.utc)
        query["created_at"] = {"$lt": before_dt}
    # Fetch one extra row to know whether another page exists.
    docs = await db.team_items.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit + 1)
    has_more = len(docs) > limit
    docs = docs[:limit]
    next_before = None
    if has_more and docs and isinstance(docs[-1].get("created_at"), datetime):
        next_before = docs[-1]["created_at"].isoformat()
    return {"items": [_serialize(d) for d in docs], "team_id": team_id, "rig_id": rig_id, "next_before": next_before}


@api_router.post("/team/items")
async def create_team_item(body: TeamItemCreate, user: dict = Depends(require_user)):
    if body.kind not in ITEM_KINDS:
        raise HTTPException(400, f"Invalid kind. Must be one of {sorted(ITEM_KINDS)}")
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team before adding list items.")
    if not body.name.strip():
        raise HTTPException(400, "Name is required.")
    now = datetime.now(timezone.utc)
    doc = {
        "item_id": f"itm_{uuid.uuid4().hex[:12]}",
        "team_id": team_id,
        "kind": body.kind,
        "name": body.name.strip(),
        "quantity": body.quantity,
        "unit": body.unit,
        "location": body.location,
        "note": body.note,
        "status": body.status or ("OPEN" if body.kind == "todo" else "OK"),
        "priority": body.priority or ("MED" if body.kind == "todo" else None),
        "due_date": body.due_date,
        "rig_id": body.rig_id,
        "created_by": user["email"],
        "created_at": now,
        "updated_at": now,
    }
    await db.team_items.insert_one(doc)
    doc.pop("_id", None)
    return _serialize(doc)


@api_router.patch("/team/items/{item_id}")
async def update_team_item(item_id: str, body: TeamItemUpdate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update.")
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await db.team_items.update_one(
        {"item_id": item_id, "team_id": team_id},
        {"$set": updates},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Item not found in your team.")
    doc = await db.team_items.find_one({"item_id": item_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/team/items/{item_id}")
async def delete_team_item(item_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    result = await db.team_items.delete_one({"item_id": item_id, "team_id": team_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Item not found in your team.")
    return {"success": True, "item_id": item_id}


# ============ CHECKLIST EVENTS + HANDOVER SUMMARY ============
CHECKLIST_TIERS = {"safety", "ops", "pm"}


class ChecklistEventCreate(BaseModel):
    rig_id: str
    tier: str          # safety | ops | pm
    item_id: str
    item_label: str
    cadence: Optional[str] = None
    action: str        # "checked" | "unchecked"


@api_router.post("/crew/checklist-events")
async def create_checklist_event(body: ChecklistEventCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        # Solo users: accept silently so the UI still works, but don't persist.
        return {"success": True, "persisted": False}
    if body.tier not in CHECKLIST_TIERS:
        raise HTTPException(400, f"Invalid tier. Must be one of {sorted(CHECKLIST_TIERS)}")
    if body.action not in ("checked", "unchecked"):
        raise HTTPException(400, "action must be checked|unchecked")
    doc = {
        "event_id": f"cke_{uuid.uuid4().hex[:12]}",
        "team_id": team_id,
        "rig_id": body.rig_id,
        "tier": body.tier,
        "item_id": body.item_id,
        "item_label": body.item_label.strip()[:300],
        "cadence": body.cadence,
        "action": body.action,
        "user_id": user["user_id"],
        "user_name": user.get("name") or user["email"].split("@")[0],
        "user_email": user["email"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.checklist_events.insert_one(doc)
    doc.pop("_id", None)
    return {"success": True, "persisted": True, "event": _serialize(doc)}


@api_router.get("/crew/checklist-events")
async def list_checklist_events(rig_id: Optional[str] = None, hours: int = 24, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"events": [], "team_id": None}
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 24 * 30)))
    query: Dict[str, Any] = {"team_id": team_id, "created_at": {"$gte": cutoff}}
    if rig_id:
        query["rig_id"] = rig_id
    docs = await db.checklist_events.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"events": [_serialize(d) for d in docs], "team_id": team_id, "rig_id": rig_id}


@api_router.get("/crew/activity-summary")
async def crew_activity_summary(user: dict = Depends(require_user)):
    """Latest chat & checklist activity timestamp per rig — powers the RigSelector unread dots."""
    team_id = user.get("team_id")
    if not team_id:
        return {"rigs": {}, "team_id": None}

    rigs: Dict[str, Dict[str, str]] = {}

    # Latest chat per rig (grouped)
    async for row in db.crew_messages.aggregate([
        {"$match": {"team_id": team_id, "rig_id": {"$ne": None}}},
        {"$group": {"_id": "$rig_id", "last_at": {"$max": "$created_at"}}},
    ]):
        rid = row["_id"]
        if not rid:
            continue
        rigs.setdefault(rid, {})["last_chat_at"] = row["last_at"].isoformat() if isinstance(row["last_at"], datetime) else row["last_at"]

    # Latest checklist per rig
    async for row in db.checklist_events.aggregate([
        {"$match": {"team_id": team_id}},
        {"$group": {"_id": "$rig_id", "last_at": {"$max": "$created_at"}}},
    ]):
        rid = row["_id"]
        if not rid:
            continue
        rigs.setdefault(rid, {})["last_checklist_at"] = row["last_at"].isoformat() if isinstance(row["last_at"], datetime) else row["last_at"]

    return {"rigs": rigs, "team_id": team_id}


@api_router.get("/crew/handover-summary")
async def crew_handover_summary(rig_id: str, hours: int = 12, user: dict = Depends(require_user)):
    """Aggregate everything relevant for a shift-change handover on the given rig."""
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    hours = max(1, min(hours, 24 * 7))
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)

    # Completed checklist tasks (action = checked) in window, this rig
    completed_events = await db.checklist_events.find(
        {"team_id": team_id, "rig_id": rig_id, "action": "checked", "created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    # Recent alerts removed from handover: users found the calc-triggered watchdog alerts too
    # noisy for a shift report; alerts still live in the Skipper chat + Manager Dashboard.
    alerts: List[Any] = []

    # Inventory / consumables flags — LOW or OOS on this rig (regardless of window)
    inv_flags = await db.team_items.find(
        {"team_id": team_id, "kind": {"$in": ["inventory", "consumables"]}, "status": {"$in": ["LOW", "OOS"]},
         "$or": [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}]},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(100)

    # Open parts orders on this rig
    parts_open = await db.team_items.find(
        {"team_id": team_id, "kind": "parts_order", "status": {"$in": ["REQUESTED", "ORDERED"]},
         "$or": [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}]},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(50)

    # Open to-dos on this rig
    todos_open = await db.team_items.find(
        {"team_id": team_id, "kind": "todo", "status": {"$in": ["OPEN", "IN_PROGRESS"]},
         "$or": [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}]},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(100)

    # Note: crew chat is intentionally OMITTED from handover summaries — chat stays
    # private to the active crew. Supervisors share status via the structured sections
    # (completed tasks, inventory flags, open to-dos) instead.

    return {
        "rig_id": rig_id,
        "hours": hours,
        "generated_at": now.isoformat(),
        "generated_by": user.get("name") or user["email"],
        "completed_tasks": [_serialize(d) for d in completed_events],
        "alerts": [_serialize(d) for d in alerts],
        "inventory_flags": [_serialize(d) for d in inv_flags],
        "parts_open": [_serialize(d) for d in parts_open],
        "todos_open": [_serialize(d) for d in todos_open],
        "chat_notes": [],  # deprecated — kept for backward compat with older clients
    }


# ============ HANDOVER EMAIL (Resend) ============
import html as _html

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")


def _normalize_phone(raw: str) -> Optional[str]:
    """Normalize a phone number to strict E.164 (+15551234567)."""
    s = (raw or "").strip()
    if not s:
        return None
    cleaned = re.sub(r"[^\d+]", "", s)
    if cleaned.startswith("00"):
        cleaned = f"+{cleaned[2:]}"
    if not cleaned.startswith("+"):
        if len(cleaned) == 11 and cleaned.startswith("1"):
            cleaned = f"+{cleaned}"
        elif len(cleaned) == 10:
            cleaned = f"+1{cleaned}"
        else:
            return None
    if not _E164_RE.match(cleaned):
        return None
    return cleaned


def _sms_configured() -> bool:
    return (
        SMS_PROVIDER == "twilio"
        and bool(SMS_FROM_NUMBER)
        and bool(TWILIO_ACCOUNT_SID)
        and bool(TWILIO_AUTH_TOKEN)
    )


async def _send_sms_twilio(to_number: str, body_text: str) -> str:
    """Dispatch one SMS through Twilio REST and return provider message SID."""
    def _do_send() -> str:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
        resp = requests.post(
            url,
            auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
            data={"From": SMS_FROM_NUMBER, "To": to_number, "Body": body_text},
            timeout=12,
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message") or resp.text
            except Exception:
                detail = resp.text
            raise RuntimeError(f"Twilio send failed ({resp.status_code}): {detail[:220]}")
        payload = resp.json()
        sid = payload.get("sid")
        if not sid:
            raise RuntimeError("Twilio send failed: missing sid in response")
        return sid

    return await asyncio.to_thread(_do_send)


class HandoverEmailRequest(BaseModel):
    rig_id: str
    hours: int = 12
    recipients: List[str]              # 1..5 email addresses
    body_text: str                     # plain-text handover (built by frontend)
    subject: Optional[str] = None      # override subject
    note: Optional[str] = None         # optional cover note from the sender
    hitl_approval_id: Optional[str] = None


def _html_email_from_text(sender_name: str, rig_label: str, body_text: str, note: Optional[str]) -> str:
    """Convert the plain-text handover summary into an inline-styled, email-safe HTML body."""
    safe_body = _html.escape(body_text).replace("\n", "<br/>")
    cover = ""
    if note:
        cover = f'<p style="margin:0 0 16px;color:#262626;line-height:1.4;">{_html.escape(note)}</p>'
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#F3F3F3;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F3F3F3;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <tr><td style="background:#0D6535;color:#FFFFFF;padding:14px 20px;">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;">Handover Report</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;">{_html.escape(rig_label)}</div>
        <div style="font-size:11px;opacity:.85;margin-top:2px;">Sent by {_html.escape(sender_name)}</div>
      </td></tr>
      <tr><td style="padding:20px;">
        {cover}
        <pre style="font-family:ui-monospace,SF Mono,Menlo,Consolas,monospace;white-space:pre-wrap;font-size:12.5px;line-height:1.5;color:#262626;margin:0;background:#F7F7F7;border:1px solid #E5E7EB;border-radius:6px;padding:12px;">{safe_body}</pre>
      </td></tr>
      <tr><td style="padding:12px 20px;background:#F9FAFB;color:#8A8A8A;font-size:10.5px;line-height:1.5;border-top:1px solid #E5E7EB;">
        Generated by <strong style="color:#0D6535;">CT Field Workbook</strong>. This email is a snapshot — not a replacement for real-time crew-chat updates on the rig.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


@api_router.post("/crew/handover-email")
async def send_handover_email(body: HandoverEmailRequest, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    # Validate recipients FIRST so bad input never surfaces a config error.
    cleaned: List[str] = []
    seen = set()
    for r in body.recipients or []:
        e = (r or "").strip().lower()
        if not e or not _EMAIL_RE.match(e):
            continue
        if e in seen:
            continue
        seen.add(e)
        cleaned.append(e)
    if not cleaned:
        raise HTTPException(400, "Give me at least one valid email address.")
    if len(cleaned) > 5:
        raise HTTPException(400, "Max 5 recipients per send.")
    if not (body.body_text or "").strip():
        raise HTTPException(400, "Handover body is empty.")
    fingerprint = _hitl_payload_fingerprint({
        "rig_id": body.rig_id,
        "hours": body.hours,
        "recipients": sorted(cleaned),
        "subject": (body.subject or "").strip()[:150],
        "body_len": len((body.body_text or "").strip()),
        "note_len": len((body.note or "").strip()),
    })
    await _consume_hitl_approval(
        action="handover_email_send",
        approval_id=body.hitl_approval_id,
        user=user,
        endpoint="/api/crew/handover-email",
        payload_fingerprint=fingerprint,
    )
    # Config check — only after we know the request is well-formed.
    if not RESEND_API_KEY or _resend is None:
        raise HTTPException(503, "Email sending isn't configured yet. Ask an admin to add RESEND_API_KEY to the server environment.")

    rig_label = (body.rig_id or "").replace("RIG", "Rig ").replace("YARD", "Yard")
    sender_name = user.get("name") or user["email"].split("@")[0]
    subject = (body.subject or f"Handover — {rig_label} · last {body.hours}h").strip()[:150]
    html_body = _html_email_from_text(sender_name, rig_label, body.body_text, body.note)
    text_body = (body.note + "\n\n" if body.note else "") + body.body_text

    params = {
        "from": f"{sender_name} via CT Pocket <{RESEND_FROM_EMAIL}>",
        "to": cleaned,
        "subject": subject,
        "html": html_body,
        "text": text_body,
        "reply_to": [user["email"]] if user.get("email") else None,
    }
    # Drop None keys (Resend rejects them)
    params = {k: v for k, v in params.items() if v is not None}

    try:
        resp = await asyncio.to_thread(_resend.Emails.send, params)
    except Exception as e:
        msg = str(e)
        # Resend commonly rejects unverified sender domains with a 403
        if "domain" in msg.lower() or "not verified" in msg.lower():
            raise HTTPException(502, "Sender domain is not verified on Resend. Verify your domain or test mode sends to the account owner's address only.")
        raise HTTPException(502, f"Email provider error: {msg[:200]}")

    email_id = resp.get("id") if isinstance(resp, dict) else None

    # Audit log — survives even if Resend drops the webhook
    try:
        await db.handover_emails.insert_one({
            "team_id": team_id,
            "rig_id": body.rig_id,
            "sender_email": user["email"],
            "sender_name": sender_name,
            "recipients": cleaned,
            "subject": subject,
            "resend_email_id": email_id,
            "body_text": body.body_text[:20000],
            "note": body.note,
            "sent_at": datetime.now(timezone.utc),
        })
    except Exception:
        pass

    return {"success": True, "email_id": email_id, "recipients": cleaned}


# ============ DOSSIER EMAIL (Resend) ============
class DossierEmailRequest(BaseModel):
    recipients: List[str]              # 1..5 office emails
    html: str                          # pre-rendered dossier HTML (unit-aware)
    subject: Optional[str] = None
    sample_count: Optional[int] = 0
    vm_alert_count: Optional[int] = 0
    unit_system: Optional[str] = "imperial"  # 'imperial' | 'metric' — for subject tag
    hitl_approval_id: Optional[str] = None


@api_router.post("/dossier/email")
async def email_dossier(body: DossierEmailRequest, user: dict = Depends(require_user)):
    """Fire the pre-rendered Engineering Audit Dossier HTML straight to the
    office via Resend. Keeps the chain-of-custody intact: the dossier the
    crew saw on-screen is byte-for-byte the one management receives.
    """
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    # Validate recipients first so bad input never surfaces a config error.
    cleaned: List[str] = []
    seen = set()
    for r in body.recipients or []:
        e = (r or "").strip().lower()
        if not e or not _EMAIL_RE.match(e):
            continue
        if e in seen:
            continue
        seen.add(e)
        cleaned.append(e)
    if not cleaned:
        raise HTTPException(400, "Give me at least one valid email address.")
    if len(cleaned) > 5:
        raise HTTPException(400, "Max 5 recipients per send.")
    html_payload = (body.html or "").strip()
    if not html_payload or "<html" not in html_payload.lower():
        raise HTTPException(400, "Dossier HTML is empty or malformed.")
    if len(html_payload) > 500_000:
        raise HTTPException(413, "Dossier HTML too large (>500 KB). Try narrowing the window.")
    fingerprint = _hitl_payload_fingerprint({
        "recipients": sorted(cleaned),
        "subject": (body.subject or "").strip()[:160],
        "sample_count": int(body.sample_count or 0),
        "vm_alert_count": int(body.vm_alert_count or 0),
        "unit_system": body.unit_system or "imperial",
        "html_bytes": len(html_payload),
    })
    await _consume_hitl_approval(
        action="dossier_email_send",
        approval_id=body.hitl_approval_id,
        user=user,
        endpoint="/api/dossier/email",
        payload_fingerprint=fingerprint,
    )

    # Config check — only after we know the request is well-formed.
    if not RESEND_API_KEY or _resend is None:
        # Match the handover endpoint's behaviour so operators get a clear
        # message rather than a silent 200 that didn't actually send.
        raise HTTPException(503, "Email sending isn't configured yet. Ask an admin to add RESEND_API_KEY to the server environment.")

    sender_name = user.get("name") or user["email"].split("@")[0]
    unit_tag = "SI" if body.unit_system == "metric" else "Imperial"
    subject = (body.subject or
               f"Engineering Audit Dossier · {unit_tag} · {body.sample_count or 0} samples · {body.vm_alert_count or 0} VM alerts"
               ).strip()[:160]

    params = {
        "from": f"{sender_name} via CoilAegis <{RESEND_FROM_EMAIL}>",
        "to": cleaned,
        "subject": subject,
        "html": html_payload,
        "text": f"Engineering Audit Dossier generated by {sender_name}. Open the HTML attachment or render in your email client to view the full dossier.",
        "reply_to": [user["email"]] if user.get("email") else None,
    }
    params = {k: v for k, v in params.items() if v is not None}

    try:
        resp = await asyncio.to_thread(_resend.Emails.send, params)
    except Exception as e:
        msg = str(e)
        if "domain" in msg.lower() or "not verified" in msg.lower():
            raise HTTPException(502, "Sender domain is not verified on Resend. Verify your domain or test-mode sends to the account owner's address only.")
        raise HTTPException(502, f"Email provider error: {msg[:200]}")

    email_id = resp.get("id") if isinstance(resp, dict) else None

    # Audit log — survives even if Resend drops the webhook
    try:
        await db.dossier_emails.insert_one({
            "team_id": team_id,
            "sender_email": user["email"],
            "sender_name": sender_name,
            "recipients": cleaned,
            "subject": subject,
            "unit_system": body.unit_system or "imperial",
            "sample_count": body.sample_count or 0,
            "vm_alert_count": body.vm_alert_count or 0,
            "resend_email_id": email_id,
            "html_bytes": len(html_payload),
            "sent_at": datetime.now(timezone.utc),
        })
    except Exception:
        pass

    return {"success": True, "email_id": email_id, "recipients": cleaned}


# ============ Crew Email Contacts (team address book) ============
class CrewContactCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None         # E.164 (+15551234567)
    role: Optional[str] = None            # Supervisor / Tool Push / Day Op / Night Op / Office / Other
    is_default_recipient: bool = True     # auto-select on shift-end send


class CrewContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    is_default_recipient: Optional[bool] = None


@api_router.post("/crew/contacts")
async def create_crew_contact(body: CrewContactCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    name = body.name.strip()
    email = (body.email or "").strip().lower()
    phone = _normalize_phone(body.phone or "")
    if not name:
        raise HTTPException(400, "Name required.")
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Valid email required.")
    if body.phone is not None and body.phone.strip() and not phone:
        raise HTTPException(400, "Valid phone required (E.164, e.g. +14035551234).")
    # Prevent duplicates per team
    dup = await db.crew_contacts.find_one({
        "team_id": team_id,
        "is_deleted": {"$ne": True},
        "$or": ([{"email": email}] + ([{"phone": phone}] if phone else [])),
    })
    if dup:
        if phone and dup.get("phone") == phone:
            raise HTTPException(409, f"'{phone}' is already saved for this crew.")
        raise HTTPException(409, f"'{email}' is already saved for this crew.")
    cid = f"cc_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    doc = {
        "contact_id": cid,
        "team_id": team_id,
        "name": name,
        "email": email,
        "phone": phone,
        "role": (body.role or "").strip() or None,
        "is_default_recipient": bool(body.is_default_recipient),
        "added_by_user_id": user["user_id"],
        "added_by_name": user.get("name"),
        "is_deleted": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.crew_contacts.insert_one(doc)
    doc.pop("_id", None)
    return _serialize(doc)


@api_router.get("/crew/contacts")
async def list_crew_contacts(user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"contacts": [], "team_id": None}
    docs = await db.crew_contacts.find(
        {"team_id": team_id, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).sort("name", 1).to_list(200)
    return {"contacts": [_serialize(d) for d in docs], "team_id": team_id}


@api_router.patch("/crew/contacts/{contact_id}")
async def update_crew_contact(contact_id: str, body: CrewContactUpdate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    doc = await db.crew_contacts.find_one(
        {"contact_id": contact_id, "team_id": team_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found.")
    update: Dict[str, Any] = {}
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(400, "Name cannot be empty.")
        update["name"] = n
    if body.email is not None:
        e = body.email.strip().lower()
        if not _EMAIL_RE.match(e):
            raise HTTPException(400, "Valid email required.")
        update["email"] = e
    if body.phone is not None:
        p = _normalize_phone(body.phone)
        if body.phone.strip() and not p:
            raise HTTPException(400, "Valid phone required (E.164, e.g. +14035551234).")
        update["phone"] = p
    if body.role is not None:
        update["role"] = body.role.strip() or None
    if body.is_default_recipient is not None:
        update["is_default_recipient"] = bool(body.is_default_recipient)
    if "email" in update:
        dup_q: Dict[str, Any] = {
            "team_id": team_id,
            "contact_id": {"$ne": contact_id},
            "is_deleted": {"$ne": True},
            "email": update["email"],
        }
        if await db.crew_contacts.find_one(dup_q, {"_id": 0}):
            raise HTTPException(409, f"'{update['email']}' is already saved for this crew.")
    if "phone" in update and update.get("phone"):
        dup_q = {
            "team_id": team_id,
            "contact_id": {"$ne": contact_id},
            "is_deleted": {"$ne": True},
            "phone": update["phone"],
        }
        if await db.crew_contacts.find_one(dup_q, {"_id": 0}):
            raise HTTPException(409, f"'{update['phone']}' is already saved for this crew.")
    update["updated_at"] = datetime.now(timezone.utc)
    await db.crew_contacts.update_one({"contact_id": contact_id}, {"$set": update})
    doc = await db.crew_contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/crew/contacts/{contact_id}")
async def delete_crew_contact(contact_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    doc = await db.crew_contacts.find_one(
        {"contact_id": contact_id, "team_id": team_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found.")
    await db.crew_contacts.update_one(
        {"contact_id": contact_id},
        {"$set": {"is_deleted": True, "deleted_at": datetime.now(timezone.utc), "deleted_by": user["email"]}})
    return {"success": True}


# ============ One-click Shift-End Handover ============
class ShiftEndHandoverRequest(BaseModel):
    rig_id: str
    hours: int = 12                     # window of activity to summarise
    extra_recipients: Optional[List[str]] = None     # ad-hoc one-off recipients
    include_contact_ids: Optional[List[str]] = None  # override default-recipient set
    note: Optional[str] = None                        # supervisor's cover note
    subject: Optional[str] = None
    hitl_approval_id: Optional[str] = None


class ShiftEndSmsRequest(BaseModel):
    rig_id: str
    hours: int = 12
    extra_numbers: Optional[List[str]] = None
    include_contact_ids: Optional[List[str]] = None
    note: Optional[str] = None
    hitl_approval_id: Optional[str] = None


async def _build_shift_end_body(team_id: str, rig_id: str, hours: int) -> str:
    """Pulls last `hours` of crew-chat and treatment entries for this rig and builds a tidy text block."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 72)))
    rig_label = (rig_id or "").replace("RIG", "Rig ").replace("YARD", "Yard")
    lines: List[str] = [f"SHIFT-END HANDOVER · {rig_label}", f"Window: last {hours} hours (since {cutoff.strftime('%Y-%m-%d %H:%M UTC')})", ""]

    # Treatment entries
    try:
        tx_entries = await db.treatment_entries.find(
            {"team_id": team_id, "rig_id": rig_id, "created_at": {"$gte": cutoff}},
            {"_id": 0}
        ).sort("created_at", 1).to_list(300)
    except Exception:
        tx_entries = []
    lines.append(f"TREATMENT / OPERATIONS LOG ({len(tx_entries)} entries)")
    if not tx_entries:
        lines.append("  — No entries logged in window.")
    else:
        for e in tx_entries:
            ts = e.get("created_at")
            tstr = ts.strftime("%H:%M") if hasattr(ts, "strftime") else str(ts)[:16]
            author = e.get("created_by_name") or e.get("created_by") or "crew"
            txt = (e.get("text") or "").strip().replace("\n", " ")
            lines.append(f"  {tstr}  {author}: {txt}")

    # Crew chat is intentionally OMITTED — chat stays private to the active crew.
    # Supervisors share status via Treatment log + open to-dos below.

    # To-dos still open
    try:
        todos = await db.team_items.find(
            {"team_id": team_id, "rig_id": rig_id, "kind": "todo", "status": {"$ne": "done"}},
            {"_id": 0}
        ).sort("created_at", 1).to_list(100)
    except Exception:
        todos = []
    lines.append("")
    lines.append(f"OPEN TO-DOS ({len(todos)})")
    if not todos:
        lines.append("  — All clear.")
    else:
        for t in todos:
            lines.append(f"  • {t.get('name') or '(no title)'}  [{t.get('status','open')}]")

    lines.append("")
    lines.append("— End of handover —")
    return "\n".join(lines)


@api_router.post("/crew/shift-end-handover")
async def send_shift_end_handover(body: ShiftEndHandoverRequest, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    if not body.rig_id:
        raise HTTPException(400, "rig_id required.")

    # Resolve recipient list:
    # - include_contact_ids wins if provided; else all contacts marked default
    # - plus any ad-hoc extra_recipients
    contact_query: Dict[str, Any] = {"team_id": team_id, "is_deleted": {"$ne": True}}
    if body.include_contact_ids is not None:
        contact_query["contact_id"] = {"$in": body.include_contact_ids}
    else:
        contact_query["is_default_recipient"] = True
    contacts = await db.crew_contacts.find(contact_query, {"_id": 0}).to_list(200)

    recipients: List[str] = []
    seen = set()
    for c in contacts:
        e = (c.get("email") or "").strip().lower()
        if e and e not in seen:
            seen.add(e); recipients.append(e)
    for e in body.extra_recipients or []:
        e2 = (e or "").strip().lower()
        if _EMAIL_RE.match(e2) and e2 not in seen:
            seen.add(e2); recipients.append(e2)
    if not recipients:
        raise HTTPException(400, "No recipients — add crew contacts (default) or paste at least one address.")
    if len(recipients) > 10:
        raise HTTPException(400, "Max 10 recipients per shift-end send.")
    fingerprint = _hitl_payload_fingerprint({
        "rig_id": body.rig_id,
        "hours": body.hours,
        "recipients": sorted(recipients),
        "note_len": len((body.note or "").strip()),
        "subject": (body.subject or "").strip()[:150],
    })
    await _consume_hitl_approval(
        action="shift_end_email_send",
        approval_id=body.hitl_approval_id,
        user=user,
        endpoint="/api/crew/shift-end-handover",
        payload_fingerprint=fingerprint,
    )

    body_text = await _build_shift_end_body(team_id, body.rig_id, body.hours or 12)

    if not RESEND_API_KEY or _resend is None:
        raise HTTPException(503, "Email sending isn't configured yet. Ask an admin to add RESEND_API_KEY to the server environment.")

    rig_label = (body.rig_id or "").replace("RIG", "Rig ").replace("YARD", "Yard")
    sender_name = user.get("name") or user["email"].split("@")[0]
    subject = (body.subject or f"Shift-end handover — {rig_label} · last {body.hours}h").strip()[:150]
    html_body = _html_email_from_text(sender_name, rig_label, body_text, body.note)
    text_body = (body.note + "\n\n" if body.note else "") + body_text

    params = {
        "from": f"{sender_name} via CT Pocket <{RESEND_FROM_EMAIL}>",
        "to": recipients,
        "subject": subject,
        "html": html_body,
        "text": text_body,
        "reply_to": [user["email"]] if user.get("email") else None,
    }
    params = {k: v for k, v in params.items() if v is not None}

    try:
        resp = await asyncio.to_thread(_resend.Emails.send, params)
    except Exception as e:
        msg = str(e)
        if "domain" in msg.lower() or "not verified" in msg.lower():
            raise HTTPException(502, "Sender domain is not verified on Resend. Verify your domain or use the test sender (onboarding@resend.dev).")
        raise HTTPException(502, f"Email provider error: {msg[:200]}")

    email_id = resp.get("id") if isinstance(resp, dict) else None
    try:
        await db.handover_emails.insert_one({
            "team_id": team_id,
            "rig_id": body.rig_id,
            "sender_email": user["email"],
            "sender_name": sender_name,
            "recipients": recipients,
            "subject": subject,
            "resend_email_id": email_id,
            "body_text": body_text[:20000],
            "note": body.note,
            "shift_end_auto": True,
            "sent_at": datetime.now(timezone.utc),
        })
    except Exception:
        pass

    return {"success": True, "email_id": email_id, "recipients": recipients, "body_preview": body_text[:1500]}


# ============ Shift-end handover PREVIEW (no email, no key required) ============
@api_router.post("/crew/shift-end-preview")
async def preview_shift_end(body: ShiftEndHandoverRequest, user: dict = Depends(require_user)):
    """Builds the summary body + resolves intended recipients WITHOUT sending.
    Lets the UI show the supervisor exactly what will go out before they send."""
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    if not body.rig_id:
        raise HTTPException(400, "rig_id required.")

    contact_query: Dict[str, Any] = {"team_id": team_id, "is_deleted": {"$ne": True}}
    if body.include_contact_ids is not None:
        contact_query["contact_id"] = {"$in": body.include_contact_ids}
    else:
        contact_query["is_default_recipient"] = True
    contacts = await db.crew_contacts.find(contact_query, {"_id": 0}).to_list(200)
    recipients: List[str] = []
    seen = set()
    for c in contacts:
        e = (c.get("email") or "").strip().lower()
        if e and e not in seen:
            seen.add(e); recipients.append(e)
    for e in body.extra_recipients or []:
        e2 = (e or "").strip().lower()
        if _EMAIL_RE.match(e2) and e2 not in seen:
            seen.add(e2); recipients.append(e2)

    body_text = await _build_shift_end_body(team_id, body.rig_id, body.hours or 12)
    return {
        "recipients": recipients,
        "body_text": body_text,
        "from_display": f"{user.get('name') or user['email'].split('@')[0]} via CT Pocket <{RESEND_FROM_EMAIL}>",
        "reply_to": user.get("email"),
        "configured": bool(RESEND_API_KEY and _resend is not None),
    }


def _build_sms_text_from_handover(body_text: str, note: Optional[str]) -> str:
    compact = (body_text or "").replace("\r\n", "\n").replace("\r", "\n")
    compact = re.sub(r"\n{3,}", "\n\n", compact).strip()
    if note:
        compact = f"{note.strip()}\n\n{compact}".strip()
    # Keep messages bounded to avoid extreme segmentation costs and truncation.
    if len(compact) > 1200:
        compact = f"{compact[:1192].rstrip()}…"
    return compact


async def _resolve_shift_end_sms_numbers(team_id: str, body: ShiftEndSmsRequest) -> List[str]:
    contact_query: Dict[str, Any] = {"team_id": team_id, "is_deleted": {"$ne": True}}
    if body.include_contact_ids is not None:
        contact_query["contact_id"] = {"$in": body.include_contact_ids}
    else:
        contact_query["is_default_recipient"] = True
    contacts = await db.crew_contacts.find(contact_query, {"_id": 0}).to_list(200)

    numbers: List[str] = []
    seen = set()
    for c in contacts:
        p = _normalize_phone(c.get("phone") or "")
        if p and p not in seen:
            seen.add(p)
            numbers.append(p)
    for raw in body.extra_numbers or []:
        p = _normalize_phone(raw or "")
        if p and p not in seen:
            seen.add(p)
            numbers.append(p)
    return numbers


@api_router.post("/crew/shift-end-sms-preview")
async def preview_shift_end_sms(body: ShiftEndSmsRequest, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    if not body.rig_id:
        raise HTTPException(400, "rig_id required.")

    numbers = await _resolve_shift_end_sms_numbers(team_id, body)
    body_text = await _build_shift_end_body(team_id, body.rig_id, body.hours or 12)
    sms_text = _build_sms_text_from_handover(body_text, body.note)

    return {
        "numbers": numbers,
        "body_text": sms_text,
        "configured": _sms_configured(),
        "provider": SMS_PROVIDER,
        "from_number": SMS_FROM_NUMBER if _sms_configured() else None,
    }


@api_router.post("/crew/shift-end-sms")
async def send_shift_end_sms(body: ShiftEndSmsRequest, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    if not body.rig_id:
        raise HTTPException(400, "rig_id required.")

    numbers = await _resolve_shift_end_sms_numbers(team_id, body)
    if not numbers:
        raise HTTPException(400, "No phone recipients — save at least one crew contact phone or add extra numbers.")
    if len(numbers) > 20:
        raise HTTPException(400, "Max 20 recipients per shift-end text send.")
    fingerprint = _hitl_payload_fingerprint({
        "rig_id": body.rig_id,
        "hours": body.hours,
        "numbers": sorted(numbers),
        "note_len": len((body.note or "").strip()),
    })
    await _consume_hitl_approval(
        action="shift_end_sms_send",
        approval_id=body.hitl_approval_id,
        user=user,
        endpoint="/api/crew/shift-end-sms",
        payload_fingerprint=fingerprint,
    )

    if not _sms_configured():
        raise HTTPException(
            503,
            "SMS sending isn't configured yet. Set SMS_PROVIDER=twilio, SMS_FROM_NUMBER, TWILIO_ACCOUNT_SID, and TWILIO_AUTH_TOKEN.",
        )

    body_text = await _build_shift_end_body(team_id, body.rig_id, body.hours or 12)
    sms_text = _build_sms_text_from_handover(body_text, body.note)

    sent: List[Dict[str, str]] = []
    failed: List[Dict[str, str]] = []
    for number in numbers:
        try:
            sid = await _send_sms_twilio(number, sms_text)
            sent.append({"number": number, "provider_id": sid})
        except Exception as e:
            failed.append({"number": number, "error": str(e)[:220]})

    try:
        await db.handover_sms.insert_one({
            "team_id": team_id,
            "rig_id": body.rig_id,
            "sender_email": user["email"],
            "sender_name": user.get("name") or user["email"].split("@")[0],
            "provider": SMS_PROVIDER,
            "from_number": SMS_FROM_NUMBER,
            "to_numbers": numbers,
            "sent": sent,
            "failed": failed,
            "message_preview": sms_text[:600],
            "hours": body.hours or 12,
            "sent_at": datetime.now(timezone.utc),
        })
    except Exception:
        pass

    if sent and not failed:
        status = "sent"
    elif sent:
        status = "partial"
    else:
        status = "failed"
    return {
        "status": status,
        "sent": sent,
        "failed": failed,
        "recipients": numbers,
        "numbers": numbers,
        "provider": SMS_PROVIDER,
        "configured": _sms_configured(),
        "body_text": sms_text,
    }


# ============ MANAGER DASHBOARD ============
def _user_role(u: dict) -> str:
    return (u or {}).get("role") or "crew"


def _is_manager(u: dict) -> bool:
    return _user_role(u) in ("field_manager", "ops_manager") or _is_admin(u)


@api_router.get("/manager/dashboard")
async def manager_dashboard(hours: int = 24, user: dict = Depends(require_user)):
    """
    Cross-team dashboard for Ops Managers (all teams) or single-team dashboard for Field Managers.
    Returns:
      - scope: "cross_team" | "team"
      - rigs_activity: latest chat + checklist activity per (team, rig)
      - safety_events: recent 'safety' tier checklist events (proxy for cert check-offs)
      - maintenance_events: recent 'pm' tier checklist events (equipment maintenance log)
      - alerts: recent Skipper safety alerts (audit log)
      - inventory_flags: LOW/OOS inventory + consumables
      - parts_open: open parts orders
    """
    if not _is_manager(user):
        raise HTTPException(403, "Manager access required. Redeem an Ops/Field Manager invite code first.")

    hours = max(1, min(hours, 24 * 30))
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    cutoff_pm = now - timedelta(days=30)  # PM/maintenance window is always 30d

    role = _user_role(user)
    cross = role == "ops_manager" or _is_admin(user)

    # Scope filter — cross-team sees everything; field manager only their team
    if cross:
        team_filter: Dict[str, Any] = {}
    else:
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Field Manager needs to be in a team to see this dashboard.")
        team_filter = {"team_id": team_id}

    # Team name lookup (for cross-team labels)
    team_names: Dict[str, str] = {}
    async for t in db.teams.find({}, {"_id": 0, "team_id": 1, "name": 1}):
        team_names[t["team_id"]] = t.get("name") or t["team_id"]

    # ----- Rigs activity: aggregate latest chat/checklist per (team_id, rig_id) -----
    rigs_activity: Dict[str, Dict[str, Any]] = {}
    def _key(team_id: str, rig_id: str) -> str:
        return f"{team_id}::{rig_id or 'unassigned'}"

    async for row in db.crew_messages.aggregate([
        {"$match": {**team_filter, "rig_id": {"$ne": None}}},
        {"$group": {
            "_id": {"team_id": "$team_id", "rig_id": "$rig_id"},
            "last_at": {"$max": "$created_at"},
            "count": {"$sum": 1},
        }},
    ]):
        k = _key(row["_id"]["team_id"], row["_id"]["rig_id"])
        rigs_activity.setdefault(k, {
            "team_id": row["_id"]["team_id"],
            "team_name": team_names.get(row["_id"]["team_id"], row["_id"]["team_id"]),
            "rig_id": row["_id"]["rig_id"],
        })
        rigs_activity[k]["last_chat_at"] = row["last_at"].isoformat() if isinstance(row["last_at"], datetime) else row["last_at"]
        rigs_activity[k]["chat_count"] = row["count"]

    async for row in db.checklist_events.aggregate([
        {"$match": team_filter},
        {"$group": {
            "_id": {"team_id": "$team_id", "rig_id": "$rig_id"},
            "last_at": {"$max": "$created_at"},
            "count": {"$sum": 1},
        }},
    ]):
        k = _key(row["_id"]["team_id"], row["_id"]["rig_id"])
        rigs_activity.setdefault(k, {
            "team_id": row["_id"]["team_id"],
            "team_name": team_names.get(row["_id"]["team_id"], row["_id"]["team_id"]),
            "rig_id": row["_id"]["rig_id"],
        })
        rigs_activity[k]["last_checklist_at"] = row["last_at"].isoformat() if isinstance(row["last_at"], datetime) else row["last_at"]
        rigs_activity[k]["checklist_count"] = row["count"]

    def _sort_key(r):
        return max(r.get("last_chat_at") or "", r.get("last_checklist_at") or "")
    rigs_list = sorted(rigs_activity.values(), key=_sort_key, reverse=True)

    # ----- Recent safety-tier check-offs (last N hours) -----
    safety_events = await db.checklist_events.find(
        {**team_filter, "tier": "safety", "action": "checked", "created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    # ----- Equipment maintenance log (PM tier, last 30 days) -----
    maintenance_events = await db.checklist_events.find(
        {**team_filter, "tier": "pm", "action": "checked", "created_at": {"$gte": cutoff_pm}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    # ----- Recent alerts (audit log) -----
    alerts = await db.crew_alerts.find(
        {**team_filter, "created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)

    # ----- Inventory / consumables flags (LOW/OOS) -----
    inv_flags = await db.team_items.find(
        {**team_filter, "kind": {"$in": ["inventory", "consumables"]}, "status": {"$in": ["LOW", "OOS"]}},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(200)

    # ----- Open parts orders -----
    parts_open = await db.team_items.find(
        {**team_filter, "kind": "parts_order", "status": {"$in": ["REQUESTED", "ORDERED"]}},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(200)

    # Attach team_name for readability on cross-team view
    def _attach_team(docs):
        return [{**d, "team_name": team_names.get(d.get("team_id"), d.get("team_id"))} for d in docs]

    return {
        "scope": "cross_team" if cross else "team",
        "role": role,
        "hours": hours,
        "generated_at": now.isoformat(),
        "totals": {
            "teams_seen": len({r["team_id"] for r in rigs_list}),
            "rigs_seen": len(rigs_list),
            "safety_events": len(safety_events),
            "maintenance_events": len(maintenance_events),
            "alerts": len(alerts),
            "inventory_flags": len(inv_flags),
            "parts_open": len(parts_open),
        },
        "rigs_activity": rigs_list,
        "safety_events": _attach_team([_serialize(d) for d in safety_events]),
        "maintenance_events": _attach_team([_serialize(d) for d in maintenance_events]),
        "alerts": _attach_team([_serialize(d) for d in alerts]),
        "inventory_flags": _attach_team([_serialize(d) for d in inv_flags]),
        "parts_open": _attach_team([_serialize(d) for d in parts_open]),
    }


# ============ USER PREFERENCES ============
class UserPrefUpdate(BaseModel):
    service_view: Optional[str] = None  # coil_tubing | stand_alone_frac | coil_tools | all


@api_router.patch("/users/me")
async def update_user_prefs(body: UserPrefUpdate, user: dict = Depends(require_user)):
    valid = {"coil_tubing", "stand_alone_frac", "coil_tools", "all"}
    updates: Dict[str, Any] = {}
    if body.service_view is not None:
        if body.service_view not in valid:
            raise HTTPException(400, f"service_view must be one of {sorted(valid)}")
        updates["service_view"] = body.service_view
    if not updates:
        raise HTTPException(400, "Nothing to update.")
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return _serialize(doc)


# ============ EQUIPMENT & ASSET TRACKING ============
EQUIPMENT_KINDS = {"engine", "injector", "lifting", "bop_pce", "reel_iron"}


class EquipmentCreate(BaseModel):
    kind: str
    rig_id: Optional[str] = None
    name: str
    serial_number: Optional[str] = None
    # Engine
    current_hours: Optional[float] = None
    service_interval_hours: Optional[float] = 250
    last_service_hours: Optional[float] = None
    last_service_date: Optional[str] = None
    # Injector
    cumulative_meters: Optional[float] = None
    cumulative_hours: Optional[float] = None
    cycles_count: Optional[int] = None
    # Lifting
    description: Optional[str] = None
    capacity: Optional[str] = None
    cert_expiry_date: Optional[str] = None       # ISO date
    last_inspection_date: Optional[str] = None
    # BOP / PCE
    last_test_date: Optional[str] = None
    test_interval_months: Optional[int] = 6
    test_type: Optional[str] = None  # function | pressure
    # Reel / Treating Iron
    item_type: Optional[str] = None  # reel | iron
    working_pressure_psi: Optional[float] = None
    current_pressure_psi: Optional[float] = None
    note: Optional[str] = None


class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    serial_number: Optional[str] = None
    rig_id: Optional[str] = None
    current_hours: Optional[float] = None
    service_interval_hours: Optional[float] = None
    last_service_hours: Optional[float] = None
    last_service_date: Optional[str] = None
    cumulative_meters: Optional[float] = None
    cumulative_hours: Optional[float] = None
    cycles_count: Optional[int] = None
    description: Optional[str] = None
    capacity: Optional[str] = None
    cert_expiry_date: Optional[str] = None
    last_inspection_date: Optional[str] = None
    last_test_date: Optional[str] = None
    test_interval_months: Optional[int] = None
    test_type: Optional[str] = None
    item_type: Optional[str] = None
    working_pressure_psi: Optional[float] = None
    current_pressure_psi: Optional[float] = None
    note: Optional[str] = None


class EquipmentLogEntry(BaseModel):
    action: str  # e.g. "hours_update" | "service" | "test" | "inspection" | "pressure_update" | "note"
    hours: Optional[float] = None
    meters: Optional[float] = None
    pressure_psi: Optional[float] = None
    date: Optional[str] = None
    note: Optional[str] = None


def _iso_date(v):
    if not v:
        return None
    try:
        # Accept 'YYYY-MM-DD' or full ISO
        if len(v) == 10:
            return datetime.fromisoformat(v + "T00:00:00+00:00")
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    except Exception:
        return None


def _engine_status(doc: dict) -> Optional[tuple]:
    curr = doc.get("current_hours")
    if curr is None:
        return None
    last_svc = doc.get("last_service_hours") or 0
    interval = doc.get("service_interval_hours") or 250
    hours_left = (last_svc + interval) - curr
    if hours_left <= 0:
        return "red", f"Service overdue by {abs(hours_left):.0f} h (interval {interval:.0f} h)."
    if hours_left <= 50:
        return "amber", f"Service due in {hours_left:.0f} h."
    return None


def _lifting_status(doc: dict) -> Optional[tuple]:
    exp = _iso_date(doc.get("cert_expiry_date"))
    if not exp:
        return None
    days_left = (exp - datetime.now(timezone.utc)).days
    if days_left < 0:
        return "expired", f"Certification expired {abs(days_left)} day(s) ago."
    if days_left <= 7:
        return "red", f"Cert expires in {days_left} day(s) — pull from service after next use."
    if days_left <= 30:
        return "amber", f"Cert expires in {days_left} day(s)."
    return None


def _bop_status(doc: dict) -> Optional[tuple]:
    last = _iso_date(doc.get("last_test_date"))
    interval_m = doc.get("test_interval_months") or 6
    if not last:
        return "amber", "No test date on file — schedule a function + pressure test."
    due = last + timedelta(days=int(interval_m * 30.44))
    days_left = (due - datetime.now(timezone.utc)).days
    if days_left < 0:
        return "red", f"Test overdue by {abs(days_left)} day(s) (AER Dir 037)."
    if days_left <= 14:
        return "amber", f"Test due in {days_left} day(s)."
    return None


def _reel_iron_status(doc: dict) -> Optional[tuple]:
    mawp = doc.get("working_pressure_psi")
    curr = doc.get("current_pressure_psi")
    if not (mawp and curr and mawp > 0):
        return None
    pct = (curr / mawp) * 100.0
    if pct >= 100:
        return "red", f"At/over MAWP ({pct:.0f}% of {mawp:.0f} psi)."
    if pct >= 90:
        return "amber", f"At {pct:.0f}% MAWP — reduce pressure or upgrade iron."
    return None


_STATUS_CALCULATORS = {
    "engine":    _engine_status,
    "lifting":   _lifting_status,
    "bop_pce":   _bop_status,
    "reel_iron": _reel_iron_status,
}


def _compute_equipment_status(doc: dict) -> Dict[str, Any]:
    """Server-side status flags — returned alongside every equipment doc."""
    calc = _STATUS_CALCULATORS.get(doc.get("kind"))
    if not calc:
        return {"status": "ok", "reasons": []}
    result = calc(doc)
    if not result:
        return {"status": "ok", "reasons": []}
    status, reason = result
    return {"status": status, "reasons": [reason]}


@api_router.get("/equipment")
async def list_equipment(rig_id: Optional[str] = None, kind: Optional[str] = None, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"items": [], "team_id": None}
    if kind and kind not in EQUIPMENT_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(EQUIPMENT_KINDS)}")
    query: Dict[str, Any] = {"team_id": team_id}
    if kind:
        query["kind"] = kind
    if rig_id:
        query["$or"] = [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}]
    docs = await db.equipment_items.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
    out = []
    for d in docs:
        s = _serialize(d)
        s.update(_compute_equipment_status(d))
        out.append(s)
    return {"items": out, "team_id": team_id, "rig_id": rig_id}


@api_router.post("/equipment")
async def create_equipment(body: EquipmentCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    if body.kind not in EQUIPMENT_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(EQUIPMENT_KINDS)}")
    if not body.name.strip():
        raise HTTPException(400, "Name is required.")
    now = datetime.now(timezone.utc)
    doc = body.model_dump()
    doc.update({
        "item_id": f"eq_{uuid.uuid4().hex[:12]}",
        "team_id": team_id,
        "name": body.name.strip(),
        "history": [],
        "created_by": user["email"],
        "created_by_name": user.get("name") or user["email"].split("@")[0],
        "created_at": now,
        "updated_at": now,
    })
    await db.equipment_items.insert_one(doc)
    doc.pop("_id", None)
    out = _serialize(doc); out.update(_compute_equipment_status(doc))
    return out


@api_router.patch("/equipment/{item_id}")
async def patch_equipment(item_id: str, body: EquipmentUpdate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update.")
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await db.equipment_items.update_one({"item_id": item_id, "team_id": team_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Not found.")
    doc = await db.equipment_items.find_one({"item_id": item_id}, {"_id": 0})
    out = _serialize(doc); out.update(_compute_equipment_status(doc))
    return out


@api_router.post("/equipment/{item_id}/log")
async def log_equipment_event(item_id: str, body: EquipmentLogEntry, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    doc = await db.equipment_items.find_one({"item_id": item_id, "team_id": team_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found.")
    now = datetime.now(timezone.utc)
    event = {
        "event_id": f"evt_{uuid.uuid4().hex[:12]}",
        "action": body.action,
        "hours": body.hours,
        "meters": body.meters,
        "pressure_psi": body.pressure_psi,
        "date": body.date,
        "note": body.note,
        "user_name": user.get("name") or user["email"].split("@")[0],
        "user_email": user["email"],
        "created_at": now,
    }
    updates: Dict[str, Any] = {"updated_at": now}
    if body.action == "service" and body.hours is not None:
        updates["last_service_hours"] = body.hours
        updates["last_service_date"] = body.date or now.date().isoformat()
    if body.action == "test":
        updates["last_test_date"] = body.date or now.date().isoformat()
    if body.action == "inspection":
        updates["last_inspection_date"] = body.date or now.date().isoformat()
    if body.action == "hours_update" and body.hours is not None:
        updates["current_hours"] = body.hours
    if body.action == "meters_update":
        if body.meters is not None:
            updates["cumulative_meters"] = body.meters
        if body.hours is not None:
            updates["cumulative_hours"] = body.hours
    if body.action == "pressure_update" and body.pressure_psi is not None:
        updates["current_pressure_psi"] = body.pressure_psi
    await db.equipment_items.update_one(
        {"item_id": item_id, "team_id": team_id},
        {"$set": updates, "$push": {"history": event}},
    )
    doc = await db.equipment_items.find_one({"item_id": item_id}, {"_id": 0})
    out = _serialize(doc); out.update(_compute_equipment_status(doc))
    return out


@api_router.delete("/equipment/{item_id}")
async def delete_equipment(item_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    r = await db.equipment_items.delete_one({"item_id": item_id, "team_id": team_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found.")
    return {"success": True}


# ============ CREW SCHEDULE ============
SHIFT_ROLES = {"Operator", "Supervisor", "Chief Op", "Swamper", "Pump Op", "Pusher", "Crane Op", "Other"}
SHIFT_TOURS = {"day", "night"}
SHIFT_PATTERNS = {"one_off", "14/14", "20/10", "7/7", "custom"}


class ScheduleShiftCreate(BaseModel):
    rig_id: str
    crew_member_name: str
    role: str = "Operator"
    tour: str = "day"                  # day | night
    start_date: str                    # ISO date YYYY-MM-DD
    end_date: Optional[str] = None     # ISO date; inclusive
    pattern: str = "one_off"           # one_off | 14/14 | 20/10 | 7/7 | custom
    rotation_days_on: Optional[int] = None
    rotation_days_off: Optional[int] = None
    repeat_cycles: int = 1             # for rotation patterns, how many on/off cycles to generate
    note: Optional[str] = None


class ScheduleShiftUpdate(BaseModel):
    crew_member_name: Optional[str] = None
    role: Optional[str] = None
    tour: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    note: Optional[str] = None


class CrewMemberInput(BaseModel):
    name: str
    role: str = "Operator"


class CrewCreate(BaseModel):
    rig_id: str
    name: str                              # e.g. "Crew A"
    tour: str = "day"                      # day | night
    pattern: str = "14/14"                 # 14/14 | 20/10 | 7/7 | custom
    rotation_days_on: Optional[int] = None
    rotation_days_off: Optional[int] = None
    start_date: str                        # crew-change / first-on-shift date
    repeat_cycles: int = 6                 # how many on/off cycles to project
    members: List[CrewMemberInput] = Field(default_factory=list)
    auto_create_opposite: bool = False     # also create an opposing crew that flips days
    opposite_name: Optional[str] = None    # optional custom name for the opposite crew
    note: Optional[str] = None


class CrewUpdate(BaseModel):
    name: Optional[str] = None
    tour: Optional[str] = None
    pattern: Optional[str] = None
    rotation_days_on: Optional[int] = None
    rotation_days_off: Optional[int] = None
    start_date: Optional[str] = None
    repeat_cycles: Optional[int] = None
    members: Optional[List[CrewMemberInput]] = None
    note: Optional[str] = None


def _parse_ymd(v: str) -> datetime:
    try:
        return datetime.fromisoformat(v + "T00:00:00+00:00")
    except Exception:
        raise HTTPException(400, f"Bad date: {v}")


def _pattern_to_on_off(pattern: str, on: Optional[int], off: Optional[int]):
    if pattern == "14/14": return 14, 14
    if pattern == "20/10": return 20, 10
    if pattern == "7/7":   return 7, 7
    if pattern == "custom":
        if not on or not off:
            raise HTTPException(400, "Custom pattern requires rotation_days_on and rotation_days_off.")
        return int(on), int(off)
    return None, None  # one_off


@api_router.get("/schedule")
async def list_shifts(rig_id: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"shifts": [], "team_id": None}
    query: Dict[str, Any] = {"team_id": team_id}
    if rig_id:
        query["rig_id"] = rig_id
    if start or end:
        # A shift is included if its window overlaps [start,end].
        window: Dict[str, Any] = {}
        if start:
            window["start_date"] = start
        if end:
            window["end_date_lte"] = end
        # Simple filter: shift.end_date >= start AND shift.start_date <= end
        cond: Dict[str, Any] = {}
        if start: cond["end_date"] = {"$gte": start}
        if end:   cond["start_date"] = {"$lte": end}
        query.update(cond)
    docs = await db.crew_shifts.find(query, {"_id": 0}).sort("start_date", 1).to_list(1000)
    return {"shifts": [_serialize(d) for d in docs], "team_id": team_id, "rig_id": rig_id}


@api_router.post("/schedule")
async def create_shift(body: ScheduleShiftCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    if body.role not in SHIFT_ROLES:
        raise HTTPException(400, f"role must be one of {sorted(SHIFT_ROLES)}")
    if body.tour not in SHIFT_TOURS:
        raise HTTPException(400, "tour must be day|night")
    if body.pattern not in SHIFT_PATTERNS:
        raise HTTPException(400, f"pattern must be one of {sorted(SHIFT_PATTERNS)}")
    start = _parse_ymd(body.start_date)
    now = datetime.now(timezone.utc)

    shifts_to_insert: List[dict] = []

    if body.pattern == "one_off":
        end = _parse_ymd(body.end_date) if body.end_date else start
        if end < start:
            raise HTTPException(400, "end_date must be on/after start_date.")
        shifts_to_insert.append({
            "start_date": start.date().isoformat(),
            "end_date": end.date().isoformat(),
        })
    else:
        on_d, off_d = _pattern_to_on_off(body.pattern, body.rotation_days_on, body.rotation_days_off)
        cycles = max(1, min(body.repeat_cycles or 1, 24))
        cursor = start
        for _ in range(cycles):
            on_end = cursor + timedelta(days=on_d - 1)
            shifts_to_insert.append({
                "start_date": cursor.date().isoformat(),
                "end_date": on_end.date().isoformat(),
            })
            cursor = on_end + timedelta(days=off_d + 1)

    inserted = []
    for span in shifts_to_insert:
        doc = {
            "shift_id": f"shf_{uuid.uuid4().hex[:12]}",
            "team_id": team_id,
            "rig_id": body.rig_id,
            "crew_member_name": body.crew_member_name.strip()[:120],
            "role": body.role,
            "tour": body.tour,
            "pattern": body.pattern,
            "rotation_days_on": None if body.pattern == "one_off" else (body.rotation_days_on if body.pattern == "custom" else _pattern_to_on_off(body.pattern, None, None)[0]),
            "rotation_days_off": None if body.pattern == "one_off" else (body.rotation_days_off if body.pattern == "custom" else _pattern_to_on_off(body.pattern, None, None)[1]),
            "note": body.note,
            "created_by": user["email"],
            "created_by_name": user.get("name") or user["email"].split("@")[0],
            "created_at": now,
            "updated_at": now,
            **span,
        }
        await db.crew_shifts.insert_one(doc)
        doc.pop("_id", None)
        inserted.append(_serialize(doc))
    return {"shifts": inserted, "count": len(inserted)}


@api_router.patch("/schedule/{shift_id}")
async def patch_shift(shift_id: str, body: ScheduleShiftUpdate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "role" in updates and updates["role"] not in SHIFT_ROLES:
        raise HTTPException(400, f"role must be one of {sorted(SHIFT_ROLES)}")
    if "tour" in updates and updates["tour"] not in SHIFT_TOURS:
        raise HTTPException(400, "tour must be day|night")
    if not updates:
        raise HTTPException(400, "No fields to update.")
    updates["updated_at"] = datetime.now(timezone.utc)
    r = await db.crew_shifts.update_one({"shift_id": shift_id, "team_id": team_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found.")
    doc = await db.crew_shifts.find_one({"shift_id": shift_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/schedule/{shift_id}")
async def delete_shift(shift_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    r = await db.crew_shifts.delete_one({"shift_id": shift_id, "team_id": team_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found.")
    return {"success": True}


# ============ CREWS (personnel + rotation, auto-generates shifts) ============
def _generate_shifts_for_crew(crew: dict, opposite: bool = False) -> List[dict]:
    """Given a crew doc, return a list of shift docs (one per rotation cycle per member)."""
    pattern = crew["pattern"]
    on_d, off_d = _pattern_to_on_off(pattern, crew.get("rotation_days_on"), crew.get("rotation_days_off"))
    cycles = max(1, min(int(crew.get("repeat_cycles") or 1), 24))
    start = _parse_ymd(crew["start_date"])
    if opposite:
        start = start + timedelta(days=on_d)  # opposite crew starts the day after this one ends
    tour = crew["tour"]
    if opposite:
        tour = "night" if tour == "day" else "day"
    now = datetime.now(timezone.utc)
    shifts: List[dict] = []
    for member in crew.get("members", []):
        member_name = (member.get("name") or "").strip()[:120]
        if not member_name:
            continue
        role = member.get("role") or "Operator"
        if role not in SHIFT_ROLES:
            role = "Other"
        cursor = start
        for _ in range(cycles):
            on_end = cursor + timedelta(days=on_d - 1)
            shifts.append({
                "shift_id": f"shf_{uuid.uuid4().hex[:12]}",
                "team_id": crew["team_id"],
                "rig_id": crew["rig_id"],
                "crew_id": crew["crew_id"],
                "crew_name": crew["name"],
                "crew_member_name": member_name,
                "role": role,
                "tour": tour,
                "pattern": pattern,
                "rotation_days_on": on_d,
                "rotation_days_off": off_d,
                "note": crew.get("note"),
                "created_by": crew["created_by"],
                "created_by_name": crew.get("created_by_name") or crew["created_by"].split("@")[0],
                "created_at": now,
                "updated_at": now,
                "start_date": cursor.date().isoformat(),
                "end_date": on_end.date().isoformat(),
            })
            cursor = on_end + timedelta(days=off_d + 1)
    return shifts


@api_router.get("/crews")
async def list_crews(rig_id: Optional[str] = None, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"crews": [], "team_id": None}
    q: Dict[str, Any] = {"team_id": team_id}
    if rig_id:
        q["rig_id"] = rig_id
    docs = await db.crews.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"crews": [_serialize(d) for d in docs], "team_id": team_id, "rig_id": rig_id}


@api_router.post("/crews")
async def create_crew(body: CrewCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    if body.tour not in SHIFT_TOURS:
        raise HTTPException(400, "tour must be day|night")
    if body.pattern not in SHIFT_PATTERNS or body.pattern == "one_off":
        raise HTTPException(400, "pattern must be one of 14/14, 20/10, 7/7, custom")
    _parse_ymd(body.start_date)  # validates date
    # Validate rotation for custom
    if body.pattern == "custom" and (not body.rotation_days_on or not body.rotation_days_off):
        raise HTTPException(400, "Custom pattern requires rotation_days_on and rotation_days_off.")
    # Validate members
    clean_members = []
    for m in body.members or []:
        n = (m.name or "").strip()[:120]
        if not n:
            continue
        r = m.role if m.role in SHIFT_ROLES else "Other"
        clean_members.append({"name": n, "role": r})
    if not clean_members:
        raise HTTPException(400, "Add at least one crew member.")
    now = datetime.now(timezone.utc)

    crew_a = {
        "crew_id": f"crw_{uuid.uuid4().hex[:12]}",
        "team_id": team_id,
        "rig_id": body.rig_id,
        "name": (body.name or "").strip()[:120] or "Crew",
        "tour": body.tour,
        "pattern": body.pattern,
        "rotation_days_on": body.rotation_days_on if body.pattern == "custom" else _pattern_to_on_off(body.pattern, None, None)[0],
        "rotation_days_off": body.rotation_days_off if body.pattern == "custom" else _pattern_to_on_off(body.pattern, None, None)[1],
        "start_date": body.start_date,
        "repeat_cycles": max(1, min(int(body.repeat_cycles or 1), 24)),
        "members": clean_members,
        "note": (body.note or None),
        "paired_crew_id": None,
        "created_by": user["email"],
        "created_by_name": user.get("name") or user["email"].split("@")[0],
        "created_at": now,
        "updated_at": now,
    }

    created_crews = [crew_a]

    if body.auto_create_opposite:
        opp_tour = "night" if crew_a["tour"] == "day" else "day"
        opp_name = (body.opposite_name or "").strip()[:120] or _mirror_crew_name(crew_a["name"])
        # Opposite crew's first-on-shift date is the day after crew A's first cycle ends
        opp_on_d = crew_a["rotation_days_on"] or _pattern_to_on_off(crew_a["pattern"], None, None)[0] or 14
        opp_start = (_parse_ymd(crew_a["start_date"]) + timedelta(days=opp_on_d)).date().isoformat()
        crew_b = {
            **crew_a,
            "crew_id": f"crw_{uuid.uuid4().hex[:12]}",
            "name": opp_name,
            "tour": opp_tour,
            "start_date": opp_start,
            "members": [],  # user fills opposite crew later
            "paired_crew_id": crew_a["crew_id"],
            "created_at": now,
            "updated_at": now,
        }
        crew_a["paired_crew_id"] = crew_b["crew_id"]
        created_crews.append(crew_b)

    # Persist crews
    for c in created_crews:
        await db.crews.insert_one(dict(c))
        c.pop("_id", None)

    # Generate shifts
    total_shifts = 0
    for c in created_crews:
        if not c.get("members"):
            continue  # opposite crew with no members yet — user can add later
        shifts = _generate_shifts_for_crew(c, opposite=False)
        if shifts:
            await db.crew_shifts.insert_many([dict(s) for s in shifts])
            total_shifts += len(shifts)

    return {"crews": [_serialize(c) for c in created_crews], "shifts_generated": total_shifts}


def _mirror_crew_name(name: str) -> str:
    n = (name or "").strip()
    if not n:
        return "Opposite crew"
    # If crew name ends with a single letter, flip A<->B, C<->D etc.
    if len(n) >= 2 and n[-2] in " -" and n[-1].isalpha():
        letter = n[-1].upper()
        flipped = "B" if letter == "A" else ("A" if letter == "B" else chr(((ord(letter) - 64) % 26) + 65))
        return n[:-1] + flipped
    return n + " (opposite)"


@api_router.patch("/crews/{crew_id}")
async def update_crew(crew_id: str, body: CrewUpdate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    crew = await db.crews.find_one({"crew_id": crew_id, "team_id": team_id}, {"_id": 0})
    if not crew:
        raise HTTPException(404, "Crew not found.")

    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update.")
    if "tour" in updates and updates["tour"] not in SHIFT_TOURS:
        raise HTTPException(400, "tour must be day|night")
    if "pattern" in updates:
        if updates["pattern"] not in SHIFT_PATTERNS or updates["pattern"] == "one_off":
            raise HTTPException(400, "pattern must be one of 14/14, 20/10, 7/7, custom")
    if "members" in updates:
        clean = []
        for m in updates["members"]:
            n = (m.get("name") or "").strip()[:120]
            if not n:
                continue
            r = m.get("role") if m.get("role") in SHIFT_ROLES else "Other"
            clean.append({"name": n, "role": r})
        updates["members"] = clean
    if "start_date" in updates:
        _parse_ymd(updates["start_date"])
    if "repeat_cycles" in updates:
        updates["repeat_cycles"] = max(1, min(int(updates["repeat_cycles"] or 1), 24))
    if "name" in updates:
        updates["name"] = (updates["name"] or "").strip()[:120] or crew["name"]
    if updates.get("pattern") == "custom":
        # Ensure rotation days present after update
        merged = {**crew, **updates}
        if not merged.get("rotation_days_on") or not merged.get("rotation_days_off"):
            raise HTTPException(400, "Custom pattern requires rotation_days_on and rotation_days_off.")
    updates["updated_at"] = datetime.now(timezone.utc)

    await db.crews.update_one({"crew_id": crew_id, "team_id": team_id}, {"$set": updates})

    # Regenerate shifts: drop any crew_id-scoped shifts, then rebuild from merged doc
    await db.crew_shifts.delete_many({"crew_id": crew_id, "team_id": team_id})
    merged = {**crew, **updates}
    if merged.get("members"):
        shifts = _generate_shifts_for_crew(merged, opposite=False)
        if shifts:
            await db.crew_shifts.insert_many([dict(s) for s in shifts])
    doc = await db.crews.find_one({"crew_id": crew_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/crews/{crew_id}")
async def delete_crew(crew_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    r = await db.crews.delete_one({"crew_id": crew_id, "team_id": team_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Crew not found.")
    # Drop generated shifts too
    await db.crew_shifts.delete_many({"crew_id": crew_id, "team_id": team_id})
    # Un-pair partner
    await db.crews.update_many({"team_id": team_id, "paired_crew_id": crew_id}, {"$set": {"paired_crew_id": None}})
    return {"success": True}


# ============ TREATMENT REPORTING (live rig-scoped job log) ============
class TreatmentCreate(BaseModel):
    rig_id: str
    name: str
    well_or_job_no: Optional[str] = None
    note: Optional[str] = None


class TreatmentEntryCreate(BaseModel):
    text: str
    event_at: Optional[str] = None   # ISO timestamp of when the event actually happened (if different from logged time)
    kind: Optional[str] = "note"     # 'note' | 'event' | 'npt'
    npt_category: Optional[str] = None   # equipment | weather | wait_on_well | hse | other
    npt_minutes: Optional[int] = None    # duration for NPT entries
    operation_code: Optional[int] = None # 1..69 from the open-domain operation dialect
    telemetry_snapshot: Optional[Dict[str, Any]] = None  # {depth_ft, weight_lb, p_internal_psi, p_external_psi, traction_pressure_psi, vm_utilization, fatigue_worst, source}


class TreatmentEntryUpdate(BaseModel):
    text: Optional[str] = None
    event_at: Optional[str] = None   # retroactively correct the event time
    kind: Optional[str] = None
    npt_category: Optional[str] = None
    npt_minutes: Optional[int] = None
    operation_code: Optional[int] = None


@api_router.get("/treatments")
async def list_treatments(rig_id: Optional[str] = None, status: Optional[str] = None, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"treatments": [], "team_id": None}
    q: Dict[str, Any] = {"team_id": team_id}
    if rig_id: q["rig_id"] = rig_id
    if status in ("active", "closed"): q["status"] = status
    docs = await db.treatments.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"treatments": [_serialize(d) for d in docs], "team_id": team_id, "rig_id": rig_id}


@api_router.get("/treatments/active")
async def get_active_treatment(rig_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"treatment": None}
    doc = await db.treatments.find_one({"team_id": team_id, "rig_id": rig_id, "status": "active"}, {"_id": 0}, sort=[("created_at", -1)])
    return {"treatment": _serialize(doc) if doc else None}


@api_router.post("/treatments")
async def start_treatment(body: TreatmentCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    name = (body.name or "").strip()[:160]
    if not name:
        raise HTTPException(400, "Give the treatment a name (e.g. well number or job).")
    now = datetime.now(timezone.utc)
    # Auto-close any existing active treatment on this rig (one at a time per rig)
    await db.treatments.update_many(
        {"team_id": team_id, "rig_id": body.rig_id, "status": "active"},
        {"$set": {"status": "closed", "closed_at": now, "closed_by": user["email"]}},
    )
    doc = {
        "treatment_id": f"trt_{uuid.uuid4().hex[:12]}",
        "team_id": team_id,
        "rig_id": body.rig_id,
        "name": name,
        "well_or_job_no": (body.well_or_job_no or "").strip()[:80] or None,
        "note": (body.note or "").strip()[:400] or None,
        "status": "active",
        "created_by": user["email"],
        "created_by_name": user.get("name") or user["email"].split("@")[0],
        "created_at": now,
        "updated_at": now,
        "closed_at": None,
        "closed_by": None,
        "entry_count": 0,
        "last_entry_at": None,
    }
    await db.treatments.insert_one(doc)
    doc.pop("_id", None)
    return _serialize(doc)


@api_router.post("/treatments/{treatment_id}/close")
async def close_treatment(treatment_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    now = datetime.now(timezone.utc)
    r = await db.treatments.update_one(
        {"treatment_id": treatment_id, "team_id": team_id, "status": "active"},
        {"$set": {"status": "closed", "closed_at": now, "closed_by": user["email"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Active treatment not found.")
    doc = await db.treatments.find_one({"treatment_id": treatment_id}, {"_id": 0})
    return _serialize(doc)


@api_router.delete("/treatments/{treatment_id}")
async def delete_treatment(treatment_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    trt = await db.treatments.find_one({"treatment_id": treatment_id, "team_id": team_id}, {"_id": 0})
    if not trt:
        raise HTTPException(404, "Treatment not found.")
    # Only creator or admin can delete
    if trt.get("created_by") != user["email"] and not _is_admin(user):
        raise HTTPException(403, "Only the treatment owner or an admin can delete.")
    await db.treatment_entries.delete_many({"treatment_id": treatment_id, "team_id": team_id})
    await db.treatments.delete_one({"treatment_id": treatment_id, "team_id": team_id})
    return {"success": True}


@api_router.get("/treatments/{treatment_id}/entries")
async def list_treatment_entries(treatment_id: str, since: Optional[str] = None, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        return {"entries": [], "treatment": None}
    trt = await db.treatments.find_one({"treatment_id": treatment_id, "team_id": team_id}, {"_id": 0})
    if not trt:
        raise HTTPException(404, "Treatment not found.")
    q: Dict[str, Any] = {"treatment_id": treatment_id, "team_id": team_id}
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)
            q["created_at"] = {"$gt": since_dt}
        except Exception:
            pass  # bad since — return all
    docs = await db.treatment_entries.find(q, {"_id": 0}).sort("created_at", 1).to_list(2000)
    # Backfill event_at for legacy entries, then sort by event time so retroactive
    # stamps slot into their correct chronological position.
    for d in docs:
        if not d.get("event_at"):
            d["event_at"] = d.get("created_at")
    docs.sort(key=lambda d: d.get("event_at") or d.get("created_at"))
    return {"entries": [_serialize(d) for d in docs], "treatment": _serialize(trt)}


ALLOWED_ENTRY_KINDS = ("note", "event", "npt")
ALLOWED_NPT_CATEGORIES = ("equipment", "weather", "wait_on_well", "hse", "other")


def _validate_entry_kind(kind: Optional[str], npt_cat: Optional[str], npt_min: Optional[int]) -> dict:
    k = (kind or "note").lower()
    if k not in ALLOWED_ENTRY_KINDS:
        raise HTTPException(400, f"kind must be one of {ALLOWED_ENTRY_KINDS}")
    out = {"kind": k, "npt_category": None, "npt_minutes": None}
    if k == "npt":
        cat = (npt_cat or "").lower()
        if cat not in ALLOWED_NPT_CATEGORIES:
            raise HTTPException(400, f"npt_category must be one of {ALLOWED_NPT_CATEGORIES}")
        if npt_min is None or int(npt_min) <= 0 or int(npt_min) > 7 * 24 * 60:
            raise HTTPException(400, "npt_minutes must be a positive integer ≤ 10080")
        out["npt_category"] = cat
        out["npt_minutes"] = int(npt_min)
    return out


@api_router.post("/treatments/{treatment_id}/entries")
async def add_treatment_entry(treatment_id: str, body: TreatmentEntryCreate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team first.")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Entry text can't be empty.")
    if len(text) > 2000:
        raise HTTPException(400, "Entry too long (max 2000 chars).")
    trt = await db.treatments.find_one({"treatment_id": treatment_id, "team_id": team_id}, {"_id": 0})
    if not trt:
        raise HTTPException(404, "Treatment not found.")
    if trt.get("status") != "active":
        raise HTTPException(400, "Treatment is closed — reopen or start a new one to log entries.")
    now = datetime.now(timezone.utc)
    # If the user supplied an explicit event time (e.g. logging later from a computer
    # for an event they witnessed outside), accept it. Otherwise event_at = now.
    event_at = now
    if body.event_at:
        try:
            s = body.event_at.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(s)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            # Clamp: can't be in the future, can't be older than 30 days
            if parsed > now + timedelta(minutes=5):
                raise HTTPException(400, "Event time can't be in the future.")
            if parsed < now - timedelta(days=30):
                raise HTTPException(400, "Event time can't be older than 30 days.")
            event_at = parsed
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(400, "Invalid event_at timestamp.")
    doc = {
        "entry_id": f"trn_{uuid.uuid4().hex[:12]}",
        "treatment_id": treatment_id,
        "team_id": team_id,
        "rig_id": trt["rig_id"],
        "author": user["email"],
        "author_name": user.get("name") or user["email"].split("@")[0],
        "text": text,
        "created_at": now,
        "event_at": event_at,
        **_validate_entry_kind(body.kind, body.npt_category, body.npt_minutes),
    }
    # Operation Dialect code (1..69) — open-domain CT activity code library.
    if body.operation_code is not None:
        if not isinstance(body.operation_code, int) or not (1 <= body.operation_code <= 69):
            raise HTTPException(400, "operation_code must be an integer between 1 and 69.")
        doc["operation_code"] = body.operation_code
    # Live-telemetry snapshot: either client-supplied (preferred — it's the
    # exact tick the note was dropped on) or auto-snapped from the latest
    # live-ops sample for this rig if the client didn't send one.
    snap = body.telemetry_snapshot
    if not snap and body.operation_code is not None:
        try:
            latest = await db.liveops_samples.find_one(
                {"team_id": team_id, "rig_id": trt["rig_id"]},
                {"_id": 0}, sort=[("created_at", -1)]
            )
            if latest:
                snap = {
                    k: latest.get(k) for k in (
                        "depth_ft", "weight_lb", "pressure_psi", "p_internal_psi",
                        "p_external_psi", "traction_pressure_psi", "axial_force_lbf",
                        "vm_utilization", "fatigue_worst", "source",
                    ) if latest.get(k) is not None
                }
                snap["sampled_at"] = latest.get("created_at")
        except Exception:
            logger.debug("telemetry snapshot auto-capture failed", exc_info=True)
    if snap:
        # Normalize datetime fields to ISO strings so the entry is JSON-safe.
        if isinstance(snap.get("sampled_at"), datetime):
            snap["sampled_at"] = snap["sampled_at"].astimezone(timezone.utc).isoformat()
        doc["telemetry_snapshot"] = snap
    await db.treatment_entries.insert_one(doc)
    # Roll-up counters on the treatment doc
    await db.treatments.update_one(
        {"treatment_id": treatment_id, "team_id": team_id},
        {"$inc": {"entry_count": 1}, "$set": {"last_entry_at": now, "updated_at": now}},
    )
    doc.pop("_id", None)
    return _serialize(doc)


@api_router.patch("/treatments/{treatment_id}/entries/{entry_id}")
async def edit_treatment_entry(treatment_id: str, entry_id: str, body: TreatmentEntryUpdate, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    entry = await db.treatment_entries.find_one({"entry_id": entry_id, "treatment_id": treatment_id, "team_id": team_id}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Entry not found.")
    if entry.get("author") != user["email"] and not _is_admin(user):
        raise HTTPException(403, "Only the author or an admin can edit this entry.")
    now = datetime.now(timezone.utc)
    update: Dict[str, Any] = {"edited_at": now, "edited_by": user["email"]}
    if body.text is not None:
        text = body.text.strip()
        if not text:
            raise HTTPException(400, "Entry text can't be empty.")
        if len(text) > 2000:
            raise HTTPException(400, "Entry too long (max 2000 chars).")
        update["text"] = text
    if body.event_at is not None:
        try:
            s = body.event_at.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(s)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            if parsed > now + timedelta(minutes=5):
                raise HTTPException(400, "Event time can't be in the future.")
            if parsed < now - timedelta(days=30):
                raise HTTPException(400, "Event time can't be older than 30 days.")
            update["event_at"] = parsed
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(400, "Invalid event_at timestamp.")
    if body.kind is not None or body.npt_category is not None or body.npt_minutes is not None:
        # Merge against existing values so partial updates work (e.g. just changing kind back to 'note')
        merged_kind = body.kind if body.kind is not None else entry.get("kind") or "note"
        merged_cat = body.npt_category if body.npt_category is not None else entry.get("npt_category")
        merged_min = body.npt_minutes if body.npt_minutes is not None else entry.get("npt_minutes")
        update.update(_validate_entry_kind(merged_kind, merged_cat, merged_min))
    if body.operation_code is not None:
        if not isinstance(body.operation_code, int) or not (1 <= body.operation_code <= 69):
            raise HTTPException(400, "operation_code must be an integer between 1 and 69.")
        update["operation_code"] = body.operation_code
    await db.treatment_entries.update_one(
        {"entry_id": entry_id, "treatment_id": treatment_id, "team_id": team_id},
        {"$set": update},
    )
    updated = await db.treatment_entries.find_one({"entry_id": entry_id}, {"_id": 0})
    return _serialize(updated)


@api_router.delete("/treatments/{treatment_id}/entries/{entry_id}")
async def delete_treatment_entry(treatment_id: str, entry_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    entry = await db.treatment_entries.find_one({"entry_id": entry_id, "treatment_id": treatment_id, "team_id": team_id}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Entry not found.")
    if entry.get("author") != user["email"] and not _is_admin(user):
        raise HTTPException(403, "Only the author or an admin can delete this entry.")
    await db.treatment_entries.delete_one({"entry_id": entry_id, "treatment_id": treatment_id, "team_id": team_id})
    # Decrement rollup
    await db.treatments.update_one(
        {"treatment_id": treatment_id, "team_id": team_id},
        {"$inc": {"entry_count": -1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
    )
    return {"success": True}


@api_router.get("/treatments/events-timeline")
async def treatments_events_timeline(
    rig_id: Optional[str] = None,
    limit: int = 500,
    user: dict = Depends(require_user),
):
    """
    Returns treatment entries with kind in ('event', 'npt') for the current team
    (optionally filtered to a rig). Used by the Live Ops playback scrubber to
    render Significant-Event and NPT pins alongside manual annotations.
    """
    team_id = user.get("team_id")
    if not team_id:
        return {"events": []}
    q: Dict[str, Any] = {"team_id": team_id, "kind": {"$in": ["event", "npt"]}}
    if rig_id:
        q["rig_id"] = rig_id
    docs = await db.treatment_entries.find(q, {"_id": 0}).sort("event_at", -1).limit(min(limit, 2000)).to_list(min(limit, 2000))
    out = []
    for d in docs:
        ev = _serialize(d)
        # Normalize timestamp_ms for the pin layer (works for both naive and ISO strings)
        ev_at = d.get("event_at") or d.get("created_at")
        ts_ms = None
        if isinstance(ev_at, datetime):
            if ev_at.tzinfo is None:
                ev_at = ev_at.replace(tzinfo=timezone.utc)
            ts_ms = int(ev_at.timestamp() * 1000)
        elif isinstance(ev_at, str):
            try:
                parsed = datetime.fromisoformat(ev_at.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                ts_ms = int(parsed.timestamp() * 1000)
            except Exception:
                pass
        ev["timestamp_ms"] = ts_ms
        out.append(ev)
    return {"events": out}



# ============ FILE / MEDIA STORAGE ============
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
STORAGE_APP_NAME = "ctpocket"
_storage_key: Optional[str] = None

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB
ALLOWED_EXT_MIME = {
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "png":  "image/png",
    "webp": "image/webp",
    "heic": "image/heic",
    "heif": "image/heif",
    "pdf":  "application/pdf",
}
# Which contexts a file can be attached to
ATTACHMENT_CONTEXTS = {"equipment", "chat", "handover", "checklist"}


def init_storage() -> Optional[str]:
    """Called once at startup; also lazily on first upload if startup init failed."""
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_LLM_KEY:
        logger.warning("EMERGENT_LLM_KEY not configured — object storage disabled.")
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json().get("storage_key")
        logger.info("Object storage initialized.")
        return _storage_key
    except Exception as e:
        logger.error("Object storage init failed: %s", e)
        return None


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    backend = os.environ.get("ATTACHMENT_STORAGE_BACKEND", "emergent").strip().lower()
    if backend == "r2":
        from services import r2_storage
        try:
            return r2_storage.put_object(path, data, content_type)
        except r2_storage.StorageConfigurationError as e:
            logger.error("R2 storage configuration error: %s", e)
            raise HTTPException(503, "R2 storage is not configured.")
    if backend != "emergent":
        logger.error("Unsupported attachment storage backend: %s", backend)
        raise HTTPException(503, "Object storage is not configured.")
    key = init_storage()
    if not key:
        raise HTTPException(503, "Object storage unavailable — retry shortly.")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if r.status_code == 439:
        raise HTTPException(507, "Storage quota exceeded on this account.")
    r.raise_for_status()
    return r.json()


def _get_object(path: str, backend: str = "emergent") -> tuple:
    if backend == "r2":
        from services import r2_storage
        from botocore.exceptions import ClientError
        try:
            return r2_storage.get_object(path)
        except r2_storage.StorageConfigurationError as e:
            logger.error("R2 storage configuration error: %s", e)
            raise HTTPException(503, "R2 storage is not configured.")
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "NotFound", "404"):
                raise HTTPException(404, "File not found in storage.")
            raise
    if backend != "emergent":
        logger.error("Unsupported stored object backend: %s", backend)
        raise HTTPException(503, "Object storage is not configured.")
    key = init_storage()
    if not key:
        raise HTTPException(503, "Object storage unavailable.")
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if r.status_code == 404:
        raise HTTPException(404, "File not found in storage.")
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


def _mime_for_ext(ext: str) -> str:
    return ALLOWED_EXT_MIME.get(ext.lower(), "application/octet-stream")


class AttachmentCreate(BaseModel):
    context: str                        # equipment | chat | handover | checklist
    context_ref: Optional[str] = None   # item_id / message_id / rig_id / event_id etc
    rig_id: Optional[str] = None
    caption: Optional[str] = None


@api_router.post("/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    context: str = Form(...),
    context_ref: Optional[str] = Form(None),
    rig_id: Optional[str] = Form(None),
    caption: Optional[str] = Form(None),
    hitl_approval_id: Optional[str] = Form(None),
    user: dict = Depends(require_user),
):
    """Upload a photo/PDF up to 15 MB. Team-scoped; attached to a context (equipment / chat / handover / checklist)."""
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "Join or create a team before uploading.")
    if context not in ATTACHMENT_CONTEXTS:
        raise HTTPException(400, f"context must be one of {sorted(ATTACHMENT_CONTEXTS)}")

    # Validate filename + extension
    raw_name = (file.filename or "upload.bin").strip()
    ext = raw_name.rsplit(".", 1)[-1].lower() if "." in raw_name else "bin"
    if ext not in ALLOWED_EXT_MIME:
        raise HTTPException(400, f"Unsupported file type .{ext}. Allowed: {sorted(ALLOWED_EXT_MIME.keys())}")

    # Read + size cap
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large ({len(data)/1024/1024:.1f} MB). Max 15 MB.")
    if len(data) == 0:
        raise HTTPException(400, "Empty file.")
    mime = _mime_for_ext(ext)
    fingerprint = _hitl_payload_fingerprint({
        "context": context,
        "context_ref": context_ref or "",
        "rig_id": rig_id or "",
        "caption_len": len((caption or "").strip()),
        "filename": raw_name[:200],
        "size": len(data),
        "content_type": mime,
    })
    await _consume_hitl_approval(
        action="attachment_upload",
        approval_id=hitl_approval_id,
        user=user,
        endpoint="/api/attachments",
        payload_fingerprint=fingerprint,
    )

    # Storage path
    file_id = f"att_{uuid.uuid4().hex[:16]}"
    storage_path = f"{STORAGE_APP_NAME}/team/{team_id}/{context}/{file_id}.{ext}"
    try:
        result = _put_object(storage_path, data, mime)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Upload failed: %s", e)
        raise HTTPException(500, "Upload failed — try again.")

    now = datetime.now(timezone.utc)
    doc = {
        "attachment_id": file_id,
        "team_id": team_id,
        "context": context,
        "context_ref": context_ref,
        "rig_id": rig_id,
        "caption": (caption or "").strip()[:300] or None,
        "filename": raw_name[:200],
        "storage_path": result.get("path", storage_path),
        "storage_backend": result.get("storage_backend", "emergent"),
        "content_type": mime,
        "size": result.get("size", len(data)),
        "kind": "image" if mime.startswith("image/") else "pdf",
        "uploader_user_id": user["user_id"],
        "uploader_name": user.get("name") or user["email"].split("@")[0],
        "uploader_email": user["email"],
        "is_deleted": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.attachments.insert_one(doc)
    doc.pop("_id", None)
    out = _serialize(doc)
    out["download_url"] = f"/api/attachments/{file_id}/download"
    return out


@api_router.get("/attachments")
async def list_attachments(
    context: Optional[str] = None,
    context_ref: Optional[str] = None,
    rig_id: Optional[str] = None,
    user: dict = Depends(require_user),
):
    team_id = user.get("team_id")
    if not team_id:
        return {"attachments": [], "team_id": None}
    q: Dict[str, Any] = {"team_id": team_id, "is_deleted": False}
    if context:      q["context"] = context
    if context_ref:  q["context_ref"] = context_ref
    if rig_id:       q["rig_id"] = rig_id
    docs = await db.attachments.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        s = _serialize(d)
        s["download_url"] = f"/api/attachments/{d['attachment_id']}/download"
        out.append(s)
    return {"attachments": out, "team_id": team_id}


@api_router.get("/attachments/{attachment_id}/download")
async def download_attachment(attachment_id: str, auth: Optional[str] = None, user: Optional[dict] = Depends(get_current_user)):
    """
    Serves the file. Auth via cookie (normal flow) OR `?auth=<session_token>` for <img src>.
    """
    if not user and auth:
        session = await db.user_sessions.find_one({"session_token": auth}, {"_id": 0})
        if session and session.get("user_id"):
            user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(401, "Not authenticated.")
    doc = await db.attachments.find_one({"attachment_id": attachment_id, "is_deleted": False}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found.")
    if doc.get("team_id") and doc["team_id"] != user.get("team_id") and not _is_admin(user):
        raise HTTPException(403, "Attachment belongs to another team.")
    try:
        data, ctype = _get_object(doc["storage_path"], doc.get("storage_backend", "emergent"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Download failed: %s", e)
        raise HTTPException(500, "Download failed.")
    return Response(content=data, media_type=doc.get("content_type") or ctype, headers={
        "Content-Disposition": f'inline; filename="{doc.get("filename","file")}"',
        "Cache-Control": "private, max-age=300",
    })


@api_router.delete("/attachments/{attachment_id}")
async def delete_attachment(attachment_id: str, user: dict = Depends(require_user)):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(400, "No team.")
    doc = await db.attachments.find_one({"attachment_id": attachment_id, "team_id": team_id, "is_deleted": False}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found.")
    # Uploader or admin can delete
    if doc["uploader_user_id"] != user["user_id"] and not _is_admin(user):
        raise HTTPException(403, "Only the uploader or an admin can delete this attachment.")
    await db.attachments.update_one(
        {"attachment_id": attachment_id},
        {"$set": {"is_deleted": True, "deleted_at": datetime.now(timezone.utc), "deleted_by": user["email"]}},
    )
    return {"success": True}


# ============ PHASE 1 MODULES (RBAC, Reels, Fatigue, Surveys, Certs, Tasks, Parts, Timecards) ============
from phase1_modules import register_phase1  # noqa: E402


async def _broadcast_liveops(team_id: str, rig_id: Optional[str], sample: dict):
    public_sample = {key: value for key, value in sample.items() if key not in {"team_id", "user_email"}}
    try:
        await liveops_broadcaster.publish(team_id, rig_id, public_sample)
    except Exception:
        logger.exception("Liveops WebSocket broadcast failed for team %s rig %s", team_id, rig_id)


register_phase1(api_router, db, require_user, get_current_user, _is_admin, _broadcast_liveops)


# ============ SECURITY & COMPLIANCE (Enterprise bundle) ============
from middleware.tenant import org_id_of, org_plan, has_entitlement, ensure_tenant_indexes, PLAN_FEATURES  # noqa: E402
from services import audit_chain  # noqa: E402
from services.org_routes import build_router as _build_org_router  # noqa: E402
from security_module import build_router as _build_security_router, scrub_pii as _scrub_pii, audit_log as _audit_log  # noqa: E402


async def _maybe_scrub_for_team(team_id: Optional[str], text: str) -> str:
    """If the team has `ai_privacy_mode` on in `team_security_settings`,
    run the text through the PII scrubber with their custom redaction
    terms before it is sent to any upstream LLM. No-op otherwise so free
    and Small-Med teams don't pay the cost of the regex pass.
    """
    if not team_id or not isinstance(text, str) or not text:
        return text
    settings = await db.team_security_settings.find_one({"team_id": team_id})
    if not settings or not settings.get("ai_privacy_mode"):
        return text
    return _scrub_pii(text, settings.get("extra_redaction_terms") or [])


async def _require_enterprise(user: dict = Depends(require_user)):
    """Gate for `/security/*` writes. Honours BETA_UNLOCK the same way the
    frontend tier guard does so the flag is a single global switch.
    """
    team = await db.teams.find_one({"team_id": user.get("team_id")}, {"_id": 0}) if user.get("team_id") else None
    plan = org_plan(team, user)
    # Global beta flags only apply to admins / invited users, never organic signups.
    if has_entitlement(plan, "security_compliance") and (
        plan in ("enterprise",) or _is_beta_invitee(user) or "security_compliance" in PLAN_FEATURES.get(plan, ())
    ):
        return user
    raise HTTPException(403, "Security & Compliance requires an Enterprise plan.")


_security_router = _build_security_router(
    require_user=require_user,
    require_enterprise=_require_enterprise,
    db=db,
    tls_version="TLS 1.3",
    data_region=os.environ.get("DATA_REGION", "us-east"),
)
api_router.include_router(_security_router)
api_router.include_router(_build_org_router(require_user=require_user, db=db, chain_audit=_chain_audit))

from plugs_module import build_router as _build_plugs_router  # noqa: E402
api_router.include_router(_build_plugs_router(require_user=require_user, db=db))


# ============ APP CONFIG ============
@api_router.get("/health")
async def health():
    try:
        await client.admin.command("ping")
    except Exception:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ok"}


app.include_router(api_router)

_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
if IS_PRODUCTION and (not _cors_origins or "*" in _cors_origins):
    raise RuntimeError("CORS_ORIGINS must list explicit origins when APP_ENV=production")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o for o in _cors_origins if o != "*"],
    # Non-production default keeps previous permissive behaviour for local/preview use.
    allow_origin_regex=None if IS_PRODUCTION else ".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


@app.on_event("startup")
async def _ensure_indexes():
    try:
        await audit_chain.ensure_indexes(db)
        await ensure_tenant_indexes(db)
    except Exception as e:
        logger.warning("Tenant index creation deferred: %s", e)
    await db.reel_fatigue.create_index([("team_id", 1), ("reel_id", 1)], unique=True)
    try:
        await db.team_items.create_index([("team_id", 1), ("kind", 1), ("created_at", -1)])
        await db.team_items.create_index([("team_id", 1), ("kind", 1), ("rig_id", 1), ("created_at", -1)])
    except Exception as e:
        logger.warning("Index creation deferred: %s", e)


@app.on_event("startup")
async def _init_storage_on_boot():
    try:
        if os.environ.get("ATTACHMENT_STORAGE_BACKEND", "emergent").strip().lower() == "emergent":
            init_storage()
    except Exception as e:
        logger.warning("Storage boot init deferred: %s", e)


# -----------------------------------------------------------------
# DAQ listener orchestrator — reconciles enabled daq_configs and spawns
# one asyncio task per listener. See daq_listeners.py for the protocol
# implementations. Pass-through sample storage uses the same liveops_samples
# collection as the manual /liveops/feed endpoint, so dashboards & share links
# render real rig data identically to the simulator.
# -----------------------------------------------------------------
_daq_orchestrator = None


async def _store_daq_sample(team_id: str, rig_id: str | None, sample: dict):
    """Called by the DAQ orchestrator every time a listener produces a sample."""
    try:
        doc = {
            **{k: v for k, v in sample.items() if k != "ts"},
            "team_id": team_id,
            "rig_id": rig_id,
            "created_at": datetime.now(timezone.utc),
            "user_email": "daq@rig.local",
        }
        await db.liveops_samples.insert_one(doc)
        await _broadcast_liveops(team_id, rig_id, doc)
    except Exception:
        logger.exception("DAQ sample store or broadcast failed for team %s rig %s", team_id, rig_id)


@app.on_event("startup")
async def _start_daq_orchestrator():
    global _daq_orchestrator
    try:
        from daq_listeners import DaqOrchestrator
        _daq_orchestrator = DaqOrchestrator(db, _store_daq_sample)
        await _daq_orchestrator.start()
    except Exception as e:
        logger.warning("DAQ orchestrator did not start: %s", e)


@app.on_event("shutdown")
async def _stop_daq_orchestrator():
    if _daq_orchestrator:
        try:
            await _daq_orchestrator.stop()
        except Exception:
            logger.debug("DAQ orchestrator shutdown error (non-fatal)", exc_info=True)


# -----------------------------------------------------------------
# Cloud MQTT consumer (rig telemetry -> MongoDB). Opt-in via MQTT_ENABLED=true.
# org_id is the tenant key; existing team_id tenancy maps 1:1 onto it for live fan-out.
# -----------------------------------------------------------------
_mqtt_service = None


async def _mqtt_live_sink(org_id: str, rig_id: str, table: str, docs: list):
    for doc in docs:
        await liveops_broadcaster.publish(org_id, rig_id, liveops_sample(table, doc))


@app.on_event("startup")
async def _start_mqtt_consumer():
    global _mqtt_service
    from services.mqtt_consumer import MqttConsumerService, MqttSettings, TelemetryIngestor
    settings = MqttSettings.from_env()
    if not settings.enabled:
        return
    try:
        _mqtt_service = MqttConsumerService(TelemetryIngestor(db, live_sink=_mqtt_live_sink), settings)
        await _mqtt_service.start()
    except Exception:
        logger.exception("MQTT consumer did not start")
        _mqtt_service = None


@app.on_event("shutdown")
async def _stop_mqtt_consumer():
    if _mqtt_service:
        await _mqtt_service.stop()
