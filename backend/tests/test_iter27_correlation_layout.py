# Depth correlation (per survey, shared per team) + per-user operator channel layout
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MGMT_TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"
SURVEY = "srv_705200a70a31"
OTHER_TEAM_SURVEY = "srv_c2acb5c12743"
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
    yield c[env["DB_NAME"]]
    c.close()


@pytest.fixture(scope="module")
def users(mongo):
    exp = datetime.now(timezone.utc) + timedelta(days=2)
    spec = {"crew": ("crew", TEAM), "guest": ("guest", TEAM), "other": ("field_manager", "team_9af2d0d38747")}
    out = {}
    wid = os.environ.get("PYTEST_XDIST_WORKER", "gw")  # per-worker users: xdist loadscope splits classes
    for k, (role, team) in spec.items():
        uid, tok = f"TEST_cor_{wid}_{k}", f"TEST_cor_tok_{wid}_{k}"
        mongo.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": f"test_cor_{wid}_{k}@example.com", "name": f"TEST {k}", "role": role,
            "team_id": team, "subscription_status": "active", "subscription_tier": "smallmed",
            "subscription_expires_at": exp + timedelta(days=3000), "created_at": datetime.now(timezone.utc)}}, upsert=True)
        mongo.user_sessions.update_one({"session_token": tok}, {"$set": {
            "user_id": uid, "session_token": tok, "expires_at": exp, "created_at": datetime.now(timezone.utc)}}, upsert=True)
        out[k] = _sess(tok)
    out["mgmt"] = _sess(MGMT_TOKEN)
    orig_layout = out["mgmt"].get(f"{API}/me/operator-layout").json()
    yield out
    # restore offset 0 / layout
    out["mgmt"].post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 0, "move_target": "ct_string", "reason": "reset"})
    out["mgmt"].put(f"{API}/me/operator-layout", json={"active_sets": ["Pressures"], "hidden": [], "custom": orig_layout.get("custom") or []})
    mongo.users.delete_many({"user_id": {"$regex": f"^TEST_cor_{wid}_"}})
    mongo.user_sessions.delete_many({"session_token": {"$regex": f"^TEST_cor_tok_{wid}_"}})
    mongo.operator_layouts.delete_many({"email": {"$regex": f"^test_cor_{wid}_"}})


class TestCorrelation:
    def test_get_shape(self, users):
        r = users["mgmt"].get(f"{API}/surveys/{SURVEY}/correlation")
        assert r.status_code == 200
        d = r.json()
        for k in ("offset_ft", "move_target", "updated_by", "updated_at", "log"):
            assert k in d
        assert isinstance(d["log"], list) and len(d["log"]) <= 20

    def test_post_and_persist_and_log(self, users):
        s = users["mgmt"]
        s.post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 0, "reason": "reset"})
        r = s.post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 12.345, "move_target": "ct_string", "reason": "manual"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["offset_ft"] == 12.35 and d["updated_by"] == "demo.pro@example.com"
        assert "team_id" not in d and "_id" not in d["entry"]
        e = d["entry"]
        assert e["prev_offset_ft"] == 0 and e["reason"] == "manual" and e["by"] == "demo.pro@example.com" and e["by_name"] and e["at"]
        g = s.get(f"{API}/surveys/{SURVEY}/correlation").json()
        assert g["offset_ft"] == 12.35 and g["move_target"] == "ct_string"
        assert g["log"][0]["entry_id"] == e["entry_id"]
        assert all("_id" not in x for x in g["log"])

    def test_tag_entry_fields(self, users):
        s = users["mgmt"]
        body = {"offset_ft": -3.5, "move_target": "plugs", "reason": "tag", "plug_id": "plg_x", "plug_name": "P1", "plug_md_ft": 8400, "counter_ft": 8403.5}
        d = s.post(f"{API}/surveys/{SURVEY}/correlation", json=body).json()
        assert d["move_target"] == "plugs"
        assert d["entry"]["plug_name"] == "P1" and d["entry"]["counter_ft"] == 8403.5 and d["entry"]["prev_offset_ft"] == 12.35

    def test_shared_with_crew_and_crew_can_post(self, users):
        g = users["crew"].get(f"{API}/surveys/{SURVEY}/correlation").json()
        assert g["offset_ft"] == -3.5 and g["move_target"] == "plugs"
        r = users["crew"].post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 1, "reason": "nudge"})
        assert r.status_code == 200
        assert users["mgmt"].get(f"{API}/surveys/{SURVEY}/correlation").json()["updated_by"] .endswith("_crew@example.com")

    def test_guest_forbidden(self, users):
        r = users["guest"].post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 1})
        assert r.status_code == 403

    def test_log_newest_first_max20(self, users):
        s = users["mgmt"]
        for i in range(22):
            s.post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": i, "reason": "nudge"})
        log = s.get(f"{API}/surveys/{SURVEY}/correlation").json()["log"]
        assert len(log) == 20
        assert log[0]["offset_ft"] == 21
        assert [x["at"] for x in log] == sorted([x["at"] for x in log], reverse=True)

    @pytest.mark.parametrize("body", [{"offset_ft": 5001}, {"offset_ft": -5001}, {"offset_ft": 1, "reason": "bogus"},
                                      {"offset_ft": 1, "move_target": "x"}, {}])
    def test_validation(self, users, body):
        assert users["mgmt"].post(f"{API}/surveys/{SURVEY}/correlation", json=body).status_code == 422

    def test_bounds_ok(self, users):
        assert users["mgmt"].post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 5000}).status_code == 200
        assert users["mgmt"].post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": -5000}).status_code == 200

    def test_team_isolation(self, users):
        assert users["mgmt"].get(f"{API}/surveys/{OTHER_TEAM_SURVEY}/correlation").status_code == 404
        assert users["other"].get(f"{API}/surveys/{SURVEY}/correlation").status_code == 404
        assert users["other"].post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 1}).status_code == 404
        assert users["mgmt"].get(f"{API}/surveys/srv_nope/correlation").status_code == 404

    def test_unauth(self):
        assert requests.get(f"{API}/surveys/{SURVEY}/correlation").status_code == 401

    def test_reset(self, users):
        d = users["mgmt"].post(f"{API}/surveys/{SURVEY}/correlation", json={"offset_ft": 0, "move_target": "ct_string", "reason": "reset"}).json()
        assert d["offset_ft"] == 0


class TestLayout:
    def test_default_for_new_user(self, users):
        d = users["crew"].get(f"{API}/me/operator-layout").json()
        assert d["active_sets"] is None and d["hidden"] == [] and d["custom"] == []

    def test_put_and_get_per_user(self, users):
        body = {"active_sets": ["Pressures", "N2"], "hidden": ["whp"], "custom": [{"id": "c1", "title": "TEST", "group": "Custom"}]}
        r = users["crew"].put(f"{API}/me/operator-layout", json=body)
        assert r.status_code == 200 and "_id" not in r.json()
        g = users["crew"].get(f"{API}/me/operator-layout").json()
        assert g["active_sets"] == ["Pressures", "N2"] and g["hidden"] == ["whp"] and g["custom"][0]["id"] == "c1"
        assert "_id" not in g
        # isolated per user
        assert users["guest"].get(f"{API}/me/operator-layout").json()["hidden"] == []

    def test_validation(self, users):
        assert users["crew"].put(f"{API}/me/operator-layout", json={"active_sets": "x"}).status_code == 422
        assert users["crew"].put(f"{API}/me/operator-layout", json={"hidden": [str(i) for i in range(101)]}).status_code == 422

    def test_unauth(self):
        assert requests.get(f"{API}/me/operator-layout").status_code == 401
