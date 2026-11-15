import ast
from pathlib import Path


def test_server_parses_and_google_routes_present():
    src = (Path(__file__).resolve().parents[1] / "server.py").read_text()
    ast.parse(src)
    for route in ("/auth/google/login", "/auth/google/callback", "/auth/config"):
        assert route in src
    assert "_finish_login(" in src and "_llm_reply(" in src


def test_google_callback_hands_off_a_one_time_bearer_token(monkeypatch):
    import os
    import sys
    from urllib.parse import parse_qs, urlparse

    from fastapi.testclient import TestClient
    from mongomock_motor import AsyncMongoMockClient

    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import server

    db = AsyncMongoMockClient().auth_test
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "GOOGLE_CLIENT_ID", "client")
    monkeypatch.setattr(server, "GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setattr(server, "PUBLIC_APP_URL", "https://app.example")
    monkeypatch.setattr(server, "PUBLIC_API_URL", "https://api.example")

    class FakeResp:
        def __init__(self, data):
            self.status_code, self._data = 200, data

        def json(self):
            return self._data

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return FakeResp({"access_token": "google-token"})

        async def get(self, *a, **k):
            return FakeResp({"email": "crew@example.test", "email_verified": True, "name": "Crew"})

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)

    # Plain http client: the Secure session cookie is never sent back, as with a
    # browser that blocks the API's cookie as third-party.
    client = TestClient(server.app, base_url="http://api.example")
    login = client.get("/api/auth/google/login", follow_redirects=False)
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    client.cookies.set("oauth_state", state.split(".")[0])
    cb = client.get(f"/api/auth/google/callback?code=c&state={state}", follow_redirects=False)
    location = cb.headers["location"]
    assert location.startswith("https://app.example/#auth_code=")
    code = location.split("auth_code=")[1]
    client.cookies.clear()

    exchanged = client.post("/api/auth/google/exchange", json={"code": code})
    assert exchanged.status_code == 200, exchanged.text
    body = exchanged.json()
    assert body["email"] == "crew@example.test"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['session_token']}"})
    assert me.status_code == 200 and me.json()["email"] == "crew@example.test"

    assert client.post("/api/auth/google/exchange", json={"code": code}).status_code == 401
    # A stale cookie must not mask a valid Bearer token.
    client.cookies.set("session_token", "stale")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['session_token']}"}).status_code == 200
