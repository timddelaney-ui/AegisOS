import os
from types import SimpleNamespace

from fastapi.testclient import TestClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test")

import server


class PaymentTransactions:
    def __init__(self, record):
        self.record = record

    async def find_one(self, query, projection=None):
        if query.get("session_id") == self.record.get("session_id"):
            return self.record
        return None


def _set_user(monkeypatch, user):
    async def require_user():
        return user

    monkeypatch.setitem(server.app.dependency_overrides, server.require_user, require_user)


def test_payment_status_requires_authentication(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(payment_transactions=PaymentTransactions({"session_id": "I-1"})),
    )

    response = TestClient(server.app).get("/api/payments/status/I-1")

    assert response.status_code == 401


def test_payment_status_does_not_expose_another_users_transaction(monkeypatch):
    record = {
        "session_id": "I-1",
        "user_id": "owner",
        "status": "initiated",
        "payment_status": "pending",
    }
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(payment_transactions=PaymentTransactions(record)),
    )
    _set_user(monkeypatch, {"user_id": "other"})

    response = TestClient(server.app).get("/api/payments/status/I-1")

    assert response.status_code == 404
    assert response.json()["detail"] == "Transaction not found"


def test_payment_status_returns_authenticated_users_transaction(monkeypatch):
    record = {
        "session_id": "I-1",
        "user_id": "owner",
        "status": "completed",
        "payment_status": "paid",
    }
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(payment_transactions=PaymentTransactions(record)),
    )
    _set_user(monkeypatch, {"user_id": "owner"})

    response = TestClient(server.app).get("/api/payments/status/I-1")

    assert response.status_code == 200
    assert response.json() == {
        "session_id": "I-1",
        "status": "completed",
        "payment_status": "paid",
    }
