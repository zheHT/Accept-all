from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import create_app
from backend.core.security import content_hash
from backend.core.workflows import create_case_draft


def test_api_approval_blocked_without_field_decisions(runtime):
    """Case with defects and 0 field decisions cannot be approved via API."""
    client = TestClient(create_app(runtime))
    case, _ = runtime.repository.create_case(
        "case-mismatch-1",
        {
            "source_type": "gmail",
            "source_message_id": "msg-1",
            "sender": "shipper@ocean.test",
            "subject": "Shipping Documents",
            "result": {"status": "MISMATCH", "defect_fields": ["shipper", "consignee"]},
            "field_reviews": {},
        },
    )

    # Attempt approval without any human field decisions
    res = client.post(
        "/api/cases/case-mismatch-1/review",
        json={"decision": "APPROVE", "expected_version": case["version"]},
    )
    assert res.status_code == 409
    assert "resolve all outstanding fields" in res.text

    # Verify case was not approved and is still in review queue
    unresolved_case = runtime.repository.get_case("case-mismatch-1")
    assert unresolved_case.get("review_decision") is None
    reviews = client.get("/api/reviews").json()["items"]
    assert any(c["case_id"] == "case-mismatch-1" for c in reviews)


from backend.api.views import VERIFIED_FIELDS


def _add_sample_documents(runtime, case_id: str) -> None:
    for role in ("SI", "BL"):
        fields = {
            "gross_weight_kg" if f == "gross_weight" else f: {
                "value": f"sample-{f}",
                "confidence": 0.99,
            }
            for f, _ in VERIFIED_FIELDS
        }
        uri = runtime.blobs.upload(f"cases/{case_id}/{role}.pdf", b"%PDF-mock", "application/pdf")
        runtime.repository.add_document(
            case_id,
            role.lower(),
            {
                "document_id": role.lower(),
                "filename": f"{role}.pdf",
                "content_type": "application/pdf",
                "size_bytes": 10,
                "sha256": "fakehash",
                "gcs_uri": uri,
                "extraction": {"document_type": role, "fields": fields},
            },
        )


def test_api_approval_succeeds_when_all_fields_resolved(runtime):
    """Case with all required fields resolved can be approved via API."""
    client = TestClient(create_app(runtime))
    case, _ = runtime.repository.create_case(
        "case-mismatch-2",
        {
            "source_type": "gmail",
            "source_message_id": "msg-2",
            "sender": "shipper@ocean.test",
            "subject": "Shipping Documents",
            "result": {"status": "MISMATCH", "defect_fields": ["shipper"]},
            "field_reviews": {
                "shipper": {
                    "field": "shipper",
                    "resolved": True,
                    "decision": "correct",
                    "value": "Acme Shipping Ltd",
                }
            },
        },
    )
    _add_sample_documents(runtime, "case-mismatch-2")

    res = client.post(
        "/api/cases/case-mismatch-2/review",
        json={"decision": "APPROVE", "expected_version": case["version"]},
    )
    assert res.status_code == 200
    approved_case = runtime.repository.get_case("case-mismatch-2")
    assert approved_case.get("review_decision") == "APPROVE"

    # Case should now be removed from active reviews
    reviews = client.get("/api/reviews").json()["items"]
    assert not any(c["case_id"] == "case-mismatch-2" for c in reviews)


def test_telegram_approval_blocked_when_unresolved_fields_exist(runtime):
    """Telegram approval callback is blocked when unresolved fields exist."""
    case, _ = runtime.repository.create_case(
        "case-tg-mismatch",
        {
            "source_type": "telegram",
            "source_message_id": "tg-msg-1",
            "owner_chat_id": "42",
            "result": {"status": "MISMATCH", "defect_fields": ["shipper"]},
            "field_reviews": {},
        },
    )
    action_id = "act-approve-1"
    runtime.repository.create_action(
        action_id,
        {
            "action": "approve",
            "case_id": "case-tg-mismatch",
            "chat_id": "42",
            "expected_version": case["version"],
        },
    )

    client = TestClient(create_app(runtime))
    headers = {"X-Telegram-Bot-Api-Secret-Token": runtime.settings.telegram_webhook_secret}
    res = client.post(
        "/api/telegram-webhook",
        json={
            "callback_query": {
                "id": "cb-1",
                "message": {"chat": {"id": 42}},
                "data": f"approve:{action_id}",
            }
        },
        headers=headers,
    )
    assert res.status_code == 200

    # Telegram client should receive an answer_callback indicating approval is blocked
    assert len(runtime.telegram.callbacks) == 1
    cb_id, text = runtime.telegram.callbacks[0]
    assert cb_id == "cb-1"
    assert "Cannot approve" in text
    assert "shipper" in text

    # Case must NOT be approved
    updated_case = runtime.repository.get_case("case-tg-mismatch")
    assert updated_case.get("review_decision") is None


def test_telegram_approval_succeeds_when_fields_resolved(runtime):
    """Telegram approval callback succeeds when all required fields are resolved."""
    case, _ = runtime.repository.create_case(
        "case-tg-ok",
        {
            "source_type": "telegram",
            "source_message_id": "tg-msg-2",
            "owner_chat_id": "42",
            "result": {"status": "OK", "defect_fields": []},
            "field_reviews": {},
        },
    )
    _add_sample_documents(runtime, "case-tg-ok")
    action_id = "act-approve-2"
    runtime.repository.create_action(
        action_id,
        {
            "action": "approve",
            "case_id": "case-tg-ok",
            "chat_id": "42",
            "expected_version": case["version"],
        },
    )

    client = TestClient(create_app(runtime))
    headers = {"X-Telegram-Bot-Api-Secret-Token": runtime.settings.telegram_webhook_secret}
    res = client.post(
        "/api/telegram-webhook",
        json={
            "callback_query": {
                "id": "cb-2",
                "message": {"chat": {"id": 42}},
                "data": f"approve:{action_id}",
            }
        },
        headers=headers,
    )
    assert res.status_code == 200
    assert any(cb[0] == "cb-2" and "approved" in cb[1].lower() for cb in runtime.telegram.callbacks)

    # Case must be approved
    updated_case = runtime.repository.get_case("case-tg-ok")
    assert updated_case.get("review_decision") == "APPROVE"


def test_draft_preparation_does_not_complete_case(runtime):
    """Preparing an AI draft must keep review_decision None and leave case in review queue."""
    client = TestClient(create_app(runtime))
    case, _ = runtime.repository.create_case(
        "case-prep-test",
        {
            "source_type": "gmail",
            "source_message_id": "msg-prep",
            "sender": "agent@freight.com",
            "subject": "Missing Booking Reference",
            "result": {"status": "MISMATCH", "defect_fields": ["shipper"]},
            "owner_chat_id": "42",
        },
    )

    # 1. Web path: POST /api/cases/{id}/draft/prepare
    res = client.post(
        "/api/cases/case-prep-test/draft/prepare",
        json={"expected_version": case["version"]},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["draft"]["state"] == "READY"
    assert data["review_decision"] is None

    case_after_web = runtime.repository.get_case("case-prep-test")
    assert case_after_web.get("review_decision") is None
    reviews = client.get("/api/reviews").json()["items"]
    assert any(c["case_id"] == "case-prep-test" for c in reviews)

    # 2. Telegram path: callback decline:{action_id} (triggering draft creation)
    action_id = "act-prep-tg"
    runtime.repository.create_action(
        action_id,
        {
            "action": "decline",
            "case_id": "case-prep-test",
            "chat_id": "42",
            "expected_version": case_after_web["version"],
        },
    )
    headers = {"X-Telegram-Bot-Api-Secret-Token": runtime.settings.telegram_webhook_secret}
    res_tg = client.post(
        "/api/telegram-webhook",
        json={
            "callback_query": {
                "id": "cb-prep",
                "message": {"chat": {"id": 42}},
                "data": f"decline:{action_id}",
            }
        },
        headers=headers,
    )
    assert res_tg.status_code == 200
    case_after_tg = runtime.repository.get_case("case-prep-test")
    assert case_after_tg.get("review_decision") is None
    reviews_after_tg = client.get("/api/reviews").json()["items"]
    assert any(c["case_id"] == "case-prep-test" for c in reviews_after_tg)


def test_telegram_compose_fallback_confirm_sent(runtime):
    """Confirming sent via Telegram callback in compose fallback completes case as DECLINE."""
    saved_json = runtime.gmail.client_json
    runtime.gmail.client_json = ""  # simulate unconfigured Gmail -> compose mode
    try:
        case, _ = runtime.repository.create_case(
            "case-tg-compose",
            {
                "source_type": "gmail",
                "source_message_id": "msg-compose-tg",
                "sender": "ops@forwarder.test",
                "subject": "Port Discrepancy",
                "result": {"status": "MISMATCH", "defect_fields": ["port_of_loading"]},
                "owner_chat_id": "42",
            },
        )
        updated = create_case_draft(
            runtime.repository,
            runtime.gmail,
            runtime.telegram,
            case,
            blobs=runtime.blobs,
        )
        assert updated["draft_state"] == "READY"
        assert updated["correction_draft"]["delivery_mode"] == "compose"

        # Telegram message should include CONFIRM SENT button
        last_msg = runtime.telegram.messages[-1]
        keyboard = last_msg[2]["inline_keyboard"]
        button_texts = [btn["text"] for row in keyboard for btn in row]
        assert "CONFIRM SENT" in button_texts
        assert "OPEN GMAIL COMPOSE" in button_texts

        # Find the confirm_sent action
        actions = [
            (aid, act)
            for aid, act in runtime.repository.actions.items()
            if act.get("action") == "confirm_sent" and act.get("case_id") == "case-tg-compose"
        ]
        assert len(actions) == 1
        action_id, _ = actions[0]

        client = TestClient(create_app(runtime))
        headers = {"X-Telegram-Bot-Api-Secret-Token": runtime.settings.telegram_webhook_secret}
        res = client.post(
            "/api/telegram-webhook",
            json={
                "callback_query": {
                    "id": "cb-conf",
                    "message": {"chat": {"id": 42}},
                    "data": f"confirm_sent:{action_id}",
                }
            },
            headers=headers,
        )
        assert res.status_code == 200

        # Case must be marked DECLINE with draft state SENT
        confirmed_case = runtime.repository.get_case("case-tg-compose")
        assert confirmed_case["review_decision"] == "DECLINE"
        assert confirmed_case["draft_state"] == "SENT"
        assert confirmed_case["correction_draft"]["state"] == "SENT"
        assert confirmed_case["correction_draft"]["sent_by"] == "telegram:42"

        # Case must be removed from reviews queue
        reviews = client.get("/api/reviews").json()["items"]
        assert not any(c["case_id"] == "case-tg-compose" for c in reviews)
    finally:
        runtime.gmail.client_json = saved_json


def test_telegram_compose_mode_blocks_fake_send(runtime):
    """Attempting a server send callback on a compose-mode draft is rejected."""
    saved_json = runtime.gmail.client_json
    runtime.gmail.client_json = ""
    try:
        case, _ = runtime.repository.create_case(
            "case-tg-no-fake",
            {
                "source_type": "gmail",
                "source_message_id": "msg-no-fake",
                "sender": "ops@forwarder.test",
                "subject": "Discrepancy",
                "result": {"status": "MISMATCH", "defect_fields": ["shipper"]},
                "owner_chat_id": "42",
                "gmail_draft_id": "draft-case-tg-no-fake",
                "draft_state": "READY",
                "correction_draft": {"delivery_mode": "compose", "subject": "S", "body": "B"},
            },
        )
        action_id = "act-fake-send"
        runtime.repository.create_action(
            action_id,
            {
                "action": "send_draft",
                "case_id": "case-tg-no-fake",
                "chat_id": "42",
                "expected_version": case["version"],
                "expected_content_hash": content_hash("S", "B"),
            },
        )

        client = TestClient(create_app(runtime))
        headers = {"X-Telegram-Bot-Api-Secret-Token": runtime.settings.telegram_webhook_secret}
        res = client.post(
            "/api/telegram-webhook",
            json={
                "callback_query": {
                    "id": "cb-fake",
                    "message": {"chat": {"id": 42}},
                    "data": f"send:{action_id}",
                }
            },
            headers=headers,
        )
        assert res.status_code == 200

        # Should answer callback with rejection
        assert any(cb[0] == "cb-fake" and "not configured" in cb[1] for cb in runtime.telegram.callbacks)

        # Case should NOT be recorded as SENT
        unchanged_case = runtime.repository.get_case("case-tg-no-fake")
        assert unchanged_case["draft_state"] == "READY"
        assert unchanged_case.get("review_decision") is None
    finally:
        runtime.gmail.client_json = saved_json


def test_telegram_live_send_completes_case_as_decline(runtime):
    """Sending live draft via Telegram completes case as DECLINE and removes from review queue."""
    case, _ = runtime.repository.create_case(
        "case-tg-live",
        {
            "source_type": "gmail",
            "source_message_id": "msg-live-tg",
            "sender": "carrier@ocean.test",
            "subject": "Missing Seal",
            "result": {"status": "MISMATCH", "defect_fields": ["seal_number"]},
            "owner_chat_id": "42",
        },
    )
    updated = create_case_draft(
        runtime.repository,
        runtime.gmail,
        runtime.telegram,
        case,
        blobs=runtime.blobs,
    )
    assert updated["has_live_gmail"] is True
    assert updated["draft_state"] == "READY"

    # Action should be send_draft
    actions = [
        (aid, act)
        for aid, act in runtime.repository.actions.items()
        if act.get("action") == "send_draft" and act.get("case_id") == "case-tg-live"
    ]
    assert len(actions) == 1
    action_id, act_payload = actions[0]

    client = TestClient(create_app(runtime))
    headers = {"X-Telegram-Bot-Api-Secret-Token": runtime.settings.telegram_webhook_secret}
    res = client.post(
        "/api/telegram-webhook",
        json={
            "callback_query": {
                "id": "cb-live-send",
                "message": {"chat": {"id": 42}},
                "data": f"send:{action_id}",
            }
        },
        headers=headers,
    )
    assert res.status_code == 200

    # Case should now be SENT and DECLINE
    sent_case = runtime.repository.get_case("case-tg-live")
    assert sent_case["draft_state"] == "SENT"
    assert sent_case["review_decision"] == "DECLINE"
    assert sent_case["correction_draft"]["state"] == "SENT"
    assert sent_case["correction_draft"]["sent_by"] == "telegram:42"

    # Case should be removed from reviews queue
    reviews = client.get("/api/reviews").json()["items"]
    assert not any(c["case_id"] == "case-tg-live" for c in reviews)
