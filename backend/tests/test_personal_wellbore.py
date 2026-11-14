import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from phase1_modules import register_phase1
from plugs_module import build_router


@pytest.fixture
def api():
    users = {
        "alice": {"user_id": "alice", "email": "alice@example.test", "role": "crew"},
        "bob": {"user_id": "bob", "email": "bob@example.test", "role": "crew"},
        "manager": {"user_id": "manager", "email": "manager@example.test", "role": "ops_manager", "team_id": "team_one"},
        "crew": {"user_id": "crew", "email": "crew@example.test", "role": "crew", "team_id": "team_one"},
    }

    async def require_user(x_user: str = Header(default="alice")):
        if x_user not in users:
            raise HTTPException(401, "Not authenticated")
        return users[x_user]

    db = AsyncMongoMockClient().wellbore
    app = FastAPI()
    register_phase1(app, db, require_user, require_user, lambda user: False)
    app.include_router(build_router(require_user, db))
    with TestClient(app) as client:
        yield client, users


def upload(client, user="alice"):
    response = client.post(
        "/surveys/upload",
        headers={"x-user": user},
        data={"well_name": "Test well"},
        files={"file": ("survey.csv", b"md_ft,inc_deg,azi_deg\n0,0,0\n1000,0,0\n2000,90,90\n", "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()["survey_id"]


def test_solo_owner_can_save_activate_and_manage_well_records(api):
    client, _ = api
    survey = upload(client)
    assert client.post(f"/surveys/{survey}/activate").status_code == 200
    assert client.get("/surveys").json()["active_survey_id"] == survey
    plug = client.post(f"/surveys/{survey}/plugs", json={
        "name": "P1", "top_md_ft": 1500, "bottom_md_ft": 1505,
    })
    assert plug.status_code == 200, plug.text
    plug_id = plug.json()["plug_id"]
    assert client.get(f"/surveys/{survey}/plugs").json()["can_edit"] is True
    assert client.put(f"/plugs/{plug_id}", json={
        "name": "P1 edited", "top_md_ft": 1501, "bottom_md_ft": 1506,
    }).status_code == 200
    assert client.post(f"/surveys/{survey}/correlation", json={"offset_ft": 12}).status_code == 200
    assert client.get(f"/surveys/{survey}/correlation").json()["offset_ft"] == 12
    assert client.post(f"/surveys/{survey}/plug-runs", json={
        "start_md_ft": 0, "end_md_ft": 1800, "duration_s": 10,
    }).status_code == 200
    assert len(client.get(f"/surveys/{survey}/plug-runs").json()["runs"]) == 1
    assert client.delete(f"/surveys/{survey}").status_code == 200
    assert client.get(f"/surveys/{survey}/plugs").status_code == 404


def test_private_wells_stay_private_and_access_survives_joining_a_team(api):
    client, users = api
    survey = upload(client)
    plug = client.post(f"/surveys/{survey}/plugs", json={
        "name": "P1", "top_md_ft": 1500, "bottom_md_ft": 1505,
    }).json()
    for other in ("bob", "manager"):
        headers = {"x-user": other}
        assert client.get("/surveys", headers=headers).json()["surveys"] == []
        assert client.get(f"/surveys/{survey}", headers=headers).status_code == 404
        assert client.get(f"/surveys/{survey}/plugs", headers=headers).status_code == 404
        assert client.delete(f"/plugs/{plug['plug_id']}", headers=headers).status_code == 404
        assert client.post(f"/surveys/{survey}/correlation", headers=headers, json={"offset_ft": 10}).status_code == 404
    users["alice"]["team_id"] = "team_one"
    assert client.get(f"/surveys/{survey}").status_code == 200
    assert client.post(f"/surveys/{survey}/activate").status_code == 200
    assert client.delete(f"/plugs/{plug['plug_id']}").status_code == 200
    assert client.get(f"/surveys/{survey}", headers={"x-user": "manager"}).status_code == 404


def test_existing_shared_team_permissions_are_preserved(api):
    client, _ = api
    survey = upload(client, "manager")
    assert client.get(f"/surveys/{survey}", headers={"x-user": "crew"}).status_code == 200
    assert client.post(f"/surveys/{survey}/plugs", headers={"x-user": "crew"}, json={
        "name": "P1", "top_md_ft": 1500, "bottom_md_ft": 1505,
    }).status_code == 403
    assert client.get(f"/surveys/{survey}/plugs", headers={"x-user": "crew"}).json()["can_edit"] is False
    assert client.get(f"/surveys/{survey}", headers={"x-user": "bob"}).status_code == 404


def test_pdf_upload_is_rejected_and_personal_channel_names_are_isolated(api):
    client, _ = api
    response = client.post("/surveys/upload", data={"well_name": "Invalid file"},
                           files={"file": ("program.pdf", b"%PDF", "application/pdf")})
    assert response.status_code == 400
    assert "PDF" in response.json()["detail"]
    assert client.put("/team/channel-config", json={"order": ["whp"], "names": {"whp": "My pressure"}}).status_code == 200
    assert client.get("/team/channel-config", headers={"x-user": "bob"}).json()["names"] == {}


@pytest.mark.parametrize("rows", [
    b"0,0,0\n0,90,90\n",
    b"0,0,0\n1000,nan,90\n",
])
def test_invalid_survey_geometry_is_rejected_before_saving(api, rows):
    client, _ = api
    response = client.post("/surveys/upload", data={"well_name": "Invalid path"},
                           files={"file": ("survey.csv", b"md_ft,inc_deg,azi_deg\n" + rows, "text/csv")})
    assert response.status_code == 400
    assert client.get("/surveys").json()["surveys"] == []
