"""4-tier approvals workflow, hash-chained audit verification, and role test accounts."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from middleware.tenant import org_id_of
from services import audit_chain
from services.rbac import RANK, require_role, role_tier
from services.seed_roles import ROLE_ACCOUNTS, seed_role_accounts

KINDS = ("parts_request", "consumable", "inventory_update")
OPEN_STATUSES = ("pending_supervisor", "pending_po", "pending_management")


def beta_test_mode() -> bool:
    return os.environ.get("BETA_TEST_MODE", "").strip().lower() in {"1", "true", "yes", "on"}


class RequestCreate(BaseModel):
    kind: str
    title: str
    details: Optional[str] = None
    quantity: Optional[float] = None
    rig_id: Optional[str] = None


class SupervisorDecision(BaseModel):
    decision: str  # approve | reject
    escalate_to: Optional[str] = "pending_po"  # pending_po | pending_management
    reason: Optional[str] = None


class ManagementDecision(BaseModel):
    decision: str  # approve | reject
    po_number: Optional[str] = None
    reason: Optional[str] = None


class DocDecision(BaseModel):
    reason: Optional[str] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    assignee_user_id: Optional[str] = None
    rig_id: Optional[str] = None


class TaskAssign(BaseModel):
    assignee_user_id: str


class TestRoleView(BaseModel):
    role: str


def _now():
    return datetime.now(timezone.utc).isoformat()


def build_approvals_router(*, require_user, db, chain_audit) -> APIRouter:
    r = APIRouter()
    at_least = lambda role: require_role(role, require_user)  # noqa: E731

    async def _get(coll, key, value, org):
        doc = await coll.find_one({key: value, "org_id": org}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Not found")
        return doc

    async def _transition(coll, key, doc, user, new_status, action, decision=None, extra=None, meta=None):
        now = _now()
        history = list(doc.get("history", [])) + [{
            "from": doc["status"], "to": new_status, "by": user.get("user_id"),
            "by_role": role_tier(user), "at": now,
        }]
        upd = {"status": new_status, "updated_at": now, "history": history, **(extra or {})}
        await coll.update_one({key: doc[key], "org_id": doc["org_id"]}, {"$set": upd})
        await chain_audit(user, action, target=doc[key], decision=decision,
                          meta={"from": doc["status"], "to": new_status, "by_role": role_tier(user), **(meta or {})})
        return {**doc, **upd}

    # ---------- requests ----------
    @r.post("/approvals/requests")
    async def create_request(body: RequestCreate, user: dict = Depends(at_least("operator"))):
        if body.kind not in KINDS:
            raise HTTPException(400, f"kind must be one of {list(KINDS)}")
        if not (body.title or "").strip():
            raise HTTPException(400, "title required")
        org = org_id_of(user)
        now = _now()
        doc = {
            "request_id": f"req_{uuid.uuid4().hex[:12]}", "org_id": org, "kind": body.kind,
            "title": body.title.strip()[:300], "details": (body.details or "")[:2000] or None,
            "quantity": body.quantity, "rig_id": body.rig_id, "status": "pending_supervisor",
            "created_by_user_id": user.get("user_id"), "created_by_email": user.get("email"),
            "created_at": now, "updated_at": now, "history": [],
        }
        await db.approval_requests.insert_one(dict(doc))
        await chain_audit(user, "approval.request.create", target=doc["request_id"], rig_id=body.rig_id,
                          meta={"kind": body.kind, "to": "pending_supervisor", "by_role": role_tier(user)})
        return doc

    @r.get("/approvals/requests")
    async def list_requests(user: dict = Depends(at_least("operator"))):
        org = org_id_of(user)
        tier = role_tier(user)
        if tier == "management":
            q = {"org_id": org}
        elif tier == "supervisor":
            q = {"org_id": org, "$or": [{"status": "pending_supervisor"},
                                        {"created_by_user_id": user.get("user_id")}]}
        else:
            q = {"org_id": org, "created_by_user_id": user.get("user_id")}
        items = await db.approval_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"items": items}

    @r.post("/approvals/requests/{request_id}/supervisor-decision")
    async def supervisor_decision(request_id: str, body: SupervisorDecision,
                                  user: dict = Depends(at_least("supervisor"))):
        doc = await _get(db.approval_requests, "request_id", request_id, org_id_of(user))
        if doc["status"] != "pending_supervisor":
            raise HTTPException(409, f"Request is {doc['status']}, not pending_supervisor")
        if body.decision == "approve":
            target = body.escalate_to or "pending_po"
            if target not in ("pending_po", "pending_management"):
                raise HTTPException(400, "escalate_to must be pending_po or pending_management")
            new, action = target, "approval.request.supervisor_approve"
        elif body.decision == "reject":
            new, action = "rejected", "approval.request.supervisor_reject"
        else:
            raise HTTPException(400, "decision must be approve or reject")
        return await _transition(db.approval_requests, "request_id", doc, user, new, action,
                                 decision=body.decision, extra={"supervisor_reason": body.reason,
                                                                "supervisor_user_id": user.get("user_id")},
                                 meta={"reason": body.reason})

    @r.post("/approvals/requests/{request_id}/management-decision")
    async def management_decision(request_id: str, body: ManagementDecision,
                                  user: dict = Depends(at_least("management"))):
        doc = await _get(db.approval_requests, "request_id", request_id, org_id_of(user))
        if doc["status"] not in ("pending_po", "pending_management"):
            raise HTTPException(409, f"Request is {doc['status']}, not awaiting management")
        if body.decision == "approve":
            new, action = "approved", "approval.request.management_approve"
        elif body.decision == "reject":
            new, action = "rejected", "approval.request.management_reject"
        else:
            raise HTTPException(400, "decision must be approve or reject")
        return await _transition(db.approval_requests, "request_id", doc, user, new, action,
                                 decision=body.decision,
                                 extra={"po_number": body.po_number, "management_reason": body.reason,
                                        "management_user_id": user.get("user_id")},
                                 meta={"po_number": body.po_number, "reason": body.reason})

    # ---------- company document approvals ----------
    async def _doc_state(doc_id, org):
        return await _get(db.document_approvals, "doc_id", doc_id, org)

    @r.post("/approvals/documents/{doc_id}/submit")
    async def doc_submit(doc_id: str, user: dict = Depends(at_least("lead_op"))):
        org = org_id_of(user)
        doc = await db.document_approvals.find_one({"doc_id": doc_id, "org_id": org}, {"_id": 0})
        if not doc:
            doc = {"doc_id": doc_id, "org_id": org, "status": "draft", "history": [],
                   "submitted_by": user.get("user_id"), "created_at": _now()}
            await db.document_approvals.insert_one(dict(doc))
        if doc["status"] not in ("draft", "rejected"):
            raise HTTPException(409, f"Document is {doc['status']}")
        return await _transition(db.document_approvals, "doc_id", doc, user, "pending_supervisor",
                                 "approval.document.submit", extra={"submitted_by": user.get("user_id")})

    @r.post("/approvals/documents/{doc_id}/approve")
    async def doc_supervisor_approve(doc_id: str, user: dict = Depends(at_least("supervisor"))):
        doc = await _doc_state(doc_id, org_id_of(user))
        if doc["status"] != "pending_supervisor":
            raise HTTPException(409, f"Document is {doc['status']}")
        return await _transition(db.document_approvals, "doc_id", doc, user, "pending_management",
                                 "approval.document.supervisor_approve", decision="approve")

    @r.post("/approvals/documents/{doc_id}/final-approve")
    async def doc_final_approve(doc_id: str, user: dict = Depends(at_least("management"))):
        doc = await _doc_state(doc_id, org_id_of(user))
        if doc["status"] != "pending_management":
            raise HTTPException(409, f"Document is {doc['status']}")
        return await _transition(db.document_approvals, "doc_id", doc, user, "approved",
                                 "approval.document.final_approve", decision="approve")

    @r.post("/approvals/documents/{doc_id}/reject")
    async def doc_reject(doc_id: str, body: DocDecision, user: dict = Depends(at_least("supervisor"))):
        doc = await _doc_state(doc_id, org_id_of(user))
        allowed = ["pending_supervisor", "pending_management"] if role_tier(user) == "management" \
            else ["pending_supervisor"]
        if doc["status"] not in allowed:
            raise HTTPException(409, f"Document is {doc['status']}")
        return await _transition(db.document_approvals, "doc_id", doc, user, "rejected",
                                 "approval.document.reject", decision="reject", meta={"reason": body.reason})

    @r.get("/approvals/documents/{doc_id}")
    async def doc_get(doc_id: str, user: dict = Depends(at_least("operator"))):
        return await _doc_state(doc_id, org_id_of(user))

    # ---------- task gating ----------
    @r.post("/approvals/tasks")
    async def task_create(body: TaskCreate, user: dict = Depends(at_least("lead_op"))):
        if not (body.title or "").strip():
            raise HTTPException(400, "title required")
        doc = {"task_id": f"task_{uuid.uuid4().hex[:12]}", "org_id": org_id_of(user),
               "title": body.title.strip()[:300], "description": body.description,
               "assignee_user_id": body.assignee_user_id, "rig_id": body.rig_id, "status": "open",
               "created_by_user_id": user.get("user_id"), "created_at": _now(), "updated_at": _now()}
        await db.approval_tasks.insert_one(dict(doc))
        await chain_audit(user, "approval.task.create", target=doc["task_id"], rig_id=body.rig_id,
                          meta={"assignee": body.assignee_user_id, "by_role": role_tier(user)})
        return doc

    @r.post("/approvals/tasks/{task_id}/assign")
    async def task_assign(task_id: str, body: TaskAssign, user: dict = Depends(at_least("lead_op"))):
        org = org_id_of(user)
        doc = await _get(db.approval_tasks, "task_id", task_id, org)
        if not await db.users.find_one({"user_id": body.assignee_user_id, "team_id": org}, {"_id": 0}):
            raise HTTPException(404, "Assignee not in this organization")
        await db.approval_tasks.update_one({"task_id": task_id, "org_id": org},
                                           {"$set": {"assignee_user_id": body.assignee_user_id,
                                                     "updated_at": _now()}})
        await chain_audit(user, "approval.task.assign", target=task_id,
                          meta={"assignee": body.assignee_user_id, "by_role": role_tier(user)})
        return {**doc, "assignee_user_id": body.assignee_user_id}

    # ---------- audit verification ----------
    @r.get("/approvals/audit/verify")
    async def verify_chain(user: dict = Depends(at_least("management"))):
        return {"org_id": org_id_of(user), **await audit_chain.verify(db, org_id_of(user))}

    @r.get("/approvals/audit")
    async def list_audit(limit: int = 100, skip: int = 0, user: dict = Depends(at_least("management"))):
        limit = max(1, min(limit, 500))
        q = {"org_id": org_id_of(user)}
        items = await db.audit_logs.find(q, {"_id": 0}).sort("seq", -1).skip(max(0, skip)).to_list(limit)
        return {"items": items, "total": await db.audit_logs.count_documents(q)}

    # ---------- dev / test-role view ----------
    def _beta_or_management(user):
        if not (beta_test_mode() or role_tier(user) == "management"):
            raise HTTPException(403, "Management role or BETA_TEST_MODE required")

    @r.post("/dev/seed-role-accounts")
    async def seed_accounts(user: dict = Depends(require_user)):
        _beta_or_management(user)
        return {"accounts": await seed_role_accounts(db, org_id_of(user))}

    @r.post("/auth/test-role-view")
    async def test_role_view(body: TestRoleView, user: dict = Depends(require_user)):
        _beta_or_management(user)
        if body.role not in ROLE_ACCOUNTS:
            raise HTTPException(400, f"role must be one of {list(RANK)}")
        org = org_id_of(user)
        await seed_role_accounts(db, org)
        email = ROLE_ACCOUNTS[body.role][0]
        target = await db.users.find_one({"email": email}, {"_id": 0})
        token = f"rolev_{uuid.uuid4().hex}"
        await db.user_sessions.insert_one({
            "user_id": target["user_id"], "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=2),
            "created_at": datetime.now(timezone.utc), "impersonated_by": user.get("user_id"),
        })
        await chain_audit(user, "auth.test_role_view", target=target["user_id"],
                          meta={"role": body.role, "email": email})
        return {"session_token": token, "token_type": "Bearer", "expires_in": 7200,
                "claims": {"user_id": target["user_id"], "email": email, "role": body.role,
                           "org_id": org, "impersonated_by": user.get("user_id")}}

    return r
