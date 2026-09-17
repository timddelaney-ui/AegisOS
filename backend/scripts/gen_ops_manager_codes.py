"""Seed 3 lifetime Ops Manager invite codes (grant_days=3650, grant_role='ops_manager')."""
import asyncio, os, secrets
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/backend/.env"))
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


def new_code():
    alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    p = lambda: "".join(secrets.choice(alpha) for _ in range(4))
    return f"OM-{p()}-{p()}"


async def main():
    codes = []
    for i in range(3):
        code = new_code()
        while await db.invite_codes.find_one({"code": code}, {"_id": 1}):
            code = new_code()
        await db.invite_codes.insert_one({
            "code": code,
            "created_by": "system",
            "created_by_email": "system@ctpocket.local",
            "note": f"Operations Manager master pass #{i+1}",
            "grant_days": 3650,
            "grant_role": "ops_manager",
            "max_uses": 1,
            "use_count": 0,
            "redemptions": [],
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        })
        codes.append(code)
    print("Ops Manager lifetime codes:")
    for c in codes:
        print(" ", c)


asyncio.run(main())
