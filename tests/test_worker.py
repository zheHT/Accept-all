import base64
import json

from fastapi.testclient import TestClient
from google.auth.exceptions import RefreshError

from backend.worker.main import create_app
from backend.worker.gmail_ingest import reconcile_recent_gmail


def pubsub(payload):
    data = base64.b64encode(json.dumps(payload).encode()).decode()
    return {"message": {"data": data}}


def test_weekly_summary_is_idempotent(runtime):
    runtime.settings.telegram_admin_chat_id = "99"
    client = TestClient(create_app(runtime))

    first = client.get("/api/cron/summary")
    second = client.get("/api/cron/summary")

    assert first.status_code == 200
    assert first.json()["already_sent"] is False
    assert second.json()["already_sent"] is True
    assert len(runtime.telegram.messages) == 1


def test_expired_gmail_oauth_alerts_and_preserves_reconciliation_state(runtime):
    runtime.settings.telegram_admin_chat_id = "99"
    runtime.repository.set_gmail_state({"history_id": "100"})

    def expired(_):
        raise RefreshError("invalid_grant")

    runtime.gmail.history = expired
    client = TestClient(create_app(runtime))
    response = client.post(
        "/internal/pubsub/gmail-event",
        json=pubsub({"historyId": "101", "emailAddress": "demo@example.test"}),
    )

    assert response.status_code == 200
    assert response.json()["reconnect_required"] is True
    state = runtime.repository.get_gmail_state()
    assert state["history_id"] == "100"
    assert state["oauth_status"] == "reconnect_required"
    assert "remain in Gmail" in runtime.telegram.messages[-1][1]


def test_hourly_gmail_reconciliation_passes_configured_limit(runtime):
    requested = []
    runtime.gmail.list_messages = lambda query, max_results=None: (
        requested.append((query, max_results)) or []
    )

    assert reconcile_recent_gmail(runtime, max_results=7) == []
    assert requested == [("label:INBOX newer_than:30d -in:spam -in:trash", 7)]


def test_hourly_gmail_reconciliation_route_uses_platform_limit(runtime):
    runtime.settings.telegram_admin_chat_id = "99"
    runtime.repository.set_platform_settings({"gmail_reconcile_limit": 7})
    requested = []
    runtime.gmail.list_messages = lambda query, max_results=None: (
        requested.append((query, max_results)) or []
    )
    client = TestClient(create_app(runtime))

    response = client.post("/internal/cron/gmail-reconcile")

    assert response.status_code == 200
    assert response.json() == {"accepted": 0, "limit": 7, "case_ids": []}
    assert requested[0][1] == 7
