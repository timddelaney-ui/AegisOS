import io
import os
import sys
from pathlib import Path

import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "test_r2")
import server
from services import r2_storage


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, *, Bucket, Key, Body, ContentType):
        self.objects[(Bucket, Key)] = (Body, ContentType)

    def get_object(self, *, Bucket, Key):
        data, content_type = self.objects[(Bucket, Key)]
        return {"Body": io.BytesIO(data), "ContentType": content_type}


@pytest.fixture
def api(monkeypatch):
    mongo = AsyncMongoMockClient().r2_test
    fake = FakeS3()
    monkeypatch.setattr(server, "db", mongo)
    monkeypatch.setenv("ATTACHMENT_STORAGE_BACKEND", "r2")
    monkeypatch.setattr(r2_storage, "_client_and_bucket", lambda: (fake, "private-bucket"))

    async def user(x_team: str = Header(default="one")):
        return {"team_id": x_team, "user_id": "user_" + x_team, "email": x_team + "@example.test", "role": "crew"}

    async def approval(**kwargs):
        return None

    monkeypatch.setattr(server, "_consume_hitl_approval", approval)
    app = FastAPI()
    app.include_router(server.api_router)
    app.dependency_overrides[server.require_user] = user
    app.dependency_overrides[server.get_current_user] = user
    with TestClient(app) as client:
        yield client, fake


@pytest.mark.parametrize("kind", ["attachments", "documents"])
def test_private_upload_download_and_cross_team_access(api, kind):
    client, fake = api
    form = {"context": "equipment"} if kind == "attachments" else {"name": "Procedure", "category": "sop"}
    response = client.post(f"/api/{kind}", data=form, files={"file": ("sample.pdf", b"private pdf", "application/pdf")})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["storage_backend"] == "r2"
    assert len(fake.objects) == 1
    download = client.get(result["download_url"])
    assert download.status_code == 200
    assert download.content == b"private pdf"
    assert download.headers["content-type"] == "application/pdf"
    denied = client.get(result["download_url"], headers={"x-team": "two"})
    assert denied.status_code == 403


def test_missing_r2_configuration_fails_closed(monkeypatch):
    r2_storage._client_and_bucket.cache_clear()
    monkeypatch.setenv("R2_ENDPOINT_URL", "http://example.test")
    monkeypatch.delenv("R2_SECRET_ACCESS_KEY", raising=False)
    with pytest.raises(r2_storage.StorageConfigurationError):
        r2_storage.put_object("path", b"data", "application/pdf")
    r2_storage._client_and_bucket.cache_clear()


def test_s3_request_format_and_content_type(monkeypatch):
    r2_storage._client_and_bucket.cache_clear()
    monkeypatch.setenv("R2_ENDPOINT_URL", "https://example.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_BUCKET_NAME", "private-bucket")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    client, bucket = r2_storage._client_and_bucket()
    with Stubber(client) as stub:
        stub.add_response("put_object", {}, {
            "Bucket": bucket, "Key": "team/file.pdf", "Body": b"pdf", "ContentType": "application/pdf",
        })
        stub.add_response("get_object", {
            "Body": StreamingBody(io.BytesIO(b"pdf"), 3), "ContentType": "application/pdf",
        }, {"Bucket": bucket, "Key": "team/file.pdf"})
        assert r2_storage.put_object("team/file.pdf", b"pdf", "application/pdf")["storage_backend"] == "r2"
        assert r2_storage.get_object("team/file.pdf") == (b"pdf", "application/pdf")
    r2_storage._client_and_bucket.cache_clear()


def test_legacy_objects_use_legacy_provider_after_switch(monkeypatch):
    class Response:
        status_code = 200
        content = b"old file"
        headers = {"Content-Type": "application/pdf"}

        def raise_for_status(self):
            pass

    monkeypatch.setenv("ATTACHMENT_STORAGE_BACKEND", "r2")
    monkeypatch.setattr(server, "init_storage", lambda: "legacy-key")
    monkeypatch.setattr(server.requests, "get", lambda *args, **kwargs: Response())
    assert server._get_object("old/path") == (b"old file", "application/pdf")


def test_unknown_backend_does_not_fall_back(monkeypatch):
    monkeypatch.setenv("ATTACHMENT_STORAGE_BACKEND", "typo")
    with pytest.raises(server.HTTPException) as exc:
        server._put_object("path", b"data", "application/pdf")
    assert exc.value.status_code == 503
