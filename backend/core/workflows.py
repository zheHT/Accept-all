from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from pathlib import Path
from typing import Any

from backend.core.blob_store import BlobStore
from backend.core.draft_generator import (
    build_compose_url,
    build_saved_draft_url,
    generate_correction_draft,
)
from backend.core.gmail import GmailClient
from backend.core.repository import CaseRepository, utcnow
from backend.core.security import content_hash
from backend.core.telegram import TelegramClient

logger = logging.getLogger(__name__)


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
        "Regards,\nShipVerify Document Review"
    )
    return subject, body


def create_case_draft(
    repository: CaseRepository,
    gmail: GmailClient,
    telegram: TelegramClient,
    case: dict[str, Any],
    chat_id: str | None = None,
    blobs: BlobStore | None = None,
    explainer: Any | None = None,
    unresolved_fields: list[str] | None = None,
    comparisons: list[dict[str, Any]] | None = None,
    field_reviews: dict[str, Any] | None = None,
    set_decline: bool = False,
) -> dict[str, Any]:
    if case.get("source_type") != "gmail":
        raise ValueError("email drafts are available only for Gmail-sourced cases")
    recipient = case.get("sender", "")
    if not recipient or "noreply" in recipient.lower() or "no-reply" in recipient.lower():
        raise ValueError("the original sender cannot receive a correction reply")

    subject, body, origin = generate_correction_draft(
        case,
        comparisons=comparisons,
        field_reviews=field_reviews or case.get("field_reviews"),
        unresolved_fields=unresolved_fields or case.get("unresolved_fields"),
        explainer=explainer,
    )

    # Collect case attachments (documents uploaded for this case)
    attachments: list[tuple[str, str, bytes]] = []
    case_docs = repository.list_documents(case["case_id"])
    for doc in case_docs:
        filename = doc.get("filename") or f"document_{doc.get('document_id', 'file')}.pdf"
        content_type = doc.get("content_type") or "application/octet-stream"
        data: bytes | None = None
        if blobs and doc.get("gcs_uri"):
            try:
                data = blobs.download(doc["gcs_uri"])
            except Exception as err:
                logger.warning("Could not download blob %s for draft: %s", doc.get("gcs_uri"), err)
        if not data and doc.get("raw_text"):
            stem = Path(filename).stem
            filename = f"{stem}_extracted.txt"
            content_type = "text/plain"
            data = doc["raw_text"].encode("utf-8")
        if data:
            attachments.append((filename, content_type, data))

    draft_id: str | None = None
    draft_url: str | None = None
    has_live_gmail = False

    if getattr(gmail, "is_configured", False):
        try:
            draft = gmail.create_reply_draft(
                to=recipient,
                subject=subject,
                body=body,
                thread_id=case.get("gmail_thread_id", ""),
                message_id_header=case.get("gmail_message_id_header", ""),
                attachments=attachments,
            )
            draft_id = draft.get("id")
            if draft_id:
                draft_url = build_saved_draft_url(draft_id, getattr(gmail, "address", "me"))
                has_live_gmail = True
        except Exception as exc:
            logger.warning(
                "Gmail API draft creation failed, falling back to ShipVerify compose URL: %s",
                exc,
            )

    delivery_mode = "live" if has_live_gmail else "compose"
    if not draft_id:
        draft_id = f"draft-{case['case_id']}"
    if not draft_url:
        draft_url = build_compose_url(recipient, subject, body)

    hash_value = content_hash(subject, body)
    prep_stamp = utcnow().isoformat()
    correction_draft = {
        "state": "READY",
        "subject": subject,
        "body": body,
        "content_hash": hash_value,
        "origin": origin,
        "delivery_mode": delivery_mode,
        "gmail_draft_id": draft_id,
        "gmail_url": draft_url,
        "attachments": [att[0] for att in attachments],
        "prepared_at": prep_stamp,
        "sent_at": None,
        "sent_by": None,
        "to": recipient,
    }

    update_payload: dict[str, Any] = {
        "correction_draft": correction_draft,
        "gmail_draft_id": draft_id,
        "gmail_draft_url": draft_url,
        "draft_subject": subject,
        "draft_body": body,
        "draft_content_hash": hash_value,
        "draft_state": "READY",
        "draft_attachments": [att[0] for att in attachments],
        "has_live_gmail": has_live_gmail,
    }
    if set_decline:
        update_payload["review_decision"] = "DECLINE"

    updated = repository.update_case(
        case["case_id"],
        update_payload,
        expected_version=case.get("version"),
    )
    repository.append_event(
        case["case_id"],
        "correction_draft_prepared",
        {
            "draft_id": draft_id,
            "origin": origin,
            "delivery_mode": delivery_mode,
            "has_live_gmail": has_live_gmail,
            "attachment_count": len(attachments),
            "attachments": [att[0] for att in attachments],
        },
    )
    repository.append_event(
        case["case_id"],
        "gmail_draft_created",
        {
            "draft_id": draft_id,
            "has_live_gmail": has_live_gmail,
            "attachment_count": len(attachments),
            "attachments": [att[0] for att in attachments],
        },
    )

    target_chat = chat_id or case.get("owner_chat_id")
    if target_chat:
        action_id = secrets.token_urlsafe(12)
        repository.create_action(
            action_id,
            {
                "action": "send_draft" if has_live_gmail else "confirm_sent",
                "case_id": case["case_id"],
                "chat_id": str(target_chat),
                "expected_version": updated["version"],
                "expected_content_hash": hash_value,
                "expires_at": utcnow() + timedelta(days=7),
            },
        )
        keyboard = []
        if draft_url:
            open_label = "OPEN IN GMAIL" if has_live_gmail else "OPEN GMAIL COMPOSE"
            keyboard.append([{"text": open_label, "url": draft_url}])
        if has_live_gmail:
            keyboard.append([{"text": "SEND DRAFT", "callback_data": f"send:{action_id}"}])
        else:
            keyboard.append([{"text": "CONFIRM SENT", "callback_data": f"confirm_sent:{action_id}"}])
        att_text = (
            f"\n\n📎 <b>Attachments:</b> {', '.join(att[0] for att in attachments)}"
            if attachments
            else ""
        )
        telegram.send_message(
            target_chat,
            f"<b>Gmail draft ready</b>\nSubject: {subject}\n\n{body}{att_text}",
            reply_markup={"inline_keyboard": keyboard},
        )
    return updated


def create_category_response_draft(
    repository: CaseRepository,
    gmail: GmailClient,
    telegram: TelegramClient,
    case: dict[str, Any],
    subject: str,
    body: str,
    attachments: list[tuple[str, str, bytes]] | None = None,
    chat_id: str | None = None,
    origin: str = "template",
) -> dict[str, Any]:
    recipient = case.get("sender", "")
    attachments = attachments or []

    draft_id: str | None = None
    draft_url: str | None = None
    has_live_gmail = False

    if getattr(gmail, "is_configured", False) and recipient:
        try:
            draft = gmail.create_reply_draft(
                to=recipient,
                subject=subject,
                body=body,
                thread_id=case.get("gmail_thread_id", ""),
                message_id_header=case.get("gmail_message_id_header", ""),
                attachments=attachments,
            )
            draft_id = draft.get("id")
            if draft_id:
                draft_url = build_saved_draft_url(draft_id, getattr(gmail, "address", "me"))
                has_live_gmail = True
        except Exception as exc:
            logger.warning("Gmail API draft creation failed, falling back to ShipVerify compose URL: %s", exc)

    delivery_mode = "live" if has_live_gmail else "compose"
    if not draft_id:
        draft_id = f"draft-{case['case_id']}"
    if not draft_url:
        draft_url = build_compose_url(recipient, subject, body)

    hash_value = content_hash(subject, body)
    prep_stamp = utcnow().isoformat()
    correction_draft = {
        "state": "READY",
        "subject": subject,
        "body": body,
        "content_hash": hash_value,
        "origin": origin,
        "delivery_mode": delivery_mode,
        "gmail_draft_id": draft_id,
        "gmail_url": draft_url,
        "attachments": [att[0] for att in attachments],
        "prepared_at": prep_stamp,
        "sent_at": None,
        "sent_by": None,
        "to": recipient,
    }

    update_payload: dict[str, Any] = {
        "correction_draft": correction_draft,
        "gmail_draft_id": draft_id,
        "gmail_draft_url": draft_url,
        "draft_subject": subject,
        "draft_body": body,
        "draft_content_hash": hash_value,
        "draft_state": "READY",
        "draft_attachments": [att[0] for att in attachments],
        "has_live_gmail": has_live_gmail,
    }

    updated = repository.update_case(
        case["case_id"],
        update_payload,
        expected_version=case.get("version"),
    )
    repository.append_event(
        case["case_id"],
        "category_draft_prepared",
        {
            "draft_id": draft_id,
            "origin": origin,
            "delivery_mode": delivery_mode,
            "has_live_gmail": has_live_gmail,
            "attachment_count": len(attachments),
            "attachments": [att[0] for att in attachments],
        },
    )

    target_chat = chat_id or case.get("owner_chat_id")
    if target_chat:
        action_id = secrets.token_urlsafe(12)
        repository.create_action(
            action_id,
            {
                "action": "send_draft" if has_live_gmail else "confirm_sent",
                "case_id": case["case_id"],
                "chat_id": str(target_chat),
                "expected_version": updated["version"],
                "expected_content_hash": hash_value,
                "expires_at": utcnow() + timedelta(days=7),
            },
        )
        keyboard = []
        if draft_url:
            open_label = "OPEN IN GMAIL" if has_live_gmail else "OPEN GMAIL COMPOSE"
            keyboard.append([{"text": open_label, "url": draft_url}])
        if has_live_gmail:
            keyboard.append([{"text": "SEND DRAFT", "callback_data": f"send:{action_id}"}])
        else:
            keyboard.append([{"text": "CONFIRM SENT", "callback_data": f"confirm_sent:{action_id}"}])
        att_text = (
            f"\n\n📎 <b>Attachments:</b> {', '.join(att[0] for att in attachments)}"
            if attachments
            else ""
        )
        telegram.send_message(
            target_chat,
            f"<b>Gmail draft ready</b>\nSubject: {subject}\n\n{body}{att_text}",
            reply_markup={"inline_keyboard": keyboard},
        )
    return updated

