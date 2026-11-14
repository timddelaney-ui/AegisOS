"""Tenant scoping, RBAC and plan entitlements.

* ``TenantDB`` injects ``{"org_id": <caller org>}`` into every filter/document of
  tenant-owned collections, so a guessed resource id from another org is a 404.
* ``org_id`` falls back to the legacy ``team_id`` so existing data keeps working.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import HTTPException

from services.audit_chain import AppendOnlyViolation

TENANT_COLLECTIONS = (
    "rigs", "jobs", "surveys", "telemetry_events", "telemetry_snapshots",
    "encoder_consensus", "hitl_approvals", "audit_logs",
)


def org_id_of(user: Optional[dict]) -> str:
    org = (user or {}).get("org_id") or (user or {}).get("team_id")
    if not org:
        raise HTTPException(400, "No organization. Join or create one first.")
    return org


class TenantCollection:
    def __init__(self, coll, org_id: str, append_only: bool = False):
        self._c, self._org, self._ao = coll, org_id, append_only

    def _f(self, flt: Optional[dict]) -> dict:
        out = dict(flt or {})
        out["org_id"] = self._org  # overrides any caller-supplied org_id
        return out

    def _no_mutation(self, op: str):
        if self._ao:
            raise AppendOnlyViolation(f"{self._c.name} is append-only: {op} blocked")

    def find(self, flt=None, *a, **k): return self._c.find(self._f(flt), *a, **k)
    def find_one(self, flt=None, *a, **k): return self._c.find_one(self._f(flt), *a, **k)
    def count_documents(self, flt=None, *a, **k): return self._c.count_documents(self._f(flt), *a, **k)

    def aggregate(self, pipeline, *a, **k):
        return self._c.aggregate([{"$match": {"org_id": self._org}}, *pipeline], *a, **k)

    def insert_one(self, doc, *a, **k):
        d = dict(doc)
        d["org_id"] = self._org
        return self._c.insert_one(d, *a, **k)

    def update_one(self, flt, upd, *a, **k):
        self._no_mutation("update_one")
        if k.get("upsert"):
            upd = {**upd, "$setOnInsert": {**upd.get("$setOnInsert", {}), "org_id": self._org}}
        return self._c.update_one(self._f(flt), upd, *a, **k)

    def update_many(self, flt, upd, *a, **k):
        self._no_mutation("update_many")
        return self._c.update_many(self._f(flt), upd, *a, **k)

    def delete_one(self, flt, *a, **k):
        self._no_mutation("delete_one")
        return self._c.delete_one(self._f(flt), *a, **k)

    def delete_many(self, flt, *a, **k):
        self._no_mutation("delete_many")
        return self._c.delete_many(self._f(flt), *a, **k)


class TenantDB:
    def __init__(self, db, org_id: str):
        self._db, self.org_id = db, org_id

    def __getattr__(self, name):
        coll = getattr(self._db, name)
        if name in TENANT_COLLECTIONS:
            return TenantCollection(coll, self.org_id, append_only=(name == "audit_logs"))
        return coll


def tenant_db(db, user: dict) -> TenantDB:
    return TenantDB(db, org_id_of(user))


async def ensure_tenant_indexes(db) -> None:
    specs = {
        "rigs": [[("org_id", 1), ("rig_id", 1)]],
        "jobs": [[("org_id", 1), ("created_at", -1)]],
        "surveys": [[("org_id", 1), ("job_id", 1), ("created_at", -1)]],
        "hitl_approvals": [[("org_id", 1), ("request_id", 1)]],
        "telemetry_snapshots": [[("org_id", 1), ("rig_id", 1), ("ts", -1)]],
        "telemetry_events": [[("org_id", 1), ("rig_id", 1), ("ts", -1)]],
        "encoder_consensus": [[("org_id", 1), ("rig_id", 1), ("ts", -1)]],
    }
    for coll, idxs in specs.items():
        for keys in idxs:
            await db[coll].create_index(keys)


# ---------------------------------------------------------------- RBAC
ROLES = ("operator", "company_man", "fleet_manager")
LEGACY_ROLE_MAP = {"crew": "operator", "field_manager": "fleet_manager", "ops_manager": "fleet_manager"}

PERMISSIONS: Dict[str, frozenset] = {
    "operator": frozenset({
        "telemetry.live", "annotation.write", "handover.draft", "encoder_drift.ack",
    }),
    "company_man": frozenset({
        "telemetry.live", "telemetry.history", "wellbore3d.view", "vonmises.view",
        "outbound.approve", "handover.signoff",
    }),
    "fleet_manager": frozenset({
        "telemetry.live", "telemetry.history", "fleet.view", "rig.provision",
        "tagmap.configure", "user.manage", "audit.read", "audit.export",
        "wellbore3d.view", "vonmises.view",
    }),
}


def role_of(user: dict) -> str:
    r = (user.get("org_role") or user.get("role") or "").strip().lower()
    r = LEGACY_ROLE_MAP.get(r, r)
    return r if r in ROLES else "operator"


def has_permission(user: dict, perm: str) -> bool:
    return perm in PERMISSIONS.get(role_of(user), frozenset())


def permissions_for(user: dict) -> list:
    return sorted(PERMISSIONS[role_of(user)])


def require_permission(perm: str, require_user):
    from fastapi import Depends

    async def dep(user: dict = Depends(require_user)) -> dict:
        if not has_permission(user, perm):
            raise HTTPException(403, f"Role '{role_of(user)}' lacks permission '{perm}'.")
        return user
    return dep


# ------------------------------------------------------------ entitlements
PLANS = ("trial", "field_pro", "enterprise")
LEGACY_TIER_MAP = {"personal": "trial", "smallmed": "field_pro", "enterprise": "enterprise"}
PLAN_FEATURES: Dict[str, frozenset] = {
    "trial": frozenset({"live_telemetry"}),
    "field_pro": frozenset({"live_telemetry", "handover", "dossier", "wellbore3d"}),
    "enterprise": frozenset({"live_telemetry", "handover", "dossier", "wellbore3d",
                             "security_compliance", "audit_export", "multi_rig_fleet", "mqtt_ingest"}),
}


def beta_features() -> frozenset:
    """Opt-in beta overrides: BETA_FEATURES=a,b or BETA_UNLOCK=true (all)."""
    if os.environ.get("BETA_UNLOCK", "").strip().lower() in {"1", "true", "yes", "on"}:
        return frozenset().union(*PLAN_FEATURES.values())
    raw = os.environ.get("BETA_FEATURES", "")
    return frozenset(x.strip() for x in raw.split(",") if x.strip())


def org_plan(org: Optional[dict], user: Optional[dict] = None) -> str:
    if (user or {}).get("admin_unlocked"):
        return "enterprise"
    plan = ((org or {}).get("plan") or "").strip().lower()
    if plan in PLANS:
        return plan
    tier = ((user or {}).get("subscription_tier") or "").strip().lower()
    return LEGACY_TIER_MAP.get(tier, "trial")


def has_entitlement(plan: str, feature: str) -> bool:
    return feature in PLAN_FEATURES.get(plan, frozenset()) or feature in beta_features()
