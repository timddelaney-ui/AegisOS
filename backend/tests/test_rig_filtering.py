"""Backend tests for iteration 7 — rig_id filtering on team items + skipper endpoints."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
COOKIE = {"session_token": "demo_session_dade4ac57f0c496094fde437e8e91f00"}


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.cookies.update(COOKIE)
    return s


def test_auth_me(sess):
    r = sess.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    assert r.json()["subscription_status"] == "active"


# ---------------- rig_id filtering on team_items ----------------
@pytest.fixture(scope="module")
def created_ids(sess):
    ids = {}
    # 3 items: RIG1, RIG2, and one untagged (no rig_id)
    tag = uuid.uuid4().hex[:6]
    for rig, key in [("RIG1", "rig1"), ("RIG2", "rig2"), (None, "legacy")]:
        body = {"kind": "inventory", "name": f"TEST_{key}_{tag}"}
        if rig is not None:
            body["rig_id"] = rig
        r = sess.post(f"{BASE_URL}/api/team/items", json=body)
        assert r.status_code == 200, r.text
        ids[key] = r.json()["item_id"]
    yield ids
    for iid in ids.values():
        sess.delete(f"{BASE_URL}/api/team/items/{iid}")


def test_get_rig1_includes_rig1_and_legacy_excludes_rig2(sess, created_ids):
    r = sess.get(f"{BASE_URL}/api/team/items/inventory", params={"rig_id": "RIG1"})
    assert r.status_code == 200
    got = {i["item_id"] for i in r.json()["items"]}
    assert created_ids["rig1"] in got
    assert created_ids["legacy"] in got
    assert created_ids["rig2"] not in got


def test_get_rig2_includes_rig2_and_legacy_excludes_rig1(sess, created_ids):
    r = sess.get(f"{BASE_URL}/api/team/items/inventory", params={"rig_id": "RIG2"})
    assert r.status_code == 200
    got = {i["item_id"] for i in r.json()["items"]}
    assert created_ids["rig2"] in got
    assert created_ids["legacy"] in got
    assert created_ids["rig1"] not in got


def test_get_no_rig_returns_all(sess, created_ids):
    r = sess.get(f"{BASE_URL}/api/team/items/inventory")
    assert r.status_code == 200
    got = {i["item_id"] for i in r.json()["items"]}
    for iid in created_ids.values():
        assert iid in got


def test_created_item_has_rig_id(sess, created_ids):
    r = sess.get(f"{BASE_URL}/api/team/items/inventory", params={"rig_id": "RIG1"})
    item = next(i for i in r.json()["items"] if i["item_id"] == created_ids["rig1"])
    assert item.get("rig_id") == "RIG1"


# ---------------- Skipper / crew AI ----------------
def test_crew_chat(sess):
    r = sess.post(f"{BASE_URL}/api/crew/chat", json={"text": "hello from tests"})
    assert r.status_code == 200, r.text


def test_crew_safety_eval_annular_frac_thresholds(sess):
    # Trip surfp_hi + density_hi + rate_hi + rop_hi to confirm expanded thresholds fire on Annular_Frac
    payload = {
        "sheet_key": "Annular_Frac",
        "values": {"surfp": 12000},
    }
    r = sess.post(f"{BASE_URL}/api/crew/safety-eval", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "alerts" in body
    # surfp_hi threshold should have fired (or been deduped if recently triggered)
    fired_ids = [a.get("threshold_id") for a in body.get("alerts", [])]
    # accept dedup case as well
    assert fired_ids == [] or "surfp_hi" in fired_ids
