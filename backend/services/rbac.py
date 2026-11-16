"""Strict 4-tier RBAC: operator < lead_op < supervisor < management.

Legacy roles are mapped onto the tiers; unknown roles fall back to operator.
"""
from __future__ import annotations

from typing import Callable, Optional

from fastapi import Depends, HTTPException

TIERS = ("operator", "lead_op", "supervisor", "management")
RANK = {r: i + 1 for i, r in enumerate(TIERS)}
LEGACY_TO_TIER = {
    "crew": "operator",
    "field_manager": "supervisor",
    "ops_manager": "management",
    "admin": "management",
}


def normalize_role(role: Optional[str]) -> str:
    r = (role or "").strip().lower()
    r = LEGACY_TO_TIER.get(r, r)
    return r if r in RANK else "operator"


def role_tier(user: Optional[dict]) -> str:
    user = user or {}
    if user.get("is_admin") is True:
        return "management"
    # Highest of org_role / role so an explicit tier is never downgraded by a legacy field.
    cands = [normalize_role(user.get("org_role")) if user.get("org_role") else None,
             normalize_role(user.get("role")) if user.get("role") else None]
    cands = [c for c in cands if c]
    return max(cands, key=RANK.__getitem__) if cands else "operator"


def rank(user_or_role) -> int:
    if isinstance(user_or_role, dict):
        return RANK[role_tier(user_or_role)]
    return RANK[normalize_role(user_or_role)]


def has_min_role(user: dict, min_role: str) -> bool:
    return rank(user) >= RANK[min_role]


def require_role(min_role: str, require_user: Callable) -> Callable:
    """Dependency factory: 401 from require_user when unauthenticated, 403 when under-ranked."""
    if min_role not in RANK:
        raise ValueError(f"unknown role {min_role}")

    async def dep(user: dict = Depends(require_user)) -> dict:
        if not has_min_role(user, min_role):
            raise HTTPException(403, f"Requires role {min_role} or higher")
        return user

    return dep
