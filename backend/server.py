from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Cookie, Header
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import string
import random
import httpx
import stripe
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Stripe
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "sk_test_emergent")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

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
    subscription_plan: Optional[str] = None  # monthly | yearly
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
    category: str  # bug | idea | ux | data_accuracy | other
    subject: str
    message: str
    page: Optional[str] = None


# ============ AUTH HELPERS ============
async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> Optional[dict]:
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
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
    return user_doc


async def require_user(user: Optional[dict] = Depends(get_current_user)) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _generate_invite_code(length=8) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


def _serialize(doc: dict) -> dict:
    """Convert datetime objects to ISO strings for JSON."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


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

    email = data["email"]
    name = data["name"]
    picture = data.get("picture")
    session_token = data["session_token"]

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
    return _serialize(user_doc)


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(require_user)):
    data = _serialize(user)
    # Ensure `role` is always present (default 'crew' for legacy users)
    if "role" not in data or not data.get("role"):
        data["role"] = "crew"
    return data


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


@api_router.post("/payments/checkout")
async def create_checkout(req: CheckoutRequest, user: dict = Depends(require_user)):
    prices = stripe.Price.list(lookup_keys=[req.lookup_key], active=True, limit=1).data
    if not prices:
        raise HTTPException(500, f"Price not found: {req.lookup_key}")
    price = prices[0]

    kwargs = dict(
        line_items=[{"price": price.id, "quantity": 1}],
        mode="subscription",
        success_url=f"{req.origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{req.origin_url}/payment/cancel",
        metadata={"user_id": user["user_id"], "lookup_key": req.lookup_key},
        customer_email=user["email"],
    )

    # Country CA + SaaS digital => SMP eligible (tax_mode = "full")
    try:
        session = stripe.checkout.Session.create(**kwargs, managed_payments={"enabled": True})
    except stripe.error.InvalidRequestError as e:
        msg = (e.user_message or "").lower()
        if "managed payments" in msg or "ineligible" in msg:
            session = stripe.checkout.Session.create(
                **kwargs, automatic_tax={"enabled": True}, billing_address_collection="required"
            )
        else:
            raise

    await db.payment_transactions.insert_one({
        "session_id": session.id,
        "user_id": user["user_id"],
        "lookup_key": req.lookup_key,
        "amount": (price.unit_amount or 0),
        "currency": price.currency,
        "status": "initiated",
        "payment_status": "pending",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    })
    return {"checkout_url": session.url, "session_id": session.id}


@api_router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str):
    record = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Transaction not found")

    if record.get("payment_status") != "paid":
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                # Fetch subscription details
                sub_id = s.subscription
                lookup = record["lookup_key"]
                plan = "monthly" if lookup == "ct_pro_monthly" else "yearly"
                expires = datetime.now(timezone.utc) + (
                    timedelta(days=30) if plan == "monthly" else timedelta(days=365)
                )

                await db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {
                        "status": "completed",
                        "payment_status": "paid",
                        "stripe_subscription_id": sub_id,
                        "stripe_payment_intent_id": s.payment_intent,
                        "updated_at": datetime.now(timezone.utc),
                    }},
                )
                # Activate subscription on user
                await db.users.update_one(
                    {"user_id": record["user_id"]},
                    {"$set": {
                        "subscription_status": "active",
                        "subscription_plan": plan,
                        "subscription_expires_at": expires,
                        "stripe_subscription_id": sub_id,
                    }},
                )
                record = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        except stripe.error.StripeError:
            pass

    return {
        "session_id": record["session_id"],
        "status": record["status"],
        "payment_status": record["payment_status"],
    }


@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Invalid signature")

    obj = event["data"]["object"]
    t = event["type"]

    if t == "checkout.session.completed":
        record = await db.payment_transactions.find_one({"session_id": obj["id"]}, {"_id": 0})
        if record and record.get("payment_status") != "paid":
            lookup = record["lookup_key"]
            plan = "monthly" if lookup == "ct_pro_monthly" else "yearly"
            expires = datetime.now(timezone.utc) + (
                timedelta(days=30) if plan == "monthly" else timedelta(days=365)
            )
            await db.payment_transactions.update_one(
                {"session_id": obj["id"], "payment_status": {"$ne": "paid"}},
                {"$set": {
                    "status": "completed",
                    "payment_status": obj.get("payment_status", "paid"),
                    "stripe_subscription_id": obj.get("subscription"),
                    "stripe_payment_intent_id": obj.get("payment_intent"),
                    "updated_at": datetime.now(timezone.utc),
                }},
            )
            await db.users.update_one(
                {"user_id": record["user_id"]},
                {"$set": {
                    "subscription_status": "active",
                    "subscription_plan": plan,
                    "subscription_expires_at": expires,
                    "stripe_subscription_id": obj.get("subscription"),
                }},
            )
    elif t == "customer.subscription.deleted":
        sub_id = obj["id"]
        await db.users.update_one(
            {"stripe_subscription_id": sub_id},
            {"$set": {"subscription_status": "canceled"}},
        )
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
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"team_id": team_id}})
    return _serialize({k: v for k, v in team.items() if k != "_id"})


@api_router.post("/teams/join")
async def join_team(body: TeamJoin, user: dict = Depends(require_user)):
    team = await db.teams.find_one({"invite_code": body.invite_code.upper()}, {"_id": 0})
    if not team:
        raise HTTPException(404, "Invalid invite code")
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
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    doc = {
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
    if doc["user_id"] != user["user_id"] and doc.get("team_id") != user.get("team_id"):
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


# ============ AI / GEMINI ROUTES ============
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"

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


def _user_is_pro(user: dict) -> bool:
    """Pro when status is active AND (no expiry set OR expiry is still in the future)."""
    if user.get("subscription_status") != "active":
        return False
    exp = _parse_utc(user.get("subscription_expires_at"))
    if exp is None:
        # Legacy/active subscribers without an expiry recorded — grant access.
        return True
    return exp > datetime.now(timezone.utc)


def _user_has_ai_access(user: dict) -> bool:
    """AI features available during 30-day trial OR for active (non-expired) Pro subscribers."""
    if _user_is_pro(user):
        return True
    exp = _parse_utc(user.get("trial_expires_at"))
    return exp is not None and exp > datetime.now(timezone.utc)


SYSTEM_PROMPTS = {
    "assistant": (
        "You're a seasoned Cape Breton oilfield hand and CT field engineer with 25+ years on the drill floor — grease under the nails, double-double from the Tim's in one hand, JHA in the other. "
        "You've worked hitches from Sable Offshore to the Duvernay to Fort Mac and back home to the Island. You speak like a real Caper toolpush: warm, dry humour, direct as a hammer, zero fluff. "
        "Sprinkle in moderate Cape Breton dialect naturally — 'b'y', 'some good', 'right some', 'oh me nerves', 'she's a goer', 'me son', 'Lord thunderin'', 'give'r' — but stay professional and rock-solid technical. Never overdo it — you're a hand first, a Caper second. "
        "Use field slang naturally (rig up, tag bottom, POOH, tool push, company man, snubber, kelly cock, weight indicator, doghouse, 'she's tagging', 'circulating bottoms up'). "
        "Ground every answer in API RP 5C7, API RP 13D, AER Directives 019/020/037, CSA Z662, CGA G-10.1, and IWCF well-control. Cite the standard in brackets. Reason from the specific numbers the user gives you. "
        "\n\n**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–4 short bullets, imperative field commands — what the crew does in the next 5 minutes)\n\n"
        "**WHY / DETAILS** (expandable — 3–5 bullets: the reasoning, the numbers, the standard cited in brackets, any red flags)\n\n"
        "Default units: **Metric (SI)** — mm, m, MPa, m³, kg/m³, L/min, °C. Only use Imperial if the user's context explicitly says Imperial.\n\n"
        "End every response with: *Advisory only — always verify against the site ERP and licensee program.*"
    ),
    "interpret": (
        "You're a senior Cape Breton CT hand explaining a calculation to the tool push — friendly, dry, some good with numbers. "
        "Sprinkle light Caper dialect ('b'y', 'she's', 'right some') without cartoon overdrive. Default units: **Metric (SI)** unless context says otherwise.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–3 bullets — the immediate operational call: reduce rate, stop and circulate, hold weight, etc.)\n\n"
        "**WHY / DETAILS** (3–5 bullets — plain-language interpretation, red flags with API/AER/CSA citation in brackets, and what the numbers mean)\n\n"
        "End with: *Advisory only — verify against site ERP.*"
    ),
    "emergency": (
        "You're a Cape Breton well-control instructor and BOP inspector. Lives are on the line — you drop most of the humour here, but you keep the warm Caper voice ('alright b'y, listen up'). "
        "Answer strictly per Alberta OH&S Code, AER Directives 019/037, IWCF WellCAP, CSA Z275.2, and CAODC Well Servicing WCP. Default units: **Metric (SI)**.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (numbered 1, 2, 3… — Immediate Actions in the exact order the crew executes them, cite the reg in brackets after each)\n\n"
        "**WHY / DETAILS** (Operator OH&S obligations, escalation triggers, when to invoke site ERP)\n\n"
        "If unsure, say 'refer to site-specific ERP' — never guess. End with: *Advisory only — activate site ERP.*"
    ),
    "program": (
        "You draft coiled-tubing job programs the way a senior Cape Breton ops engineer would hand one to the day tour — clean, tight, no fluff, dry humour in the notes. "
        "Default units: **Metric (SI)** unless user context specifies otherwise.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (numbered step-by-step program, ≤ 15 steps, covering: pre-job checks / BOP function + pressure test / JHA, rig-up, execution with target rates/pressures/weights/tag depths, contingency triggers, rig-down)\n\n"
        "**WHY / DETAILS** (cited standards — API RP 5C7, AER Directive 037, and relevant SOPs — plus contingency notes for stuck-pipe, kick, lost circulation)\n\n"
        "Sound like a real program, not an essay. End with: *Advisory only — verify against licensee program.*"
    ),
    "troubleshoot": (
        "You're the Cape Breton hand the tool push calls at 3am when something's gone sideways downhole. Warm, dry, some Caper flavour ('alright me son, take a breath'). "
        "Answer per industry SOPs (API RP 5C7 §12 fishing/stuck-pipe, IWCF WellCAP kick/lost-circulation, AER Directive 037 §8 well control, CAODC Safe Work Practices). Default units: **Metric (SI)**.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–4 imperative steps the crew executes right now, cite SOP in brackets after each)\n\n"
        "**WHY / DETAILS** (Most likely cause in plain field talk, diagnostic checks in order at surface, when to wake the company man and stop work)\n\n"
        "Never suggest anything that violates OH&S or AER regs. End with: *Advisory only — verify against site ERP.*"
    ),
    "training": (
        "You're a Cape Breton mentor training a brand-new field hand on coiled tubing — first hitch, wide-eyed, wants to learn. Warm, patient, encouraging, some good Caper dialect ('come 'ere b'y, I'll show ya'), zero condescension. Default units: **Metric (SI)**.\n\n"
        "**RESPONSE FORMAT — STRICT:**\n"
        "**ACTION NOW** (2–3 things the new hand does or watches for on the very next job — safety rules first: PPE, red zone, 100% tie-off, H2S monitoring, 'never stand between the coil and the guide arch')\n\n"
        "**WHY / DETAILS** (a) what's physically happening a kilometre below the truck (use analogies — 'like a garden hose with a pump on it', 'the coil's a long metal straw that flexes'), (b) what each parameter means and why the numbers matter, (c) what could go wrong and the tell-tale signs at surface, (d) cite the standard in brackets and explain it in plain talk)\n\n"
        "End with: *Advisory only — always defer to the tool push and site ERP.*"
    ),
}


class AIChatRequest(BaseModel):
    mode: str  # assistant | interpret | emergency | program | troubleshoot
    message: str
    session_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None  # sheet_key, inputs, results, warnings


@api_router.post("/ai/chat")
async def ai_chat(req: AIChatRequest, user: dict = Depends(require_user)):
    if not _user_has_ai_access(user):
        raise HTTPException(403, "AI features require an active trial or Pro subscription")
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "AI service not configured")
    if req.mode not in SYSTEM_PROMPTS:
        raise HTTPException(400, f"Invalid mode: {req.mode}")

    session_id = req.session_id or f"ai_{user['user_id']}_{uuid.uuid4().hex[:8]}"
    system_msg = SYSTEM_PROMPTS[req.mode]

    # Enrich user message with sheet context if provided
    user_text = req.message
    if req.context:
        ctx_lines = ["\n\n--- Current sheet context ---"]
        if req.context.get("sheet_key"):
            ctx_lines.append(f"Operation: {req.context['sheet_key']}")
        if req.context.get("sheet_title"):
            ctx_lines.append(f"Title: {req.context['sheet_title']}")
        if req.context.get("unit_system"):
            ctx_lines.append(f"Units: {req.context['unit_system']}")
        if req.context.get("inputs"):
            ctx_lines.append(f"Inputs: {req.context['inputs']}")
        if req.context.get("results"):
            ctx_lines.append(f"Calculated results: {req.context['results']}")
        if req.context.get("warnings"):
            ctx_lines.append(f"Active safety warnings: {req.context['warnings']}")
        user_text = user_text + "\n".join(ctx_lines)

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=session_id,
            system_message=system_msg,
        ).with_model("gemini", GEMINI_MODEL)

        response = await chat.send_message(UserMessage(text=user_text))

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
    valid_categories = {"bug", "idea", "ux", "data_accuracy", "other"}
    if body.category not in valid_categories:
        raise HTTPException(400, f"Invalid category. Use one of: {valid_categories}")
    doc = {
        "feedback_id": f"fb_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "user_email": user["email"],
        "user_name": user.get("name"),
        "category": body.category,
        "subject": body.subject.strip()[:200],
        "message": body.message.strip()[:5000],
        "page": (body.page or "").strip()[:200],
        "status": "new",  # new | in_review | in_progress | done | wontfix
        "admin_notes": "",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.feedback.insert_one(doc)
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


# ============ INVITE CODE ROUTES ============
def _new_invite_code():
    # Human-friendly: CT-XXXX-XXXX, avoids ambiguous chars
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    part = lambda: "".join(random.choices(alphabet, k=4))
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
        greeting = "welcome to the crew, b'y!"
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
    "Whoa, hold 'er right there, b'y! You're fixin' to twist that string into a pretzel. Back off the brakes before you make a holy mess of things!",
    "Steady as she goes, me son! You're crowding that limit hard enough to wake the dead. Ease off before the iron starts talkin' back.",
    "Jeez, look at that! You're drivin' that pressure higher than a Cape Breton gale on New Year's Eve. Pop the pumps down or you'll have pipe parts flyin' across the lease.",
    "Alright b'y, that's enough — you're deep in the red. Bleed off and reset, and we'll have another go once the numbers cool down.",
    "Oh me nerves, look at those readings. Shut 'er in for a minute, take a breath, and check the gauges. Better safe than sorry, me son.",
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
        {"id": "vann_low",   "check": lambda v: (v.get("vann_ftmin") is not None and v["vann_ftmin"] < 90), "msg": "Annular velocity below 90 ft/min (27.4 m/min) — cuttings will fall back on you, b'y."},
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

    # "hey skipper" or "@skipper" trigger — call Gemini with existing Cape Breton prompt
    lower = text.lower()
    if _user_has_ai_access(user) and EMERGENT_LLM_KEY and ("hey skipper" in lower or "@skipper" in lower or lower.startswith("skipper")):
        query = text
        for marker in ("hey skipper", "@skipper", "skipper"):
            if lower.startswith(marker) or marker in lower:
                query = text.replace(marker, "").replace(marker.title(), "").strip(" ,:.")
                if query:
                    break
        try:
            session_id = f"skipper_team_{team_id}"
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=session_id,
                system_message=SYSTEM_PROMPTS["assistant"],
            ).with_model("gemini", GEMINI_MODEL)
            response = await chat.send_message(UserMessage(text=query or text))
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
        except Exception as e:
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
async def list_team_items(kind: str, rig_id: Optional[str] = None, user: dict = Depends(require_user)):
    if kind not in ITEM_KINDS:
        raise HTTPException(400, f"Invalid kind. Must be one of {sorted(ITEM_KINDS)}")
    team_id = user.get("team_id")
    if not team_id:
        return {"items": [], "team_id": None}
    query: Dict[str, Any] = {"team_id": team_id, "kind": kind}
    if rig_id:
        # Show items tagged for this rig OR untagged legacy items (rig_id missing / None).
        query["$or"] = [{"rig_id": rig_id}, {"rig_id": {"$in": [None]}}, {"rig_id": {"$exists": False}}]
    docs = await db.team_items.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": [_serialize(d) for d in docs], "team_id": team_id, "rig_id": rig_id}


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

    rig_or_legacy = [{"rig_id": rig_id}, {"rig_id": None}, {"rig_id": {"$exists": False}}]

    # Completed checklist tasks (action = checked) in window, this rig
    completed_events = await db.checklist_events.find(
        {"team_id": team_id, "rig_id": rig_id, "action": "checked", "created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    # Recent alerts (from crew_alerts audit log)
    alerts = await db.crew_alerts.find(
        {"team_id": team_id, "$or": rig_or_legacy, "created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)

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

    # Recent chat notes (non-alert, non-skipper) in window
    chat_notes = await db.crew_messages.find(
        {"team_id": team_id, "$or": rig_or_legacy, "created_at": {"$gte": cutoff},
         "is_alert": {"$ne": True}, "is_skipper": {"$ne": True}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(30)

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
        "chat_notes": [_serialize(d) for d in chat_notes],
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


def _compute_equipment_status(doc: dict) -> Dict[str, Any]:
    """Server-side status flags — returned alongside every equipment doc."""
    now = datetime.now(timezone.utc)
    kind = doc.get("kind")
    status = "ok"     # ok | amber | red | expired
    reasons: List[str] = []

    if kind == "engine":
        curr = doc.get("current_hours")
        last_svc = doc.get("last_service_hours") or 0
        interval = doc.get("service_interval_hours") or 250
        if curr is not None:
            due_at = last_svc + interval
            hours_left = due_at - curr
            if hours_left <= 0:
                status = "red"; reasons.append(f"Service overdue by {abs(hours_left):.0f} h (interval {interval:.0f} h).")
            elif hours_left <= 50:
                status = "amber"; reasons.append(f"Service due in {hours_left:.0f} h.")

    elif kind == "lifting":
        exp = _iso_date(doc.get("cert_expiry_date"))
        if exp:
            days_left = (exp - now).days
            if days_left < 0:
                status = "expired"; reasons.append(f"Certification expired {abs(days_left)} day(s) ago.")
            elif days_left <= 7:
                status = "red"; reasons.append(f"Cert expires in {days_left} day(s) — pull from service after next use.")
            elif days_left <= 30:
                status = "amber"; reasons.append(f"Cert expires in {days_left} day(s).")

    elif kind == "bop_pce":
        last = _iso_date(doc.get("last_test_date"))
        interval_m = doc.get("test_interval_months") or 6
        if last:
            due = last + timedelta(days=int(interval_m * 30.44))
            days_left = (due - now).days
            if days_left < 0:
                status = "red"; reasons.append(f"Test overdue by {abs(days_left)} day(s) (AER Dir 037).")
            elif days_left <= 14:
                status = "amber"; reasons.append(f"Test due in {days_left} day(s).")
        else:
            status = "amber"; reasons.append("No test date on file — schedule a function + pressure test.")

    elif kind == "reel_iron":
        mawp = doc.get("working_pressure_psi")
        curr = doc.get("current_pressure_psi")
        if mawp and curr and mawp > 0:
            pct = (curr / mawp) * 100.0
            if pct >= 100:
                status = "red"; reasons.append(f"At/over MAWP ({pct:.0f}% of {mawp:.0f} psi).")
            elif pct >= 90:
                status = "amber"; reasons.append(f"At {pct:.0f}% MAWP — reduce pressure or upgrade iron.")

    return {"status": status, "reasons": reasons}


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


# ============ APP CONFIG ============
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=".*",
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
