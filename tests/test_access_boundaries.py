from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend.api.main import create_app


def production_client(runtime, monkeypatch, claims):
    runtime.settings.app_env = "production"
    monkeypatch.setattr("backend.api.main.id_token.verify_firebase_token", lambda *a, **kw: claims)
    runtime.repository.is_reviewer = Mock(side_effect=AssertionError("Must not auto-enroll"))
    return TestClient(create_app(runtime))


def test_every_authenticated_user_can_use_shared_workspace_without_enrollment(runtime, monkeypatch):
    for uid in ("first-new-user", "another-new-user"):
        client = production_client(runtime, monkeypatch, {"sub": uid})
        headers = {"Authorization": "Bearer valid"}
        for path in ("/api/dashboard", "/api/inbox", "/api/cases", "/api/reviews", "/api/knowledge-base/weeks"):
            assert client.get(path, headers=headers).status_code == 200
        assert client.get("/api/session", headers=headers).json() == {"uid": uid, "is_admin": False}
        runtime.repository.is_reviewer.assert_not_called()


@pytest.mark.parametrize("claims", [{"sub": "user"}, {"sub": "user", "admin": "true"}])
def test_settings_are_admin_only(runtime, monkeypatch, claims):
    client = production_client(runtime, monkeypatch, claims)
    headers = {"Authorization": "Bearer valid"}
    assert client.get("/api/settings", headers=headers).status_code == 403
    assert client.put("/api/settings", headers=headers, json={"confidence_threshold": 0.9, "mismatch_alerts_enabled": False}).status_code == 403
    assert client.get("/api/integrations/gmail/oauth/start", headers=headers).status_code == 403


def test_explicit_admin_can_read_settings(runtime, monkeypatch):
    client = production_client(runtime, monkeypatch, {"sub": "admin", "admin": True})
    assert client.get("/api/settings", headers={"Authorization": "Bearer valid"}).status_code == 200


def test_group_members_cannot_use_private_admin_controls(runtime):
    runtime.settings.telegram_admin_chat_id = "-42"
    client = TestClient(create_app(runtime))
    client.post("/api/telegram-webhook", json={"message": {"chat": {"id": -42, "type": "group"}, "from": {"id": 7}, "text": "/notifications off"}}, headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"})
    assert runtime.repository.get_platform_settings()["mismatch_alerts_enabled"] is True


@pytest.mark.parametrize("text", ["/notifications maybe", "/notifications off extra", "/email_limit 0", "/email_limit 501", "/email_limit 7 extra", "/week 2026-W54"])
def test_invalid_operational_arguments_do_not_mutate_or_read_report(runtime, text):
    runtime.settings.telegram_admin_chat_id = "42"
    runtime.repository.get_knowledge_base_week = Mock(side_effect=AssertionError("Invalid week read"))
    client = TestClient(create_app(runtime))
    client.post("/api/telegram-webhook", json={"message": {"chat": {"id": 42}, "text": text}}, headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"})
    assert "Usage:" in runtime.telegram.messages[-1][1]
    assert runtime.repository.get_platform_settings()["mismatch_alerts_enabled"] is True
    assert runtime.repository.get_platform_settings()["gmail_reconcile_limit"] == 50


def test_missing_identity_is_rejected(runtime, monkeypatch):
    client = production_client(runtime, monkeypatch, {})
    assert client.get("/api/dashboard", headers={"Authorization": "Bearer valid"}).status_code == 401
    assert client.get("/api/dashboard").status_code == 401


@pytest.mark.parametrize("text", ["/week 2026-W38", "/notifications", "/notifications off", "/email_limit 7"])
def test_public_bot_user_cannot_read_or_change_operations(runtime, text):
    runtime.settings.telegram_admin_chat_id = "42"
    runtime.repository.get_platform_settings = Mock(side_effect=AssertionError("Unauthorized read"))
    runtime.repository.get_knowledge_base_week = Mock(side_effect=AssertionError("Unauthorized read"))
    client = TestClient(create_app(runtime))
    response = client.post("/api/telegram-webhook", json={"message": {"chat": {"id": 7}, "text": text}}, headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"})
    assert response.status_code == 200
    assert runtime.telegram.messages[-1][0] == "7"


@pytest.mark.parametrize("text", ["/email_limit 7", "/email_limit@classall_bot 7", "/email-limit 7"])
def test_registered_email_limit_and_legacy_alias(runtime, text):
    runtime.settings.telegram_admin_chat_id = "42"
    client = TestClient(create_app(runtime))
    response = client.post("/api/telegram-webhook", json={"message": {"chat": {"id": 42}, "text": text}}, headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"})
    assert response.status_code == 200
    assert runtime.repository.get_platform_settings()["gmail_reconcile_limit"] == 7


@pytest.mark.parametrize("text", ["/start", "/help", "/newcase", "Hello"])
def test_public_bot_features_remain_available(runtime, text):
    client = TestClient(create_app(runtime))
    response = client.post("/api/telegram-webhook", json={"message": {"chat": {"id": 987}, "text": text}}, headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret"})
    assert response.status_code == 200
    assert runtime.telegram.messages[-1][0] == "987"
