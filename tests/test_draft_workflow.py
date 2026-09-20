import pytest

from backend.core.security import content_hash
from backend.core.workflows import create_case_draft


def test_decline_creates_draft_and_one_time_send_action(runtime):
    case, _ = runtime.repository.create_case(
        "case-gmail",
        {
            "source_type": "gmail",
            "source_message_id": "message-1",
            "sender": "sender@example.com",
            "subject": "Draft BL",
            "gmail_thread_id": "thread-1",
            "result": {"status": "MISMATCH", "defect_fields": ["consignee"]},
            "owner_chat_id": "42",
        },
    )
    updated = create_case_draft(runtime.repository, runtime.gmail, runtime.telegram, case)
    assert updated["draft_state"] == "READY"
    assert updated["draft_content_hash"] == content_hash(
        updated["draft_subject"], updated["draft_body"]
    )
    assert updated["gmail_draft_url"] == "https://mail.google.com/mail/u/0/#drafts/draft-1"
    assert runtime.telegram.messages[-1][2]["inline_keyboard"][0][0]["url"] == (
        "https://mail.google.com/mail/u/0/#drafts/draft-1"
    )
    action_id = next(iter(runtime.repository.actions))
    assert runtime.repository.consume_action(action_id, "7") is None
    assert runtime.repository.consume_action(action_id, "42") is not None
    assert runtime.repository.consume_action(action_id, "42") is None


def test_draft_rejects_no_reply_sender(runtime):
    case, _ = runtime.repository.create_case(
        "case-no-reply",
        {
            "source_type": "gmail",
            "source_message_id": "message-2",
            "sender": "no-reply@example.com",
            "subject": "Draft BL",
            "gmail_thread_id": "thread-2",
            "result": {"status": "MISMATCH", "defect_fields": ["shipper"]},
        },
    )
    with pytest.raises(ValueError):
        create_case_draft(runtime.repository, runtime.gmail, runtime.telegram, case)


def test_draft_with_case_document_attachments(runtime):
    case, _ = runtime.repository.create_case(
        "case-with-docs",
        {
            "source_type": "gmail",
            "source_message_id": "msg-docs",
            "sender": "client@shipping.com",
            "subject": "Booking Documents",
            "gmail_thread_id": "thread-docs",
            "result": {"status": "MISMATCH", "defect_fields": ["gross_weight"]},
        },
    )
    # Add a document in blob store and repository
    uri = runtime.blobs.upload("cases/case-with-docs/raw/doc1.pdf", b"%PDF-mock", "application/pdf")
    runtime.repository.add_document(
        "case-with-docs",
        "doc-1",
        {
            "filename": "booking_si.pdf",
            "content_type": "application/pdf",
            "size_bytes": 9,
            "sha256": "fakehash",
            "gcs_uri": uri,
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
    assert "booking_si.pdf" in updated["draft_attachments"]
    # Verify FakeGmail received the attachment
    draft_id = updated["gmail_draft_id"]
    assert len(runtime.gmail.drafts[draft_id]["attachments"]) == 1
    att_name, att_type, att_bytes = runtime.gmail.drafts[draft_id]["attachments"][0]
    assert att_name == "booking_si.pdf"
    assert att_type == "application/pdf"
    assert att_bytes == b"%PDF-mock"


def test_draft_fallback_when_gmail_unconfigured(runtime):
    from backend.core.gmail import GmailClient

    unconfigured_gmail = GmailClient(client_json="")
    assert not unconfigured_gmail.is_configured

    case, _ = runtime.repository.create_case(
        "case-unconfigured",
        {
            "source_type": "gmail",
            "source_message_id": "msg-unconf",
            "sender": "forwarder@logistics.com",
            "subject": "Missing Seal Number",
            "gmail_thread_id": "thread-unconf",
            "result": {"status": "MISMATCH", "defect_fields": ["seal_number"]},
        },
    )
    # Must NOT raise JSONDecodeError Expecting value: line 1 column 1 (char 0)
    updated = create_case_draft(
        runtime.repository,
        unconfigured_gmail,
        runtime.telegram,
        case,
        blobs=runtime.blobs,
    )
    assert updated["draft_state"] == "READY"
    assert updated["has_live_gmail"] is False
    assert updated["gmail_draft_id"].startswith("draft-")
    assert "https://mail.google.com/mail/?view=cm" in updated["gmail_draft_url"]
    assert "forwarder%40logistics.com" in updated["gmail_draft_url"]
    assert updated.get("review_decision") is None  # Preparing does not immediately decline
    assert updated["correction_draft"]["delivery_mode"] == "compose"


def test_client_config_safe_errors():
    from backend.core.gmail import _client_config

    with pytest.raises(RuntimeError, match="Gmail OAuth client JSON is not configured"):
        _client_config("")

    with pytest.raises(ValueError, match="Invalid Gmail OAuth client JSON"):
        _client_config("{not-json")

    with pytest.raises(ValueError, match="must contain web or installed"):
        _client_config('{"invalid_type": {}}')


def test_prepare_and_confirm_sent_endpoints(runtime):
    from fastapi.testclient import TestClient
    from backend.api.main import create_app

    client = TestClient(create_app(runtime))
    case, _ = runtime.repository.create_case(
        "case-hybrid",
        {
            "source_type": "gmail",
            "source_message_id": "msg-hybrid",
            "sender": "ops@freight.test",
            "subject": "BL Discrepancy #998",
            "result": {"status": "MISMATCH", "defect_fields": ["shipper", "consignee"]},
        },
    )

    # 1. Prepare draft in live mode (FakeGmail is configured)
    res = client.post("/api/cases/case-hybrid/draft/prepare", json={"expected_version": case["version"]})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["draft"] is not None
    assert data["draft"]["state"] == "READY"
    assert data["draft"]["delivery_mode"] == "live"
    assert data["review_decision"] is None  # NOT immediately declined
    assert "#drafts/draft-1" in data["draft"]["gmail_url"]

    # 2. Update draft via PUT /api/cases/{case_id}/draft
    res_update = client.put(
        "/api/cases/case-hybrid/draft",
        json={"subject": "Updated Subject", "body": "Updated Body", "expected_version": data["version"]},
    )
    assert res_update.status_code == 200, res_update.text
    updated_data = res_update.json()
    assert updated_data["draft"]["subject"] == "Updated Subject"

    # 3. Live send succeeds
    res_send = client.post(
        "/api/cases/case-hybrid/draft/send",
        json={"expected_version": updated_data["version"], "expected_content_hash": updated_data["draft"]["content_hash"]},
    )
    assert res_send.status_code == 200
    sent_data = res_send.json()
    assert sent_data["draft"]["state"] == "SENT"
    assert sent_data["review_decision"] == "DECLINE"

    # 4. Now test unconfigured / compose fallback mode on a second case
    case_compose, _ = runtime.repository.create_case(
        "case-compose",
        {
            "source_type": "gmail",
            "source_message_id": "msg-comp",
            "sender": "carrier@sea.test",
            "subject": "Missing Port of Loading",
            "result": {"status": "MISMATCH", "defect_fields": ["port_of_loading"]},
        },
    )
    # Temporarily set gmail to unconfigured
    saved_json = runtime.gmail.client_json
    runtime.gmail.client_json = ""
    try:
        res_comp = client.post("/api/cases/case-compose/draft/prepare", json={"expected_version": case_compose["version"]})
        assert res_comp.status_code == 200
        comp_data = res_comp.json()
        assert comp_data["draft"]["delivery_mode"] == "compose"
        assert comp_data["review_decision"] is None
        assert "carrier%40sea.test" in comp_data["draft"]["gmail_url"]
        assert "https://mail.google.com/mail/?view=cm" in comp_data["draft"]["gmail_url"]

        # Sending via server-side send must fail with 400
        res_bad_send = client.post(
            "/api/cases/case-compose/draft/send",
            json={"expected_version": comp_data["version"], "expected_content_hash": comp_data["draft"]["content_hash"]},
        )
        assert res_bad_send.status_code == 400

        # Confirm sent via POST /api/cases/{case_id}/draft/confirm-sent succeeds
        res_confirm = client.post(
            "/api/cases/case-compose/draft/confirm-sent",
            json={"expected_version": comp_data["version"]},
        )
        assert res_confirm.status_code == 200
        confirmed = res_confirm.json()
        assert confirmed["draft"]["state"] == "SENT"
        assert confirmed["review_decision"] == "DECLINE"
        assert confirmed["draft"]["sent_at"] is not None
    finally:
        runtime.gmail.client_json = saved_json


