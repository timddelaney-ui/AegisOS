"""Idempotent seeding of the four RBAC test accounts into an org."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

ROLE_ACCOUNTS = {
    "operator": ("operator@aegis.local", "Test Operator"),
    "lead_op": ("leadop@aegis.local", "Test Lead Operator"),
    "supervisor": ("supervisor@aegis.local", "Test Supervisor"),
    "management": ("manager@aegis.local", "Test Manager"),
}


async def seed_role_accounts(db, org_id: str) -> list:
    out = []
    for role, (email, name) in ROLE_ACCOUNTS.items():
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        fields = {"team_id": org_id, "org_id": org_id, "role": role, "org_role": role, "name": name}
        if existing:
            await db.users.update_one({"email": email}, {"$set": fields})
            user_id = existing["user_id"]
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": user_id, "email": email, "picture": None,
                "subscription_status": "free", "subscription_plan": None,
                "created_at": datetime.now(timezone.utc), **fields,
            })
        out.append({"user_id": user_id, "email": email, "role": role, "org_id": org_id})
    return out
