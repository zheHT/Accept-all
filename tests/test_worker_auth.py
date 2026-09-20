import base64
import json

import pytest
from fastapi.testclient import TestClient
from google.auth.exceptions import TransportError

from backend.worker.main import create_app


def _pubsub(payload):
    data = base64.b64encode(json.dumps(payload).encode()).decode()
    return {"message": {"data": data}}


def test_production_worker_rejects_internal_route_without_auth(runtime, monkeypatch):
    runtime.settings.app_env = "production"
    monkeypatch.delenv("WORKER_AUTH_AUDIENCE", raising=False)
    monkeypatch.delenv("WORKER_PUBSUB_INVOKER_EMAIL", raising=False)
    monkeypatch.delenv("WORKER_SCHEDULER_INVOKER_EMAIL", raising=False)

    client = TestClient(create_app(runtime))
    response = client.post(
        "/internal/pubsub/doc-task",
        json=_pubsub({"case_id": "case-1"}),
    )

    assert response.status_code == 401
    assert runtime.repository.get_case("case-1") is None


def test_production_pubsub_route_requires_matching_verified_pubsub_identity(runtime, monkeypatch):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_PUBSUB_INVOKER_EMAIL", "pubsub@example.iam.gserviceaccount.com")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")

    def verify(token, request, audience):
        assert token == "signed-token"
        assert audience == "https://worker.example.test"
        return {"email": "pubsub@example.iam.gserviceaccount.com", "email_verified": True}

    monkeypatch.setattr("backend.worker.auth.id_token.verify_oauth2_token", verify)
    monkeypatch.setattr(
        "backend.worker.main.CaseProcessor.process",
        lambda self, case_id: {"processing_state": "done"},
    )
    client = TestClient(create_app(runtime))

    response = client.post(
        "/internal/pubsub/doc-task",
        headers={"Authorization": "Bearer signed-token"},
        json=_pubsub({"case_id": "case-1"}),
    )

    assert response.status_code == 200


def test_production_cron_route_rejects_pubsub_identity(runtime, monkeypatch):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_PUBSUB_INVOKER_EMAIL", "pubsub@example.iam.gserviceaccount.com")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")
    monkeypatch.setattr(
        "backend.worker.auth.id_token.verify_oauth2_token",
        lambda token, request, audience: {
            "email": "pubsub@example.iam.gserviceaccount.com",
            "email_verified": True,
        },
    )

    response = TestClient(create_app(runtime)).post(
        "/internal/cron/gmail-reconcile",
        headers={"Authorization": "Bearer signed-token"},
    )

    assert response.status_code == 403


def test_local_worker_keeps_existing_internal_route_behavior(runtime, monkeypatch):
    runtime.settings.app_env = "test"
    monkeypatch.delenv("WORKER_AUTH_AUDIENCE", raising=False)
    monkeypatch.setattr("backend.worker.main.reconcile_recent_gmail", lambda *args, **kwargs: [])
    response = TestClient(create_app(runtime)).post(
        "/internal/cron/gmail-reconcile",
    )

    assert response.status_code == 200


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/internal/pubsub/doc-task", _pubsub({"case_id": "case-1"})),
        ("post", "/internal/pubsub/gmail-event", _pubsub({"historyId": "1"})),
        ("post", "/internal/cron/gmail-watch", None),
        ("post", "/internal/cron/gmail-reconcile", None),
        ("get", "/api/cron/summary", None),
    ],
)
def test_production_rejects_missing_token_on_every_protected_route(
    runtime, monkeypatch, method, path, body
):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_PUBSUB_INVOKER_EMAIL", "pubsub@example.iam.gserviceaccount.com")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")
    called = []
    monkeypatch.setattr(
        "backend.worker.main.CaseProcessor.process", lambda *args: called.append(args)
    )

    response = getattr(TestClient(create_app(runtime)), method)(path, json=body) if body else getattr(
        TestClient(create_app(runtime)), method
    )(path)

    assert response.status_code == 401
    assert called == []


@pytest.mark.parametrize("claim", ["invalid", "expired"])
def test_production_rejects_invalid_or_expired_token(runtime, monkeypatch, claim):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")
    monkeypatch.setattr(
        "backend.worker.auth.id_token.verify_oauth2_token",
        lambda *args: (_ for _ in ()).throw(ValueError(claim)),
    )

    response = TestClient(create_app(runtime)).post(
        "/internal/cron/gmail-reconcile",
        headers={"Authorization": "Bearer signed-token"},
    )

    assert response.status_code == 401


def test_production_returns_unavailable_when_google_verifier_transport_fails(runtime, monkeypatch):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")
    monkeypatch.setattr(
        "backend.worker.auth.id_token.verify_oauth2_token",
        lambda *args, **kwargs: (_ for _ in ()).throw(TransportError("key server unavailable")),
    )

    response = TestClient(create_app(runtime)).post(
        "/internal/cron/gmail-reconcile",
        headers={"Authorization": "Bearer signed-token"},
    )

    assert response.status_code == 503


@pytest.mark.parametrize("missing", ["WORKER_AUTH_AUDIENCE", "WORKER_SCHEDULER_INVOKER_EMAIL"])
def test_production_rejects_bearer_token_when_required_config_is_missing(runtime, monkeypatch, missing):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")
    monkeypatch.delenv(missing, raising=False)

    response = TestClient(create_app(runtime)).post(
        "/internal/cron/gmail-reconcile",
        headers={"Authorization": "Bearer signed-token"},
    )

    assert response.status_code == 401


@pytest.mark.parametrize("email_verified", [False, "true"])
@pytest.mark.parametrize("source", ["pubsub", "scheduler"])
def test_production_requires_boolean_verified_email_and_exact_source_identity(
    runtime, monkeypatch, source, email_verified
):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_PUBSUB_INVOKER_EMAIL", "pubsub@example.iam.gserviceaccount.com")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")
    path = "/internal/pubsub/doc-task" if source == "pubsub" else "/internal/cron/gmail-reconcile"
    monkeypatch.setattr(
        "backend.worker.auth.id_token.verify_oauth2_token",
        lambda *args, **kwargs: {"email": "wrong@example.com", "email_verified": email_verified},
    )

    response = TestClient(create_app(runtime)).post(
        path,
        headers={"Authorization": "Bearer signed-token"},
        json=_pubsub({"case_id": "case-1"}) if source == "pubsub" else None,
    )

    assert response.status_code == 403


def test_production_allows_verified_scheduler_identity(runtime, monkeypatch):
    runtime.settings.app_env = "production"
    monkeypatch.setenv("WORKER_AUTH_AUDIENCE", "https://worker.example.test")
    monkeypatch.setenv("WORKER_SCHEDULER_INVOKER_EMAIL", "scheduler@example.iam.gserviceaccount.com")
    monkeypatch.setattr(
        "backend.worker.auth.id_token.verify_oauth2_token",
        lambda *args, **kwargs: {
            "email": "scheduler@example.iam.gserviceaccount.com",
            "email_verified": True,
        },
    )
    monkeypatch.setattr("backend.worker.main.reconcile_recent_gmail", lambda *args, **kwargs: [])

    response = TestClient(create_app(runtime)).post(
        "/internal/cron/gmail-reconcile",
        headers={"Authorization": "Bearer signed-token"},
    )

    assert response.status_code == 200
