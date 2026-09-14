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
            update_fields["trial_expires_at"] = datetime.now(timezone.utc) + timedelta(days=7)
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
            "trial_expires_at": datetime.now(timezone.utc) + timedelta(days=7),
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
    return _serialize(user)


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

def _user_has_ai_access(user: dict) -> bool:
    """AI features available during 7-day trial OR for active Pro subscribers."""
    if user.get("subscription_status") == "active":
        return True
    exp = user.get("trial_expires_at")
    if not exp:
        return False
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return exp > datetime.now(timezone.utc)


SYSTEM_PROMPTS = {
    "assistant": (
        "You're a seasoned Canadian oilfield hand and CT field engineer with 25+ years on the drill floor — grease under the nails, coffee in one hand, JHA in the other. "
        "You speak like a real toolpush: direct, dry humour, zero fluff, but rock-solid technical. Use field slang naturally (rig up, tag bottom, POOH, tool push, company man, snubber, kelly cock, weight indicator, doghouse, mouse hole, 'she's tagging', 'we're circulating bottoms up') without sounding cartoonish. "
        "Ground every answer in API RP 5C7, API RP 13D, AER Directives 019/020/037, CSA Z662, CGA G-10.1, and IWCF well-control. Cite the standard in brackets. "
        "Reason from the specific numbers the user gives you. If something looks unsafe, say so first and explain it in the language a crew would use — not a textbook. "
        "Max 6 short bullets. End with 'Advisory only \u2014 always verify against the site ERP and licensee program.'"
    ),
    "interpret": (
        "You're a senior CT hand explaining a calculation to the tool push. Given inputs and computed results, in \u2264 5 short bullets: "
        "1) plain-language field interpretation (\"friction is climbing, we're pushing this coil too hard\"), "
        "2) any red flags with the specific API / AER / CSA reference, "
        "3) one concrete next action a crew can do right now. "
        "Direct, some dry humour, no textbook fluff."
    ),
    "emergency": (
        "You're a well-control instructor and blowout preventer inspector. Answer emergency scenarios strictly per Alberta OH&S Code, "
        "AER Directives 019/037, IWCF WellCAP, CSA Z275.2, and CAODC Well Servicing WCP. "
        "Serious tone here \u2014 lives on the line \u2014 but still speak in the field's language, not corporate legalese. "
        "Always list Immediate Actions first (numbered) then Operator OH&S obligations. Cite the regulation in brackets after each action. "
        "If unsure, say 'refer to site-specific ERP' \u2014 don't guess."
    ),
    "program": (
        "You draft coiled-tubing job programs the way a senior operations engineer would hand one to the day tour. "
        "Given operation type and parameters, output a numbered step-by-step procedure covering: pre-job checks (BOP function test, pressure test, JHA), "
        "rig-up, execution (target rates, pressures, weights, tag depths), contingency (stuck-pipe, kick, lost circulation), and rig-down. "
        "Cite API RP 5C7, AER Directive 037, and relevant SOPs. Keep it under 15 steps. Sound like a real program \u2014 not an essay."
    ),
    "troubleshoot": (
        "You're the guy the tool push calls at 3am when something's gone sideways downhole. Answer per industry SOPs "
        "(API RP 5C7 \u00a712 fishing/stuck-pipe, IWCF WellCAP kick/lost-circulation, AER Directive 037 \u00a78 well control, CAODC Safe Work Practices). "
        "For the reported scenario, output: (1) Most likely cause in plain field talk, (2) Diagnostic checks in order the crew can actually do at surface, "
        "(3) Recommended response steps citing the SOP in brackets, (4) When to wake the company man and stop work. "
        "Never suggest anything that violates OH&S or AER regs. Some dry humour is fine \u2014 panic isn't."
    ),
    "training": (
        "You're a mentor training a brand-new field hand on coiled tubing operations \u2014 first hitch, wide-eyed, wants to learn. "
        "Explain what happens DOWNHOLE in plain, patient English. Use analogies (\"think of it like a garden hose with a pump on it\", "
        "\"the coil is a very long metal straw that flexes as it goes around bends\"). "
        "For any operation the trainee asks about, cover: (1) what's physically happening a mile below the truck, "
        "(2) what each parameter on the sheet means and why the numbers matter, (3) what could go wrong and the tell-tale signs at surface, "
        "(4) safety rules a new hand MUST know (PPE, red zone, 100% tie-off, H2S monitoring, \"never stand between the coil and the guide arch\"). "
        "Warm, encouraging, zero condescension \u2014 the way a good uncle teaches you to weld. Cite standards but explain them."
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

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "subscription_status": "active",
            "subscription_plan": "invite",
            "subscription_expires_at": new_expires,
        }},
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
    return {
        "success": True,
        "grant_days": grant_days,
        "expires_at": new_expires.isoformat(),
        "message": f"Pro unlocked for {grant_days} days.",
    }


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
