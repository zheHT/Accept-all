from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any

from backend.core.gmail import GmailClient
from backend.core.repository import CaseRepository, utcnow
from backend.core.security import content_hash
from backend.core.telegram import TelegramClient


def draft_correction_text(case: dict[str, Any]) -> tuple[str, str]:
    result = case.get("result") or {}
    fields = result.get("defect_fields") or []
    reason = result.get("review_reason")
    detail = ", ".join(fields) if fields else reason or "information requiring review"
    original_subject = case.get("subject") or "shipping documents"
    subject = (
        original_subject
        if original_subject.lower().startswith("re:")
        else f"Re: {original_subject}"
    )
    body = (
        "Hello,\n\n"
        "We reviewed the submitted shipping documents and need clarification or corrected "
        f"documents for: {detail}.\n\n"
        "Please verify the information and reply with the corrected SI/BL documents.\n\n"
        "Regards,\nClassAll Document Review"
    )
    return subject, body


def create_case_draft(
    repository: CaseRepository,
    gmail: GmailClient,
    telegram: TelegramClient,
    case: dict[str, Any],
    chat_id: str | None = None,
) -> dict[str, Any]:
    if case.get("source_type") != "gmail":
        raise ValueError("email drafts are available only for Gmail-sourced cases")
    recipient = case.get("sender", "")
    if not recipient or "noreply" in recipient.lower() or "no-reply" in recipient.lower():
        raise ValueError("the original sender cannot receive a correction reply")
    subject, body = draft_correction_text(case)
    draft = gmail.create_reply_draft(
        to=recipient,
        subject=subject,
        body=body,
        thread_id=case.get("gmail_thread_id", ""),
        message_id_header=case.get("gmail_message_id_header", ""),
    )
    hash_value = content_hash(subject, body)
    updated = repository.update_case(
        case["case_id"],
        {
            "review_decision": "DECLINE",
            "gmail_draft_id": draft["id"],
            "draft_subject": subject,
            "draft_body": body,
            "draft_content_hash": hash_value,
            "draft_state": "READY",
        },
        expected_version=case.get("version"),
    )
    repository.append_event(case["case_id"], "gmail_draft_created", {"draft_id": draft["id"]})
    target_chat = chat_id or case.get("owner_chat_id")
    if target_chat:
        action_id = secrets.token_urlsafe(12)
        repository.create_action(
            action_id,
            {
                "action": "send_draft",
                "case_id": case["case_id"],
                "chat_id": str(target_chat),
                "expected_version": updated["version"],
                "expected_content_hash": hash_value,
                "expires_at": utcnow() + timedelta(days=7),
            },
        )
        telegram.send_message(
            target_chat,
            f"<b>Gmail draft ready</b>\nSubject: {subject}\n\n{body}",
            reply_markup={
                "inline_keyboard": [
                    [{"text": "SEND DRAFT", "callback_data": f"send:{action_id}"}],
                ]
            },
        )
    return updated
