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
