# Team-shared channel config (order + custom names) on /live-ops: GET/PUT /api/team/channel-config
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MGMT_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"
TEAM = "team_5d808edd1dbb"
URL = f"{API}/team/channel-config"


def _sess(token):
    s = requests.Session()
    s.cookies.set("session_token", token)
    return s


@pytest.fixture(scope="module")
def users():
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    c = MongoClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    exp = datetime.now(timezone.utc) + timedelta(days=2)
    wid = os.environ.get("PYTEST_XDIST_WORKER", "gw")
    spec = {
        "crew": ("crew", TEAM), "guest": ("guest", TEAM),
        "supervisor": ("field_manager", TEAM), "other": ("field_manager", f"TEST_team_cc_{wid}"),
    }
    out = {}
    for k, (role, team) in spec.items():
        uid, tok = f"TEST_cc_{wid}_{k}", f"TEST_cc_tok_{wid}_{k}"
        db.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": f"test_cc_{wid}_{k}@example.com", "name": f"TEST {k}", "role": role,
            "team_id": team, "subscription_status": "active", "subscription_tier": "smallmed",
            "subscription_expires_at": exp + timedelta(days=3000), "created_at": datetime.now(timezone.utc)}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {
            "user_id": uid, "session_token": tok, "expires_at": exp, "created_at": datetime.now(timezone.utc)}}, upsert=True)
        out[k] = _sess(tok)
    out["mgmt"] = _sess(MGMT_TOKEN)
    yield out
    out["mgmt"].put(URL, json={"order": [], "names": {}})
    db.team_channel_config.delete_many({"team_id": f"TEST_team_cc_{wid}"})
    db.users.delete_many({"user_id": {"$regex": f"^TEST_cc_{wid}_"}})
    db.user_sessions.delete_many({"session_token": {"$regex": f"^TEST_cc_tok_{wid}_"}})
    c.close()


class TestTeamChannelConfig:
    def test_unauth_401(self):
        assert requests.get(URL).status_code == 401
        assert requests.put(URL, json={"order": [], "names": {}}).status_code == 401

    def test_get_shape(self, users):
        r = users["mgmt"].get(URL)
        assert r.status_code == 200
        d = r.json()
        for k in ("order", "names", "updated_by", "updated_at"):
            assert k in d
        assert "_id" not in d and "team_id" not in d

    def test_put_dedupe_trim_drop_empty(self, users):
        body = {"order": ["spp", "whp", "spp", "c1", "whp"], "names": {"spp": "  Pump P  ", "whp": "   ", "c1": ""}}
        r = users["mgmt"].put(URL, json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["order"] == ["spp", "whp", "c1"]
        assert d["names"] == {"spp": "Pump P"}
        assert d["updated_by"] == "demo.pro@example.com" and d["updated_at"]
        assert "team_id" not in d
        g = users["mgmt"].get(URL).json()
        assert g["order"] == ["spp", "whp", "c1"] and g["names"] == {"spp": "Pump P"}

    def test_name_too_long_422(self, users):
        r = users["mgmt"].put(URL, json={"order": [], "names": {"spp": "x" * 41}})
        assert r.status_code == 422
        r = users["mgmt"].put(URL, json={"order": [], "names": {"spp": "x" * 40}})
        assert r.status_code == 200 and r.json()["names"]["spp"] == "x" * 40

    def test_bad_types_422(self, users):
        assert users["mgmt"].put(URL, json={"order": "spp", "names": {}}).status_code == 422
        assert users["mgmt"].put(URL, json={"order": [], "names": ["a"]}).status_code == 422

    def test_shared_with_crew_but_crew_cannot_write(self, users):
        users["mgmt"].put(URL, json={"order": ["whp", "spp"], "names": {"whp": "Wellhead A"}})
        g = users["crew"].get(URL).json()
        assert g["order"] == ["whp", "spp"] and g["names"] == {"whp": "Wellhead A"}
        r = users["crew"].put(URL, json={"order": ["spp", "whp"], "names": {"spp": "Crew Name"}})
        assert r.status_code == 403
        g = users["mgmt"].get(URL).json()
        assert g["order"] == ["whp", "spp"] and g["names"] == {"whp": "Wellhead A"}

    def test_supervisor_can_write(self, users):
        r = users["supervisor"].put(URL, json={"order": ["whp"], "names": {}})
        assert r.status_code == 200, r.text
        assert r.json()["updated_by"].startswith("test_cc_")

    def test_guest_can_read_but_403_on_write(self, users):
        assert users["guest"].get(URL).status_code == 200
        r = users["guest"].put(URL, json={"order": [], "names": {}})
        assert r.status_code == 403
        assert users["mgmt"].get(URL).json()["names"] == {"spp": "Crew Name"}

    def test_isolated_per_team(self, users):
        g = users["other"].get(URL).json()
        assert g["order"] == [] and g["names"] == {}
        users["other"].put(URL, json={"order": ["x"], "names": {"x": "Other"}})
        assert users["mgmt"].get(URL).json()["names"] == {"spp": "Crew Name"}
        assert users["other"].get(URL).json()["names"] == {"x": "Other"}

    def test_reset(self, users):
        r = users["mgmt"].put(URL, json={"order": [], "names": {}})
        assert r.status_code == 200
        g = users["mgmt"].get(URL).json()
        assert g["order"] == [] and g["names"] == {}
