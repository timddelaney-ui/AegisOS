"""POST /api/demo/golden-job/seed: idempotent, org-scoped Golden Job demo data for the 4-tier RBAC cockpit.

Management only, or any authenticated user while BETA_TEST_MODE is on. Re-running never duplicates
rows and never resets status changes made after the first seed (all writes are $setOnInsert).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from middleware.tenant import org_id_of
from routes.approvals import beta_test_mode
from services.rbac import role_tier
from services.seed_roles import seed_role_accounts

RIG_ID = "rig_ct_14"
JOB_NAME = "Aegis Golden 14H"
# (MD ft, Inc deg, Az deg, TVD ft) - KOP 7,000, heel 7,900, TD 16,400; mirrors edge_gateway/config/golden_job_survey.csv.
SURVEY_STATIONS = [
    (0, 0.7, 165, 0), (1000, 1.15, 171.96, 999.9), (2000, 1.1, 174.99, 1999.7), (3000, 0.6, 172.41, 2999.5),
    (4000, 0.22, 165.65, 3999.5), (5000, 0.37, 158.52, 4999.5), (6000, 0.89, 155.05, 5999.4),
    (7000, 1.2, 157.18, 6999.3), (7500, 50, 179.11, 7438.1), (7900, 90, 180, 7572.2), (8000, 90.3, 180.3, 7571.9),
    (9000, 91.15, 181.42, 7557.1), (10000, 90.21, 182.3, 7543.5), (11000, 88.96, 182.41, 7554.7),
    (12000, 89.44, 182.22, 7572.3), (13000, 90.89, 181.17, 7567), (14000, 90.77, 179.98, 7547.9),
    (15000, 89.35, 178.52, 7547.7), (16000, 89, 177.59, 7566.6), (16400, 89.47, 177.42, 7571.7),
]
TASKS = [
    ("verify_enc3", "Verify encoder 3 re-zero at surface", "open", "operator"),
    ("flush_recon", "Reconcile fluid totals (acid / FR / MMFR / gel / flush) with company man", "open", "lead_op"),
    ("td_signoff", "Sign off TD pressure and Von Mises report (8,800 psi / 81.4%)", "open", "supervisor"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_router(*, require_user, db, chain_audit=None) -> APIRouter:
    r = APIRouter()

    @r.post("/demo/golden-job/seed")
    async def seed_golden_job(user: dict = Depends(require_user)):
        if not (beta_test_mode() or role_tier(user) == "management"):
            raise HTTPException(403, "Management role or BETA_TEST_MODE required")
        org = org_id_of(user)
        tag = hashlib.sha1(org.encode()).hexdigest()[:10]
        now = _now()

        accounts = await seed_role_accounts(db, org)
        by_role = {a["role"]: a for a in accounts}

        job_id = f"job_golden_{tag}"
        job = {
            "job_id": job_id, "org_id": org, "team_id": org, "user_id": by_role["lead_op"]["user_id"],
            "user_name": "Test Lead Operator", "sheet_key": "golden_job", "title": JOB_NAME,
            "unit_system": "imperial", "visibility": "team", "client_id": f"golden-job-{tag}",
            "rig_id": RIG_ID, "created_at": now, "updated_at": now,
            "values": {
                "well": {"name": JOB_NAME, "api_no": "42-000-00014", "kop_md_ft": 7000, "heel_md_ft": 7900,
                         "td_md_ft": 16400, "td_tvd_ft": 7571.7, "max_pressure_psi": 8800},
                "string": {"coil_od_in": 2.375, "wall_in": 0.190, "grade": "CT110", "length_ft": 21000,
                           "von_mises_utilisation_pct": 81.4},
                "bha": [
                    {"item": "Coil connector", "od_in": 2.875, "length_ft": 0.8},
                    {"item": "Dual check valve", "od_in": 2.875, "length_ft": 2.1},
                    {"item": "Hydraulic disconnect", "od_in": 2.875, "length_ft": 3.0},
                    {"item": "Agitator", "od_in": 2.875, "length_ft": 6.5},
                    {"item": "Jetting nozzle", "od_in": 2.875, "length_ft": 1.2},
                ],
                "survey": [{"md_ft": m, "inc_deg": i, "az_deg": a, "tvd_ft": t} for m, i, a, t in SURVEY_STATIONS],
                "fluids": ["Acid", "FR Slug", "MMFR Slugs", "Gel Pills", "Water Flush"],
            },
        }
        job_res = await db.jobs.update_one({"job_id": job_id, "org_id": org}, {"$setOnInsert": job}, upsert=True)
        await db.surveys.update_one(
            {"job_id": job_id, "org_id": org},
            {"$setOnInsert": {"job_id": job_id, "org_id": org, "created_at": now,
                              "stations": job["values"]["survey"]}}, upsert=True)
        await db.rigs.update_one({"rig_id": RIG_ID, "org_id": org},
                                 {"$setOnInsert": {"rig_id": RIG_ID, "org_id": org, "name": "CT Unit 14",
                                                   "created_at": now}}, upsert=True)

        for key, title, status, assignee_role in TASKS:
            task_id = f"task_golden_{tag}_{key}"
            await db.approval_tasks.update_one(
                {"task_id": task_id, "org_id": org},
                {"$setOnInsert": {"task_id": task_id, "org_id": org, "title": title, "description": None,
                                  "assignee_user_id": by_role[assignee_role]["user_id"], "rig_id": RIG_ID,
                                  "job_id": job_id, "status": status,
                                  "created_by_user_id": by_role["lead_op"]["user_id"],
                                  "created_at": now, "updated_at": now}}, upsert=True)

        request_id = f"req_golden_{tag}_encoder"
        op = by_role["operator"]
        req_res = await db.approval_requests.update_one(
            {"request_id": request_id, "org_id": org},
            {"$setOnInsert": {"request_id": request_id, "org_id": org, "kind": "parts_request",
                              "title": "Replacement encoder 3 wheel assembly",
                              "details": "Encoder 3 slipped > 2.0 ft during the lateral; wheel worn.",
                              "quantity": 1, "rig_id": RIG_ID, "job_id": job_id, "status": "pending_supervisor",
                              "created_by_user_id": op["user_id"], "created_by_email": op["email"],
                              "created_at": now, "updated_at": now, "history": []}}, upsert=True)

        created = bool(job_res.upserted_id) or bool(req_res.upserted_id)
        if created and chain_audit:
            await chain_audit(user, "demo.golden_job.seed", target=job_id, rig_id=RIG_ID,
                              meta={"by_role": role_tier(user)})
        return {
            "seeded": created, "org_id": org, "job_id": job_id, "rig_id": RIG_ID, "request_id": request_id,
            "accounts": accounts, "tasks": len(TASKS), "pending_parts_requests": 1,
        }

    return r
