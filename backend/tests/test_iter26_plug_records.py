# Real Plug Records: per-survey plug CRUD, RBAC, team isolation, plug test runs
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MGMT_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"
SURVEY = "srv_705200a70a31"          # DLS Demo Well, TD 10,000 ft, team_5d808edd1dbb
OTHER_TEAM_SURVEY = "srv_c2acb5c12743"  # team_9af2d0d38747
TEAM = "team_5d808edd1dbb"


def _sess(token):
    s = requests.Session()
    s.cookies.set("session_token", token)
    return s


@pytest.fixture(scope="module")
def mongo():
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    c = MongoClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    yield db
    c.close()


@pytest.fixture(scope="module")
def users(mongo):
    """Create TEST_ crew / guest / other-team-supervisor users with sessions."""
    exp = datetime.now(timezone.utc) + timedelta(days=2)
    spec = {"crew": ("crew", TEAM), "guest": ("guest", TEAM), "other": ("field_manager", "team_9af2d0d38747")}
    out = {}
    for k, (role, team) in spec.items():
        uid = f"TEST_plug_{k}"
        tok = f"TEST_plug_tok_{k}"
        mongo.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": f"test_plug_{k}@example.com", "name": f"TEST {k}", "role": role,
            "team_id": team, "subscription_status": "active", "subscription_tier": "smallmed",
            "subscription_expires_at": exp + timedelta(days=3000), "created_at": datetime.now(timezone.utc)}}, upsert=True)
        mongo.user_sessions.update_one({"session_token": tok}, {"$set": {
            "user_id": uid, "session_token": tok, "expires_at": exp, "created_at": datetime.now(timezone.utc)}}, upsert=True)
        out[k] = _sess(tok)
    out["mgmt"] = _sess(MGMT_TOKEN)
    yield out
    mongo.users.delete_many({"user_id": {"$regex": "^TEST_plug_"}})
    mongo.user_sessions.delete_many({"session_token": {"$regex": "^TEST_plug_tok_"}})
    mongo.survey_plugs.delete_many({"name": {"$regex": "^TEST_"}})
    mongo.plug_runs.delete_many({"created_by": {"$regex": "^test_plug_"}})


def _plug(name="TEST_A", top=5000, bottom=5002, t="bridge_plug", notes="TEST note"):
    return {"name": name, "plug_type": t, "top_md_ft": top, "bottom_md_ft": bottom, "notes": notes}


class TestPlugList:
    def test_list_mgmt(self, users):
        r = users["mgmt"].get(f"{API}/surveys/{SURVEY}/plugs")
        assert r.status_code == 200
        d = r.json()
        assert d["can_edit"] is True
        assert any(p["name"] == "P1" and p["top_md_ft"] == 8400 for p in d["plugs"])
        assert all("_id" not in p for p in d["plugs"])

    def test_list_crew_cannot_edit(self, users):
        r = users["crew"].get(f"{API}/surveys/{SURVEY}/plugs")
        assert r.status_code == 200 and r.json()["can_edit"] is False

    def test_unauth(self):
        assert requests.get(f"{API}/surveys/{SURVEY}/plugs").status_code == 401

    def test_other_team_404(self, users):
        assert users["mgmt"].get(f"{API}/surveys/{OTHER_TEAM_SURVEY}/plugs").status_code == 404
        assert users["other"].get(f"{API}/surveys/{SURVEY}/plugs").status_code == 404
        assert users["mgmt"].get(f"{API}/surveys/srv_nope/plugs").status_code == 404


class TestPlugCreateValidation:
    @pytest.mark.parametrize("body,code", [
        (_plug(top=5002, bottom=5000), 422),
        (_plug(top=9999, bottom=10001), 422),
        (_plug(t="cement"), 422),
        (_plug(name=""), 422),
        (_plug(name="X" * 41), 422),
        (_plug(top=-5), 422),
    ])
    def test_invalid(self, users, body, code):
        r = users["mgmt"].post(f"{API}/surveys/{SURVEY}/plugs", json=body)
        assert r.status_code == code, r.text

    def test_bottom_at_td_ok(self, users):
        r = users["mgmt"].post(f"{API}/surveys/{SURVEY}/plugs", json=_plug("TEST_TD", 9998, 10000))
        assert r.status_code == 200, r.text
        assert users["mgmt"].delete(f"{API}/plugs/{r.json()['plug_id']}").status_code == 200

    def test_guest_cannot_add(self, users):
        assert users["guest"].post(f"{API}/surveys/{SURVEY}/plugs", json=_plug()).status_code == 403

    def test_other_team_cannot_add(self, users):
        assert users["other"].post(f"{API}/surveys/{SURVEY}/plugs", json=_plug()).status_code == 404


class TestPlugCrudRbac:
    def test_crew_add_mgmt_edit_delete(self, users):
        # crew add
        r = users["crew"].post(f"{API}/surveys/{SURVEY}/plugs", json=_plug("  TEST_CREW  ", 3000, 3003))
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["name"] == "TEST_CREW" and p["plug_id"].startswith("plg_") and p["survey_id"] == SURVEY
        pid = p["plug_id"]
        # sorted by top
        lst = users["mgmt"].get(f"{API}/surveys/{SURVEY}/plugs").json()["plugs"]
        tops = [x["top_md_ft"] for x in lst]
        assert tops == sorted(tops) and pid in [x["plug_id"] for x in lst]
        # crew/guest can't edit/delete
        for k in ("crew", "guest"):
            assert users[k].put(f"{API}/plugs/{pid}", json=_plug("TEST_X", 3000, 3003)).status_code == 403
            assert users[k].delete(f"{API}/plugs/{pid}").status_code == 403
        # other team supervisor -> 404
        assert users["other"].put(f"{API}/plugs/{pid}", json=_plug("TEST_X", 3000, 3003)).status_code == 404
        assert users["other"].delete(f"{API}/plugs/{pid}").status_code == 404
        # mgmt edit invalid
        assert users["mgmt"].put(f"{API}/plugs/{pid}", json=_plug("TEST_E", 3000, 20000)).status_code == 422
        assert users["mgmt"].put(f"{API}/plugs/{pid}", json=_plug("TEST_E", 3010, 3000)).status_code == 422
        # mgmt edit ok
        r = users["mgmt"].put(f"{API}/plugs/{pid}", json=_plug("TEST_EDIT", 3100, 3105, "packer", None))
        assert r.status_code == 200 and r.json()["name"] == "TEST_EDIT"
        got = next(x for x in users["mgmt"].get(f"{API}/surveys/{SURVEY}/plugs").json()["plugs"] if x["plug_id"] == pid)
        assert got["top_md_ft"] == 3100 and got["plug_type"] == "packer" and got["notes"] is None
        # delete
        assert users["mgmt"].delete(f"{API}/plugs/{pid}").status_code == 200
        lst = users["mgmt"].get(f"{API}/surveys/{SURVEY}/plugs").json()["plugs"]
        assert pid not in [x["plug_id"] for x in lst]
        assert users["mgmt"].delete(f"{API}/plugs/{pid}").status_code == 404


class TestPlugRuns:
    def test_record_and_list(self, users):
        body = {"mode": "test", "speed": 100, "start_md_ft": 0, "end_md_ft": 10000, "duration_s": 60.6,
                "passes": [{"plug_id": "plg_x", "name": "P1", "depth_ft": 8402.3, "elapsed_s": 51.2}]}
        r = users["crew"].post(f"{API}/surveys/{SURVEY}/plug-runs", json=body)
        assert r.status_code == 200, r.text
        rid = r.json()["run_id"]
        runs = users["mgmt"].get(f"{API}/surveys/{SURVEY}/plug-runs").json()["runs"]
        assert len(runs) <= 10 and runs[0]["run_id"] == rid and runs[0]["passes"][0]["name"] == "P1"

    def test_guest_cannot_record(self, users):
        r = users["guest"].post(f"{API}/surveys/{SURVEY}/plug-runs", json={"start_md_ft": 0, "end_md_ft": 1, "duration_s": 1})
        assert r.status_code == 403

    def test_other_team_404(self, users):
        assert users["other"].get(f"{API}/surveys/{SURVEY}/plug-runs").status_code == 404
        assert users["mgmt"].post(f"{API}/surveys/{OTHER_TEAM_SURVEY}/plug-runs",
                                  json={"start_md_ft": 0, "end_md_ft": 1, "duration_s": 1}).status_code == 404

    def test_limit_10(self, users):
        for _ in range(11):
            users["crew"].post(f"{API}/surveys/{SURVEY}/plug-runs", json={"start_md_ft": 0, "end_md_ft": 1, "duration_s": 1})
        assert len(users["mgmt"].get(f"{API}/surveys/{SURVEY}/plug-runs").json()["runs"]) == 10
