import io
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routes import documents as docs


def test_validate_upload():
    assert docs.validate_upload("A.PDF", 10) == "pdf"
    for name in ("a.png", "a.jpg", "a.jpeg", "a.webp"):
        docs.validate_upload(name, 1)
    with pytest.raises(HTTPException) as e:
        docs.validate_upload("evil.exe", 10)
    assert e.value.status_code == 415
    with pytest.raises(HTTPException) as e:
        docs.validate_upload("big.pdf", 25 * 1024 * 1024 + 1)
    assert e.value.status_code == 413
    docs.validate_upload("ok.pdf", 25 * 1024 * 1024)


def test_save_local_creates_org_dir_and_blocks_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(docs, "UPLOAD_ROOT", tmp_path / "uploads")
    res = docs.save_local("org/../x", "doc_1", "pdf", b"%PDF-1.4")
    assert (tmp_path / "uploads" / res["path"]).read_bytes() == b"%PDF-1.4"
    assert docs.read_local(res["path"])[1] == "application/pdf"
    with pytest.raises(HTTPException):
        docs.read_local("../../etc/passwd")


def test_file_preview_is_org_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr(docs, "UPLOAD_ROOT", tmp_path / "uploads")
    saved = docs.save_local("t1", "doc_1", "png", b"\x89PNG")
    rec = {"doc_id": "doc_1", "team_id": "t1", "filename": "a.png", "content_type": "image/png",
           "storage_path": saved["path"], "storage_backend": "local"}

    class Col:
        async def find_one(self, q, p=None):
            return rec if q["doc_id"] == "doc_1" else None

    db = SimpleNamespace(company_documents=Col(), user_sessions=Col(), users=Col())
    current = {"u": {"user_id": "u", "team_id": "t1"}}

    async def get_user():
        return current["u"]

    app = FastAPI()
    app.include_router(docs.build_router(db=db, get_current_user=get_user, get_object=lambda p, b: docs.read_local(p),
                                         is_admin=lambda u: False), prefix="/api")
    c = TestClient(app)
    r = c.get("/api/documents/doc_1/file")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["content-disposition"].startswith("inline")
    assert c.get("/api/documents/nope/file").status_code == 404
    current["u"] = {"user_id": "z", "team_id": "other"}
    assert c.get("/api/documents/doc_1/file").status_code == 403


def test_multipart_endpoint_accepts_valid_form():
    # Guards the python-multipart dependency: a valid multipart upload must not 422/500.
    from fastapi import File, Form, UploadFile
    app = FastAPI()

    @app.post("/u")
    async def u(file: UploadFile = File(...), name: str = Form(...)):
        data = await file.read()
        return {"ext": docs.validate_upload(file.filename, len(data))}

    c = TestClient(app)
    assert c.post("/u", files={"file": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")}, data={"name": "n"}).json() == {"ext": "pdf"}
    assert c.post("/u", files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")}, data={"name": "n"}).status_code == 415
