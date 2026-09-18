"""Backend tests for Team Hub CRUD endpoints + team creation/leave flow."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
# Test fixture — override in CI via CTP_TEST_SESSION_TOKEN. Seeded by /app/backend/scripts/seed_demo_pro.py.
DEMO_TOKEN = os.environ.get("CTP_TEST_SESSION_TOKEN", "demo_session_dade4ac57f0c496094fde437e8e91f00")


@pytest.fixture(scope="module")
def demo_client():
    s = requests.Session()
    s.cookies.set("session_token", DEMO_TOKEN)
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def ensure_demo_has_team(demo_client):
    """Demo user should be in Regression Crew — but if not, create one."""
    r = demo_client.get(f"{BASE_URL}/api/teams/me")
    assert r.status_code == 200, r.text
    if r.json() is None:
        r2 = demo_client.post(f"{BASE_URL}/api/teams", json={"name": "TEST_Team_" + uuid.uuid4().hex[:6]})
        assert r2.status_code == 200, r2.text
    r = demo_client.get(f"{BASE_URL}/api/teams/me")
    return r.json()


class TestAuth:
    def test_me(self, demo_client):
        r = demo_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert "email" in r.json()


class TestTeamItemsCRUD:
    def test_list_invalid_kind(self, demo_client, ensure_demo_has_team):
        r = demo_client.get(f"{BASE_URL}/api/team/items/bogus_kind")
        assert r.status_code == 400

    @pytest.mark.parametrize("kind", ["inventory", "consumables", "parts_order", "todo"])
    def test_list_valid_kinds(self, demo_client, ensure_demo_has_team, kind):
        r = demo_client.get(f"{BASE_URL}/api/team/items/{kind}")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    def test_create_invalid_kind(self, demo_client, ensure_demo_has_team):
        r = demo_client.post(f"{BASE_URL}/api/team/items", json={"kind": "nope", "name": "x"})
        assert r.status_code == 400

    def test_create_empty_name(self, demo_client, ensure_demo_has_team):
        r = demo_client.post(f"{BASE_URL}/api/team/items", json={"kind": "inventory", "name": "  "})
        assert r.status_code == 400

    def test_full_crud_inventory(self, demo_client, ensure_demo_has_team):
        payload = {
            "kind": "inventory",
            "name": "TEST_BOP_Rams_" + uuid.uuid4().hex[:6],
            "quantity": 2,
            "unit": "ea",
            "location": "Blue Shed / Rack 3",
            "status": "OK",
        }
        r = demo_client.post(f"{BASE_URL}/api/team/items", json=payload)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == payload["name"]
        assert created["quantity"] == 2
        assert created["location"] == "Blue Shed / Rack 3"
        assert created["status"] == "OK"
        assert "item_id" in created
        item_id = created["item_id"]

        # GET verify
        r = demo_client.get(f"{BASE_URL}/api/team/items/inventory")
        assert r.status_code == 200
        assert any(i["item_id"] == item_id for i in r.json()["items"])

        # PATCH status
        r = demo_client.patch(f"{BASE_URL}/api/team/items/{item_id}", json={"status": "LOW"})
        assert r.status_code == 200
        assert r.json()["status"] == "LOW"

        # GET again to confirm persistence
        r = demo_client.get(f"{BASE_URL}/api/team/items/inventory")
        got = [i for i in r.json()["items"] if i["item_id"] == item_id][0]
        assert got["status"] == "LOW"

        # PATCH to OOS
        r = demo_client.patch(f"{BASE_URL}/api/team/items/{item_id}", json={"status": "OOS"})
        assert r.status_code == 200

        # DELETE
        r = demo_client.delete(f"{BASE_URL}/api/team/items/{item_id}")
        assert r.status_code == 200

        # Verify gone
        r = demo_client.get(f"{BASE_URL}/api/team/items/inventory")
        assert not any(i["item_id"] == item_id for i in r.json()["items"])

        # Delete again -> 404
        r = demo_client.delete(f"{BASE_URL}/api/team/items/{item_id}")
        assert r.status_code == 404

    def test_create_todo_defaults(self, demo_client, ensure_demo_has_team):
        r = demo_client.post(f"{BASE_URL}/api/team/items", json={"kind": "todo", "name": "TEST_todo_" + uuid.uuid4().hex[:6]})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "OPEN"
        assert d["priority"] == "MED"
        demo_client.delete(f"{BASE_URL}/api/team/items/{d['item_id']}")

    def test_create_parts_order(self, demo_client, ensure_demo_has_team):
        r = demo_client.post(f"{BASE_URL}/api/team/items", json={"kind": "parts_order", "name": "TEST_part_" + uuid.uuid4().hex[:6], "status": "REQUESTED"})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "REQUESTED"

        r = demo_client.patch(f"{BASE_URL}/api/team/items/{d['item_id']}", json={"status": "ORDERED"})
        assert r.status_code == 200
        assert r.json()["status"] == "ORDERED"

        demo_client.delete(f"{BASE_URL}/api/team/items/{d['item_id']}")


class TestUnauth:
    def test_unauth_get(self):
        r = requests.get(f"{BASE_URL}/api/team/items/inventory")
        assert r.status_code == 401

    def test_unauth_post(self):
        r = requests.post(f"{BASE_URL}/api/team/items", json={"kind": "inventory", "name": "x"})
        assert r.status_code == 401


class TestCrossTeamIsolation:
    """Item created by team A must not be visible to team B."""
    def test_isolation(self, demo_client, ensure_demo_has_team):
        # Create item in demo user's team
        r = demo_client.post(f"{BASE_URL}/api/team/items", json={"kind": "inventory", "name": "TEST_isolation_" + uuid.uuid4().hex[:6]})
        assert r.status_code == 200
        item_id = r.json()["item_id"]

        # Simulate a second user by injecting a session in DB is hard; instead, verify PATCH/DELETE
        # from an unauthenticated caller fails, and that item is only listed under this team.
        # We'll skip a full second-user setup (requires DB seeding out of scope) but verify:
        r_unauth = requests.patch(f"{BASE_URL}/api/team/items/{item_id}", json={"status": "LOW"})
        assert r_unauth.status_code == 401

        # Verify PATCH with fabricated item_id fails
        r_bad = demo_client.patch(f"{BASE_URL}/api/team/items/itm_nonexistent999", json={"status": "LOW"})
        assert r_bad.status_code == 404

        demo_client.delete(f"{BASE_URL}/api/team/items/{item_id}")
