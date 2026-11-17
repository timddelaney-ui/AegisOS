"""Org-scoped RBAC, entitlements, rig provisioning and audit-log endpoints."""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from middleware.tenant import (
    PLAN_FEATURES, ROLES, TenantDB, org_id_of, org_plan, permissions_for,
    require_permission, role_of,
)
from services import audit_chain
from phase1_modules import require_management


class RoleChange(BaseModel):
    role: str


class RigCreate(BaseModel):
    rig_id: str
    name: Optional[str] = None


class LeadAssignment(BaseModel):
    user_id: Optional[str] = Field(...)


def build_router(*, require_user, db, chain_audit, has_fleet_plan=None) -> APIRouter:
    r = APIRouter()
    fleet = lambda perm: require_permission(perm, require_user)  # noqa: E731

    def require_fleet_plan(user):
        if not has_fleet_plan or not has_fleet_plan(user):
            raise HTTPException(403, "Fleet Enterprise is required for organization management.")

    async def _plan(user):
        team = await db.teams.find_one({"team_id": org_id_of(user)}, {"_id": 0})
        return org_plan(team, user)

    @r.get("/me/entitlements")
    async def my_entitlements(user: dict = Depends(require_user)):
        plan = await _plan(user)
        feats = sorted(PLAN_FEATURES[plan])
        return {"org_id": org_id_of(user), "plan": plan, "features": feats,
                "role": role_of(user), "permissions": permissions_for(user)}

    @r.put("/org/users/{user_id}/role")
    async def change_role(user_id: str, body: RoleChange, user: dict = Depends(fleet("user.manage"))):
        require_fleet_plan(user)
        if body.role not in ROLES:
            raise HTTPException(400, f"role must be one of {list(ROLES)}")
        org = org_id_of(user)
        target = await db.users.find_one({"user_id": user_id, "team_id": org}, {"_id": 0})
        if not target:
            raise HTTPException(404, "User not found in your organization.")
        old = role_of(target)
        await db.users.update_one({"user_id": user_id, "team_id": org}, {"$set": {"org_role": body.role}})
        await chain_audit(user, "role.change", target=user_id,
                          meta={"from": old, "to": body.role})
        return {"user_id": user_id, "role": body.role}

    @r.post("/org/rigs")
    async def provision_rig(body: RigCreate, user: dict = Depends(fleet("rig.provision"))):
        require_fleet_plan(user)
        if body.rig_id not in {f"CT-UNIT-{i:02d}" for i in range(1, 5)}:
            raise HTTPException(400, "Rig ID must be CT-UNIT-01 through CT-UNIT-04.")
        tdb = TenantDB(db, org_id_of(user))
        if await tdb.rigs.find_one({"rig_id": body.rig_id}):
            raise HTTPException(409, "Rig already exists.")
        await tdb.rigs.insert_one({"rig_id": body.rig_id, "name": body.name or body.rig_id,
                                   "created_by": user["user_id"]})
        await chain_audit(user, "rig.provision", rig_id=body.rig_id, target=body.rig_id)
        return {"rig_id": body.rig_id}

    @r.get("/org/rigs")
    async def list_rigs(user: dict = Depends(require_user)):
        tdb = TenantDB(db, org_id_of(user))
        return [d async for d in tdb.rigs.find({}, {"_id": 0})]

    @r.get("/rigs/lead-assignments")
    async def list_lead_assignments(user: dict = Depends(require_user)):
        require_fleet_plan(user)
        require_management(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Join a team before managing assignments.")
        rows = await db.rig_lead_assignments.find({"team_id": team_id}, {"_id": 0}).to_list(26)
        return {"assignments": rows}

    @r.put("/rigs/{rig_id}/lead-assignment")
    async def assign_lead(rig_id: str, body: LeadAssignment, user: dict = Depends(require_user)):
        require_fleet_plan(user)
        require_management(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Join a team before managing assignments.")
        if rig_id not in {f"CT-UNIT-{i:02d}" for i in range(1, 5)}:
            raise HTTPException(404, "Rig not found.")
        tdb = TenantDB(db, team_id)
        if not await tdb.rigs.find_one({"rig_id": rig_id}):
            raise HTTPException(404, "Rig must be provisioned before assigning a lead.")
        if body.user_id is not None:
            member = await db.users.find_one({"team_id": team_id, "user_id": body.user_id}, {"_id": 0, "user_id": 1})
            if not member:
                raise HTTPException(404, "User not found in your team.")
        assignment_id = hashlib.sha256(f"{team_id}\0{rig_id}".encode()).hexdigest()
        await db.rig_lead_assignments.update_one(
            {"_id": assignment_id, "team_id": team_id},
            {"$set": {"team_id": team_id, "rig_id": rig_id, "user_id": body.user_id}},
            upsert=True,
        )
        await chain_audit(user, "rig.lead_assignment", rig_id=rig_id, target=body.user_id)
        return {"rig_id": rig_id, "user_id": body.user_id}

    @r.get("/audit-logs")
    async def list_audit(
        rig_id: Optional[str] = None, action: Optional[str] = None,
        start: Optional[datetime] = None, end: Optional[datetime] = None,
        limit: int = Query(200, ge=1, le=1000), fmt: str = "json",
        user: dict = Depends(fleet("audit.read")),
    ):
        flt: dict = {}
        if rig_id:
            flt["rig_id"] = rig_id
        if action:
            flt["action"] = action
        if start or end:
            flt["ts"] = {**({"$gte": start.isoformat()} if start else {}),
                         **({"$lte": end.isoformat()} if end else {})}
        tdb = TenantDB(db, org_id_of(user))
        rows = [d async for d in tdb.audit_logs.find(flt, {"_id": 0}).sort("seq", -1).limit(limit)]
        if fmt == "csv":
            await chain_audit(user, "audit.export", meta={"rows": len(rows)})
            buf = io.StringIO()
            cols = ["seq", "ts", "action", "actor_user_id", "approver_user_id", "rig_id",
                    "target", "payload_hash", "decision", "entry_hash"]
            w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
            return PlainTextResponse(buf.getvalue(), media_type="text/csv")
        return {"items": rows, "count": len(rows)}

    @r.get("/audit-logs/verify")
    async def verify_audit(user: dict = Depends(fleet("audit.read"))):
        return await audit_chain.verify(db, org_id_of(user))

    return r
