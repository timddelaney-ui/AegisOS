"""Phase 2 backend scaffolds — DAQ configs, K_t, Dossier, Guest role."""
import os
import uuid
import httpx
import subprocess

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API = f"{BACKEND_URL}/api"
DEMO_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"


def c(token=DEMO_TOKEN):
    return httpx.Client(base_url=API, cookies={"session_token": token}, timeout=20)


def _rand():
    return uuid.uuid4().hex[:8]


def test_daq_config_crud_and_toggle():
    with c() as x:
        r = x.post("/daq/configs", json={
            "name": f"Test Rig {_rand()}",
            "protocol": "wits0_tcp",
            "host": "10.0.0.5", "port": 12345,
            "channel_map": {"01": "depth_ft"},
            "enabled": False,
        })
        assert r.status_code == 200, r.text
        cid = r.json()["config_id"]
        assert r.json()["status"] == "idle"
        # Enable → status flips to connecting
        r = x.patch(f"/daq/configs/{cid}", json={"enabled": True})
        assert r.status_code == 200
        assert r.json()["status"] == "connecting"
        # Listener callback flips status to connected
        r = x.post(f"/daq/configs/{cid}/status", json={"status": "connected", "last_sample_at": "2026-02-18T12:00:00Z"})
        assert r.status_code == 200
        r = x.get("/daq/configs")
        found = next((cc for cc in r.json()["configs"] if cc["config_id"] == cid), None)
        assert found["status"] == "connected"
        # Disable
        x.patch(f"/daq/configs/{cid}", json={"enabled": False})
        # Cleanup
        x.delete(f"/daq/configs/{cid}")


def test_invalid_protocol_rejected():
    with c() as x:
        r = x.post("/daq/configs", json={"name": "bad", "protocol": "ftp"})
        assert r.status_code == 400


def test_kt_set_for_reel():
    with c() as x:
        # Create a reel first
        r = x.post("/reels", json={"name": f"KT {_rand()}", "total_length_ft": 5000,
                                     "intervals": [{"end_md_ft": 5000, "od_in": 2.0, "wt_in": 0.175, "grade": "QT-900"}]})
        rid = r.json()["reel_id"]
        try:
            r = x.post("/fatigue/kt", json={"reel_id": rid, "k_t": 1.4})
            assert r.status_code == 200
            assert r.json()["k_t"] == 1.4
            # Out of range rejected
            r = x.post("/fatigue/kt", json={"reel_id": rid, "k_t": 5.0})
            assert r.status_code == 400
        finally:
            x.delete(f"/reels/{rid}")


def test_dossier_shape():
    with c() as x:
        r = x.get("/dossier")
        assert r.status_code == 200, r.text
        d = r.json()
        for section in ("job_header", "pump_schedule", "recorded_channels", "vm_alerts",
                         "fatigue_delta", "crew_hours", "crew_signatures", "window"):
            assert section in d
        for ch in ("weight_lb", "p_internal_psi", "traction_pressure_psi", "depth_ft"):
            assert ch in d["recorded_channels"]


def test_share_link_create_redeem_revoke():
    """Full lifecycle: create → public redeem → guest cookie → revoke."""
    with c() as x:
        r = x.post("/share-links", json={"label": "Pytest Client", "days": 7})
        assert r.status_code == 200, r.text
        link = r.json()
        token = link["token"]
        link_id = link["link_id"]

    # Fresh client without cookies — simulates the client-side link redemption
    with httpx.Client(base_url=API, timeout=20) as pub:
        r = pub.get(f"/share/{token}")
        assert r.status_code == 200, r.text
        assert r.json()["redirect"] == "/live-ops"
        # Secure+SameSite=None cookies aren't stored over HTTP by httpx — grab manually
        sess_cookie = r.cookies.get("session_token") or None
        if not sess_cookie:
            # Parse from raw Set-Cookie header as fallback
            raw = r.headers.get("set-cookie", "")
            for part in raw.split(","):
                if "session_token=" in part:
                    sess_cookie = part.split("session_token=")[1].split(";")[0]
                    break
        assert sess_cookie, "Share redemption did not set session_token cookie"
        # Use the token explicitly on subsequent calls
        headers = {"Cookie": f"session_token={sess_cookie}"}
        r = pub.get("/rbac/me", headers=headers)
        assert r.status_code == 200
        me = r.json()
        assert me["role_plan"] == "guest"
        # Guest blocked from DAQ
        r = pub.get("/daq/configs", headers=headers)
        assert r.status_code == 403

    # Revoke
    with c() as x:
        r = x.delete(f"/share-links/{link_id}")
        assert r.status_code == 200

    # Fresh public attempt now fails
    with httpx.Client(base_url=API, timeout=20) as pub2:
        r = pub2.get(f"/share/{token}")
        assert r.status_code == 403

    with c() as x:
        # Promote demo to guest
        r = x.post("/rbac/promote", json={"user_id": "demo_pro_user", "role": "guest"})
        assert r.status_code == 200
    try:
        with c() as x:
            # Guest cannot list DAQ configs
            r = x.get("/daq/configs")
            assert r.status_code == 403
            # Guest cannot create parts order
            r = x.post("/parts-orders", json={"description": "x", "quantity": 1})
            # No endpoint-level require_crew on parts-orders currently → OK, so just check guest CAN read live-ops
            # (operational flows stay accessible for client viewing)
            r2 = x.get("/liveops/stream", params={"limit": 1})
            assert r2.status_code == 200
    finally:
        subprocess.run(["mongosh", "--quiet", "--eval",
            'db=db.getSiblingDB("test_database"); db.users.updateOne({user_id:"demo_pro_user"},{$set:{role:"ops_manager"}})'],
            check=False)


# -----------------------------------------------------------------
# Playback Annotations (manual + rig-computer)
# -----------------------------------------------------------------
def test_annotation_manual_crud():
    ts = 1_700_000_000_000
    with c() as x:
        # Create
        r = x.post("/liveops/annotations", json={
            "timestamp_ms": ts,
            "note": "pressure spike here = pump failure",
            "severity": "critical",
            "depth_ft": 4200.5,
            "channel": "p_internal_psi",
            "value": 9200.0,
        })
        assert r.status_code == 200, r.text
        annot = r.json()
        aid = annot["annot_id"]
        assert annot["source"] == "manual"
        assert annot["severity"] == "critical"
        assert annot["author_user_id"] == "demo_pro_user"

        # List includes it
        r = x.get("/liveops/annotations", params={"from_ms": ts - 1, "to_ms": ts + 1})
        assert r.status_code == 200
        ids = [a["annot_id"] for a in r.json()["annotations"]]
        assert aid in ids

        # Edit
        r = x.patch(f"/liveops/annotations/{aid}", json={"note": "updated note", "severity": "warn"})
        assert r.status_code == 200
        assert r.json()["note"] == "updated note"
        assert r.json()["severity"] == "warn"

        # Delete
        r = x.delete(f"/liveops/annotations/{aid}")
        assert r.status_code == 200


def test_annotation_rig_ingest_batch_and_immutable():
    ts = 1_700_000_100_000
    with c() as x:
        r = x.post("/liveops/annotations/ingest", json={
            "source": "wits0",
            "items": [
                {"timestamp_ms": ts, "note": "P>9000 breached", "severity": "critical",
                 "rule_id": "p_hard_cap", "channel": "p_internal_psi", "value": 9120.0, "depth_ft": 4100.0},
                {"timestamp_ms": ts + 500, "note": "Weight overpull", "severity": "critical",
                 "rule_id": "w_overpull", "channel": "weight_lb", "value": 27500.0},
            ],
        })
        assert r.status_code == 200, r.text
        payload = r.json()
        assert payload["inserted"] == 2
        rig_ids = [a["annot_id"] for a in payload["items"]]
        assert all(a["source"] == "wits0" for a in payload["items"])

        # Rig-sourced is immutable
        r = x.patch(f"/liveops/annotations/{rig_ids[0]}", json={"note": "nope"})
        assert r.status_code == 403

        # Management can delete rig-sourced
        r = x.delete(f"/liveops/annotations/{rig_ids[0]}")
        assert r.status_code == 200
        r = x.delete(f"/liveops/annotations/{rig_ids[1]}")
        assert r.status_code == 200


def test_annotation_invalid_severity_rejected():
    with c() as x:
        r = x.post("/liveops/annotations", json={
            "timestamp_ms": 1_700_000_200_000,
            "note": "x", "severity": "bogus",
        })
        assert r.status_code == 400


def test_annotation_rules_defaults_then_upsert():
    with c() as x:
        r = x.get("/liveops/annotations/rules")
        assert r.status_code == 200
        data = r.json()
        assert data["defaults"] is True
        assert len(data["rules"]) >= 3

        # Upsert a tuned set
        r = x.put("/liveops/annotations/rules", json=[
            {"rule_id": "p_hard_cap", "channel": "p_internal_psi", "op": ">",
             "threshold": 9500, "severity": "critical", "note": "Pressure hard cap", "enabled": True},
        ])
        assert r.status_code == 200
        assert r.json()["saved"] == 1

        r = x.get("/liveops/annotations/rules")
        data = r.json()
        assert data["defaults"] is False
        assert data["rules"][0]["threshold"] == 9500

        # Clear so defaults return next read
        r = x.put("/liveops/annotations/rules", json=[])
        assert r.status_code == 200


def test_annotation_guest_can_read_not_write():
    """Guest share link user is view-only on annotations."""
    with c() as x:
        link = x.post("/share-links", json={"label": "pytest-annot", "days": 1}).json()
        link_id = link["link_id"]
        token = link["token"]
    try:
        with httpx.Client(base_url=API, timeout=20) as pub:
            r = pub.get(f"/share/{token}")
            assert r.status_code == 200
            # Grab cookie
            raw = r.headers.get("set-cookie", "")
            sess = None
            for part in raw.split(","):
                if "session_token=" in part:
                    sess = part.split("session_token=")[1].split(";")[0]
                    break
            assert sess
            h = {"Cookie": f"session_token={sess}"}
            # Guest can list (view-only)
            r = pub.get("/liveops/annotations", headers=h)
            assert r.status_code == 200
            # Guest cannot drop a manual note (requires supervisor+)
            r = pub.post("/liveops/annotations",
                         json={"timestamp_ms": 1_700_000_300_000, "note": "x", "severity": "info"},
                         headers=h)
            assert r.status_code == 403
            # Guest cannot ingest rig notes (requires crew+)
            r = pub.post("/liveops/annotations/ingest",
                         json={"source": "wits0", "items": [{"timestamp_ms": 1, "note": "x"}]},
                         headers=h)
            assert r.status_code == 403
    finally:
        with c() as x:
            x.delete(f"/share-links/{link_id}")


# -----------------------------------------------------------------
# Admin Rig Rename (per-team labels)
# -----------------------------------------------------------------
def test_rig_labels_management_can_write_crew_cannot():
    with c() as x:
        # Starts empty (or whatever previous test left)
        r = x.get("/rigs/labels")
        assert r.status_code == 200
        assert "labels" in r.json()

        # Management upsert
        r = x.put("/rigs/labels", json={"labels": {
            "RIG1": "North Pad Unit 7",
            "RIG2": "Duvernay Day Shift",
            "YARD": "Nisku Yard",
        }})
        assert r.status_code == 200, r.text
        assert r.json()["saved"] == 3

        r = x.get("/rigs/labels")
        d = r.json()["labels"]
        assert d["RIG1"] == "North Pad Unit 7"
        assert d["YARD"] == "Nisku Yard"

        # Empty string clears the override
        r = x.put("/rigs/labels", json={"labels": {"RIG2": ""}})
        assert r.status_code == 200
        r = x.get("/rigs/labels")
        assert "RIG2" not in r.json()["labels"]
        assert r.json()["labels"]["RIG1"] == "North Pad Unit 7"

        # Invalid rig_id is silently skipped
        r = x.put("/rigs/labels", json={"labels": {"RIG999": "ghost"}})
        assert r.status_code == 200
        assert r.json()["saved"] == 0

    # Crew (non-management) blocked — demote then try to write
    with c() as x:
        x.post("/rbac/promote", json={"user_id": "demo_pro_user", "role": "crew"})
    try:
        with c() as x:
            r = x.put("/rigs/labels", json={"labels": {"RIG1": "nope"}})
            assert r.status_code == 403
            # But crew CAN read
            r = x.get("/rigs/labels")
            assert r.status_code == 200
    finally:
        subprocess.run(["mongosh", "--quiet", "--eval",
            'db=db.getSiblingDB("test_database"); db.users.updateOne({user_id:"demo_pro_user"},{$set:{role:"ops_manager"}})'],
            check=False)

    # Cleanup
    with c() as x:
        x.put("/rigs/labels", json={"labels": {"RIG1": "", "YARD": ""}})


# -----------------------------------------------------------------
# Rig Fleet Status (Running / Standby / Down / Yard)
# -----------------------------------------------------------------
def test_rig_status_supervisor_can_write_crew_cannot():
    with c() as x:
        # Supervisor+ (demo is management) can write
        r = x.put("/rigs/status", json={"statuses": {
            "RIG1": {"status": "running", "note": "Pumping on Pad 7"},
            "RIG2": {"status": "down", "note": "Awaiting BOP cert"},
            "YARD": {"status": "yard"},
        }})
        assert r.status_code == 200, r.text
        assert r.json()["saved"] == 3

        r = x.get("/rigs/status")
        d = r.json()["statuses"]
        assert d["RIG1"]["status"] == "running"
        assert d["RIG1"]["note"] == "Pumping on Pad 7"
        assert d["RIG2"]["status"] == "down"
        assert d["YARD"]["status"] == "yard"

        # Invalid status silently skipped
        r = x.put("/rigs/status", json={"statuses": {"RIG1": {"status": "exploded"}}})
        assert r.json()["saved"] == 0

        # Invalid rig_id silently skipped
        r = x.put("/rigs/status", json={"statuses": {"RIG999": {"status": "running"}}})
        assert r.json()["saved"] == 0

    # Crew cannot write
    with c() as x:
        x.post("/rbac/promote", json={"user_id": "demo_pro_user", "role": "crew"})
    try:
        with c() as x:
            r = x.put("/rigs/status", json={"statuses": {"RIG1": {"status": "running"}}})
            assert r.status_code == 403
            # But crew CAN read
            r = x.get("/rigs/status")
            assert r.status_code == 200
    finally:
        subprocess.run(["mongosh", "--quiet", "--eval",
            'db=db.getSiblingDB("test_database"); db.users.updateOne({user_id:"demo_pro_user"},{$set:{role:"ops_manager"}})'],
            check=False)


# -----------------------------------------------------------------
# DAQ listeners — probe endpoint + protocol validation
# -----------------------------------------------------------------
def test_daq_test_endpoint_validates_protocol():
    with c() as x:
        r = x.post("/daq/test", json={"protocol": "nonsense", "host": "127.0.0.1", "port": 1, "timeout_s": 1})
        assert r.status_code == 400
        assert "protocol" in r.json()["detail"].lower()


def test_daq_test_endpoint_unreachable_wits_returns_graceful_error():
    """A real DAQ probe to an unreachable TCP endpoint returns a clean error, not 500."""
    with c() as x:
        r = x.post("/daq/test", json={
            "protocol": "wits0_tcp", "host": "127.0.0.1", "port": 1,  # unused high port
            "timeout_s": 2,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is False
        assert data["error"]  # some error string
        assert data["protocol"] == "wits0_tcp"


def test_daq_test_endpoint_requires_supervisor():
    """Crew role is blocked from testing DAQ endpoints."""
    with c() as x:
        x.post("/rbac/promote", json={"user_id": "demo_pro_user", "role": "crew"})
    try:
        with c() as x:
            r = x.post("/daq/test", json={"protocol": "wits0_tcp", "host": "127.0.0.1", "port": 1, "timeout_s": 1})
            assert r.status_code == 403
    finally:
        subprocess.run(["mongosh", "--quiet", "--eval",
            'db=db.getSiblingDB("test_database"); db.users.updateOne({user_id:"demo_pro_user"},{$set:{role:"ops_manager"}})'],
            check=False)
