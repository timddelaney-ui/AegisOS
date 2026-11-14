"""Append-only, SHA-256 hash-chained audit log (collection ``audit_logs``).

Each entry stores ``prev_hash`` (the previous entry's ``entry_hash`` within the
same org, ``GENESIS`` for the first) and ``entry_hash = sha256(canonical JSON of
the entry body + prev_hash)``. A unique ``(org_id, seq)`` index makes concurrent
appenders retry instead of forking the chain.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pymongo.errors import DuplicateKeyError

GENESIS = "0" * 64
HASHED_FIELDS = (
    "id", "org_id", "seq", "ts", "action", "actor_user_id", "actor_email",
    "approver_user_id", "rig_id", "target", "payload_hash", "decision", "meta",
)


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def compute_entry_hash(entry: Dict[str, Any], prev_hash: str) -> str:
    body = {k: entry.get(k) for k in HASHED_FIELDS}
    return hashlib.sha256((canonical_json(body) + prev_hash).encode("utf-8")).hexdigest()


def hash_payload(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


class AppendOnlyViolation(Exception):
    pass


_locks: Dict[str, asyncio.Lock] = {}


async def ensure_indexes(db) -> None:
    await db.audit_logs.create_index([("org_id", 1), ("seq", 1)], unique=True)
    await db.audit_logs.create_index([("org_id", 1), ("rig_id", 1), ("ts", -1)])
    await db.audit_logs.create_index([("org_id", 1), ("action", 1), ("ts", -1)])


async def append(
    db, *, org_id: str, action: str, actor_user_id: Optional[str] = None,
    actor_email: Optional[str] = None, approver_user_id: Optional[str] = None,
    rig_id: Optional[str] = None, target: Optional[str] = None,
    payload_hash: Optional[str] = None, decision: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not org_id:
        raise ValueError("org_id required")
    lock = _locks.setdefault(org_id, asyncio.Lock())
    async with lock:
        for _ in range(8):
            last = await db.audit_logs.find_one({"org_id": org_id}, {"_id": 0}, sort=[("seq", -1)])
            seq = (last["seq"] + 1) if last else 1
            prev = last["entry_hash"] if last else GENESIS
            entry = {
                "id": uuid.uuid4().hex, "org_id": org_id, "seq": seq,
                "ts": datetime.now(timezone.utc).isoformat(), "action": action,
                "actor_user_id": actor_user_id, "actor_email": actor_email,
                "approver_user_id": approver_user_id, "rig_id": rig_id, "target": target,
                "payload_hash": payload_hash, "decision": decision, "meta": meta or {},
            }
            entry["prev_hash"] = prev
            entry["entry_hash"] = compute_entry_hash(entry, prev)
            try:
                await db.audit_logs.insert_one(dict(entry))
                return entry
            except DuplicateKeyError:
                continue  # another worker appended first; re-read the head
    raise RuntimeError("audit chain contention")


async def verify(db, org_id: str) -> Dict[str, Any]:
    prev, expected_seq, n = GENESIS, 1, 0
    async for e in db.audit_logs.find({"org_id": org_id}, {"_id": 0}).sort("seq", 1):
        n += 1
        if e.get("seq") != expected_seq:
            return {"valid": False, "entries": n, "broken_at_seq": expected_seq, "reason": "missing or reordered entry"}
        if e.get("prev_hash") != prev:
            return {"valid": False, "entries": n, "broken_at_seq": e["seq"], "reason": "prev_hash mismatch"}
        if compute_entry_hash(e, prev) != e.get("entry_hash"):
            return {"valid": False, "entries": n, "broken_at_seq": e["seq"], "reason": "entry_hash mismatch"}
        prev, expected_seq = e["entry_hash"], expected_seq + 1
    return {"valid": True, "entries": n, "head_hash": prev}


class _AppendOnlyCollection:
    """Data-layer guard: exposes only insert/read for audit_logs."""

    def __init__(self, coll):
        self._c = coll

    def find(self, *a, **k): return self._c.find(*a, **k)
    def find_one(self, *a, **k): return self._c.find_one(*a, **k)
    def count_documents(self, *a, **k): return self._c.count_documents(*a, **k)
    def insert_one(self, *a, **k): return self._c.insert_one(*a, **k)

    def __getattr__(self, name):
        if name.startswith(("update", "delete", "replace", "find_one_and", "bulk_write", "drop", "rename")):
            raise AppendOnlyViolation(f"audit_logs is append-only: {name} blocked")
        return getattr(self._c, name)


def guarded(db):
    return _AppendOnlyCollection(db.audit_logs)
