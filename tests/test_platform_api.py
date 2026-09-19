import json

from fastapi.testclient import TestClient

from backend.api.main import create_app


def test_ingestion_contract_and_idempotency(runtime):
    client = TestClient(create_app(runtime))
    run = client.post("/api/ingest/runs?expected=1", headers={"X-Ingest-Key": "test-key"})
    assert run.status_code == 200
    metadata = {
        "source_type": "grader",
        "source_message_id": "email_001",
        "subject": "TO CONFIRM DOCS",
        "run_id": run.json()["run_id"],
    }
    request = {
        "data": {"metadata": json.dumps(metadata)},
        "files": [("attachments", ("SI.txt", b"content", "text/plain"))],
        "headers": {"X-Ingest-Key": "test-key"},
    }
    first = client.post("/api/ingest/email", **request)
    second = client.post("/api/ingest/email", **request)
    assert first.status_code == 202
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert len(runtime.publisher.messages) == 1


def test_ingestion_rejects_wrong_key(runtime):
    client = TestClient(create_app(runtime))
    response = client.post("/api/ingest/runs", headers={"X-Ingest-Key": "wrong"})
    assert response.status_code == 401


def test_telegram_webhook_secret(runtime):
    client = TestClient(create_app(runtime))
    assert client.post("/api/telegram-webhook", json={}).status_code == 401
    response = client.post(
        "/api/telegram-webhook",
        json={"message": {"message_id": 1, "chat": {"id": 42}, "text": "/start"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"},
    )
    assert response.status_code == 200
    assert runtime.telegram.messages[-1][0] == "42"


def test_telegram_upload_rate_limit(runtime):
    runtime.settings.telegram_uploads_per_hour = 1
    client = TestClient(create_app(runtime))
    update = {
        "message": {
            "message_id": 2,
            "chat": {"id": 42},
            "caption": "#demo1",
            "document": {"file_id": "abc", "file_name": "SI.txt", "mime_type": "text/plain"},
        }
    }
    headers = {"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"}
    assert client.post("/api/telegram-webhook", json=update, headers=headers).status_code == 200
    assert client.post("/api/telegram-webhook", json=update, headers=headers).status_code == 200
    assert "Upload limit reached" in runtime.telegram.messages[-1][1]


def test_stale_gmail_decline_is_rejected(runtime):
    case, _ = runtime.repository.create_case(
        "case-stale",
        {
            "source_type": "gmail",
            "source_message_id": "m1",
            "sender": "sender@example.test",
            "subject": "Documents",
        },
    )
    assert case["version"] == 0
    client = TestClient(create_app(runtime))
    response = client.post(
        "/api/cases/case-stale/review",
        json={"decision": "DECLINE", "expected_version": 4, "note": ""},
    )
    assert response.status_code == 409
    assert runtime.gmail.drafts == {}
