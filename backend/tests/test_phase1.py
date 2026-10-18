"""Phase 1 backend smoke tests — RBAC, Reels, Fatigue, Surveys, Certs, Tasks, Parts, Timecards."""
import os
import time
import uuid
import pytest
import asyncio
import httpx
from datetime import datetime, timezone

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API = f"{BACKEND_URL}/api"
DEMO_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"


def c(token=DEMO_TOKEN):
    return httpx.Client(base_url=API, cookies={"session_token": token}, timeout=20)


def _rand():
    return uuid.uuid4().hex[:8]


def test_rbac_me_management():
    with c() as x:
        r = x.get("/rbac/me")
        assert r.status_code == 200
        assert r.json()["is_management"] is True


def test_rbac_members():
    with c() as x:
        r = x.get("/rbac/members")
        assert r.status_code == 200
        assert "members" in r.json()


def test_reel_create_activate_delete():
    with c() as x:
        name = f"Pytest Reel {_rand()}"
        r = x.post("/reels", json={
            "name": name,
            "total_length_ft": 10000,
            "intervals": [
                {"start_md_ft": 0, "end_md_ft": 5000, "od_in": 2.0, "wt_in": 0.175, "grade": "QT-900"},
                {"start_md_ft": 5000, "end_md_ft": 10000, "od_in": 2.0, "wt_in": 0.145, "grade": "QT-900"},
            ],
        })
        assert r.status_code == 200, r.text
        rid = r.json()["reel_id"]
        assert r.json()["intervals"][0]["smys_psi"] == 90000  # auto-derived

        r = x.post(f"/reels/{rid}/activate")
        assert r.status_code == 200 and r.json()["active_reel_id"] == rid

        r = x.get("/reels")
        assert r.json()["active_reel_id"] == rid

        r = x.delete(f"/reels/{rid}")
        assert r.status_code == 200


def test_fatigue_feed_accumulates():
    with c() as x:
        r = x.post("/reels", json={"name": f"FR {_rand()}", "total_length_ft": 10000,
                                    "intervals": [{"end_md_ft": 10000, "od_in": 2.0, "wt_in": 0.175, "grade": "QT-900"}]})
        rid = r.json()["reel_id"]
        try:
            x.post(f"/reels/{rid}/activate")
            # No damage yet
            r = x.get("/fatigue/state", params={"reel_id": rid})
            d0 = max(r.json()["damage"])
            assert d0 == 0.0
            # Feed 10 cycles at high pressure
            for _ in range(10):
                x.post("/fatigue/feed", json={"reel_id": rid, "depth_ft": 2000, "traction_pressure_psi": 2000, "cycle_count": 2})
            r = x.get("/fatigue/state", params={"reel_id": rid})
            assert max(r.json()["damage"]) > 0.0
        finally:
            x.delete(f"/reels/{rid}")


def test_survey_upload_mcm():
    with c() as x:
        csv = "md_ft,inc_deg,azi_deg\n0,0,0\n1000,2,45\n2000,15,60\n3000,45,90\n4000,80,90"
        r = x.post("/surveys/upload", data={"well_name": f"PT-{_rand()}"},
                   files={"file": ("srv.csv", csv, "text/csv")})
        assert r.status_code == 200, r.text
        s = r.json()
        assert len(s["stations"]) == 5
        last = s["stations"][-1]
        assert last["tvd_ft"] > 2500 and last["tvd_ft"] < 4000  # valid MCM
        sid = s["survey_id"]
        x.delete(f"/surveys/{sid}")


def test_cert_lifecycle():
    with c() as x:
        r = x.post("/certifications", json={
            "category": "h2s", "issuing_body": "ESC",
            "cert_number": f"H-{_rand()}", "issue_date": "2026-01-01", "expiry_date": "2027-01-01"
        })
        assert r.status_code == 200, r.text
        cid = r.json()["cert_id"]
        r = x.get("/certifications")
        found = next((c for c in r.json()["certifications"] if c["cert_id"] == cid), None)
        assert found is not None
        assert found["status"] in ("green", "amber", "expired")
        x.delete(f"/certifications/{cid}")


def test_task_lifecycle():
    with c() as x:
        r = x.post("/tasks", json={"title": f"Pytest task {_rand()}"})
        assert r.status_code == 200
        tid = r.json()["task_id"]
        r = x.patch(f"/tasks/{tid}", json={"status": "done"})
        assert r.json()["status"] == "done"
        x.delete(f"/tasks/{tid}")


def test_parts_order_approval_chain():
    with c() as x:
        r = x.post("/parts-orders", json={"description": f"Part {_rand()}", "quantity": 3})
        # Demo user is now mgmt so this auto-approves
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
        pid = r.json()["po_id"]
        r = x.post(f"/parts-orders/{pid}/status", json={"new_status": "ordered"})
        assert r.json()["status"] == "ordered"


def test_timecard_approval_chain():
    with c() as x:
        r = x.post("/timecards/lines", json={
            "work_date": "2026-10-18", "hours": 10, "description": f"Pytest {_rand()}",
            "job_number": "JOB-TEST", "pay_code": "overtime",
        })
        assert r.status_code == 200, r.text
        lid = r.json()["line_id"]
        assert r.json()["multiplier"] == 1.5

        r = x.post("/timecards/submit", json={"line_ids": [lid]})
        assert r.json()["submitted"] == 1
        r = x.post("/timecards/approve-supervisor", json={"line_ids": [lid]})
        assert r.json()["approved"] == 1
        r = x.post("/timecards/approve-payroll", json={"line_ids": [lid]})
        assert r.json()["approved"] == 1
        # Attempt delete should fail — payroll approved
        r = x.delete(f"/timecards/lines/{lid}")
        assert r.status_code == 400


def test_paycodes_seeded():
    with c() as x:
        r = x.get("/paycodes")
        codes = [p["code"] for p in r.json()["paycodes"]]
        for c_ in ["regular", "overtime", "double_time", "per_diem", "days_off_premium", "travel_standby"]:
            assert c_ in codes


def test_rbac_promote_roundtrip():
    # Promote demo to supervisor, verify, then re-promote back to mgmt via DB side-effect
    with c() as x:
        who = x.get("/rbac/me").json()
        was_mgmt = who["is_management"]
        if not was_mgmt:
            pytest.skip("demo user must start as management")
        r = x.post("/rbac/promote", json={"user_id": "demo_pro_user", "role": "supervisor"})
        assert r.status_code == 200
        # As supervisor (not management) we cannot promote back to management
        r = x.post("/rbac/promote", json={"user_id": "demo_pro_user", "role": "management"})
        assert r.status_code == 403
    # Restore mgmt role via direct DB (test harness fixup)
    import subprocess
    subprocess.run(["mongosh", "--quiet", "--eval",
        'db=db.getSiblingDB("test_database"); db.users.updateOne({user_id:"demo_pro_user"},{$set:{role:"ops_manager"}})'],
        check=False)
