# Iter 28: PUT /api/me/operator-layout validates custom channels (CustomChannel model)
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TOKEN = "demo_session_dade4ac57f0c496094fde437e8e91f00"


@pytest.fixture(scope="module")
def s():
    x = requests.Session()
    x.cookies.set("session_token", TOKEN)
    orig = x.get(f"{API}/me/operator-layout").json()
    yield x
    x.put(f"{API}/me/operator-layout", json={"active_sets": ["Pressures"], "hidden": [], "custom": orig.get("custom") or []})


class TestLayoutCustom:
    def test_valid_custom_unknown_keys_dropped(self, s):
        body = {"active_sets": ["Pressures", "Custom"], "hidden": [], "custom": [
            {"id": "TEST_c1", "title": "TEST Chan", "group": "Custom", "warn": 5000, "crit": 8000, "evil": "x", "nested": {"a": 1}}]}
        r = s.put(f"{API}/me/operator-layout", json=body)
        assert r.status_code == 200, r.text
        c = r.json()["custom"][0]
        assert "evil" not in c and "nested" not in c
        assert c["title"] == "TEST Chan" and c["warn"] == 5000 and c["dim"] == "pressure"
        g = s.get(f"{API}/me/operator-layout").json()
        assert g["custom"][0]["id"] == "TEST_c1" and "evil" not in g["custom"][0]

    @pytest.mark.parametrize("bad", [
        {"id": "a", "group": "Custom"},
        {"title": "t", "group": "Custom"},
        {"id": "a", "title": "t"},
        {"id": "a", "title": "", "group": "Custom"},
        {"id": "a", "title": "x" * 61, "group": "Custom"},
        {"id": "a", "title": "t", "group": "Custom", "dim": "temp"},
        {"id": "a", "title": "t", "group": "Custom", "warn": "abc"},
    ])
    def test_invalid_custom_422(self, s, bad):
        r = s.put(f"{API}/me/operator-layout", json={"active_sets": [], "hidden": [], "custom": [bad]})
        assert r.status_code == 422, r.text

    def test_too_many_custom(self, s):
        cs = [{"id": f"c{i}", "title": "t", "group": "g"} for i in range(51)]
        r = s.put(f"{API}/me/operator-layout", json={"active_sets": [], "hidden": [], "custom": cs})
        assert r.status_code == 422

    def test_unauth(self):
        r = requests.put(f"{API}/me/operator-layout", json={"active_sets": [], "hidden": [], "custom": []})
        assert r.status_code == 401
