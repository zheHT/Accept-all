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
    assert "Incoming Gmail Detection" in runtime.telegram.messages[-1][1]

    help_response = client.post(
        "/api/telegram-webhook",
        json={"message": {"message_id": 2, "chat": {"id": 42}, "text": "/help"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"},
    )
    assert help_response.status_code == 200
    assert "/week YYYY-W##" in runtime.telegram.messages[-1][1]
    assert "/ask CASE_ID question" in runtime.telegram.messages[-1][1]


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


def test_telegram_email_controls_show_and_update_hourly_limit(runtime):
    runtime.settings.telegram_admin_chat_id = "42"
    client = TestClient(create_app(runtime))
    headers = {"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"}

    status = client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 42}, "text": "/notifications"}},
        headers=headers,
    )
    assert status.status_code == 200
    assert "Hourly email limit: <b>50</b>" in runtime.telegram.messages[-1][1]

    updated = client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 42}, "text": "/email-limit 7"}},
        headers=headers,
    )
    assert updated.status_code == 200
    assert runtime.repository.get_platform_settings()["gmail_reconcile_limit"] == 7
    assert "Hourly email limit: <b>7</b>" in runtime.telegram.messages[-1][1]


def test_telegram_week_command_returns_published_summary(runtime):
    runtime.settings.telegram_admin_chat_id = "42"
    runtime.repository.save_knowledge_base_week(
        {
            "week": "2026-W38",
            "summary_narrative": "Three recurring consignee issues were found.",
            "drive_url": "https://docs.google.com/document/d/doc-1/edit",
        }
    )
    client = TestClient(create_app(runtime))
    response = client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 42}, "text": "/week 2026-W38"}},
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"},
    )
    assert response.status_code == 200
    assert "Three recurring consignee issues were found." in runtime.telegram.messages[-1][1]
    assert runtime.telegram.messages[-1][2]["inline_keyboard"][0][0]["url"].endswith("/knowledge-base")


def test_telegram_notifications_changes_are_admin_only(runtime):
    runtime.settings.telegram_admin_chat_id = "42"
    client = TestClient(create_app(runtime))
    headers = {"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"}

    client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 7}, "text": "/notifications off"}},
        headers=headers,
    )
    assert runtime.repository.get_platform_settings()["mismatch_alerts_enabled"] is True

    client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 42}, "text": "/notifications off"}},
        headers=headers,
    )
    assert runtime.repository.get_platform_settings()["mismatch_alerts_enabled"] is False


def test_telegram_ask_command_explains_owned_case(runtime):
    runtime.repository.create_case(
        "case-1234567890abcdef12345678",
        {"owner_chat_id": "42", "source_type": "telegram", "subject": "Question"},
    )
    runtime.explainer.explain = lambda case, question: f"Answer for {question}"  # type: ignore[method-assign]
    client = TestClient(create_app(runtime))
    response = client.post(
        "/api/telegram-webhook",
        json={
            "message": {
                "chat": {"id": 42},
                "text": "/ask case-1234567890abcdef12345678 why?",
            }
        },
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"},
    )
    assert response.status_code == 200
    assert runtime.telegram.messages[-1][1] == "Answer for why?"


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


def test_telegram_plain_text_notification_control(runtime):
    runtime.settings.telegram_admin_chat_id = "42"
    client = TestClient(create_app(runtime))
    headers = {"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"}

    # Non-admin plain text attempt
    client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 7}, "from": {"id": 7}, "text": "close notification"}},
        headers=headers,
    )
    assert runtime.repository.get_platform_settings()["mismatch_alerts_enabled"] is True
    assert "Operational settings are managed by an administrator" in runtime.telegram.messages[-1][1]

    # Admin plain text attempt: close
    client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 42}, "from": {"id": 42}, "text": "close notification"}},
        headers=headers,
    )
    assert runtime.repository.get_platform_settings()["mismatch_alerts_enabled"] is False
    assert "Notifications:</b> off" in runtime.telegram.messages[-1][1]

    # Admin plain text attempt: open
    client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 42}, "from": {"id": 42}, "text": "open notification"}},
        headers=headers,
    )
    assert runtime.repository.get_platform_settings()["mismatch_alerts_enabled"] is True
    assert "Notifications:</b> on" in runtime.telegram.messages[-1][1]


def test_telegram_week_and_submit_progress(runtime) -> None:
    runtime.settings.telegram_admin_chat_id = "42"
    runtime.repository.save_knowledge_base_week(
        {
            "week": "2026-W38",
            "summary_narrative": "Weekly report narrative details.",
            "cases_analyzed": 14,
        }
    )
    client = TestClient(create_app(runtime))
    headers = {"x-telegram-bot-api-secret-token": runtime.settings.telegram_webhook_secret}

    # Admin runs /week without specifying week: auto-fetches latest and uses progress
    client.post(
        "/api/telegram-webhook",
        json={"message": {"chat": {"id": 42, "type": "private"}, "from": {"id": 42}, "text": "/week"}},
        headers=headers,
    )
    # Check that the edited message contains the summary
    assert any("Weekly summary 2026-W38" in m[1] for m in runtime.telegram.messages)

