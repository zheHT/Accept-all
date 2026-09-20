from __future__ import annotations

from typing import Any

from googleapiclient.errors import HttpError

from backend.core.ingestion import stable_case_id
from backend.core.runtime import Runtime
from backend.core.schemas import TERMINAL_STATES


def ingest_gmail_message(runtime: Runtime, message_id: str) -> str | None:
    """Ingest a Gmail message into the ClassAll processing pipeline using canonical EmailEnvelope."""
    case_id = stable_case_id("gmail", message_id)
    existing = runtime.repository.get_case(case_id)
    if existing and existing.get("processing_state") in {s.value for s in TERMINAL_STATES}:
        return case_id

    message_data = runtime.gmail.get_message(message_id)
    envelope = runtime.gmail.parse_email_envelope(message_data)

    if runtime.repository.is_sender_blocked(envelope.sender):
        return None

    metadata = {
        "source_type": "gmail",
        "source_message_id": envelope.message_id,
        "sender": envelope.sender,
        "recipients": envelope.recipients,
        "subject": envelope.subject,
        "body": envelope.plain_text_body,
        "html_body": envelope.html_body,
        "received_at": envelope.received_at,
        "run_id": None,
        "owner_chat_id": runtime.settings.telegram_admin_chat_id or None,
        "gmail_thread_id": envelope.thread_id,
        "gmail_message_id_header": envelope.source_metadata.get("headers", {}).get("message-id", ""),
    }

    case, _ = runtime.ingestor.ingest(metadata, envelope.attachments)
    return case["case_id"]


def process_gmail_notification(runtime: Runtime, notification: dict[str, Any]) -> list[str]:
    """Process incoming Pub/Sub push notification from Gmail Watch."""
    latest_history_id = str(notification.get("historyId", ""))
    state = runtime.repository.get_gmail_state()

    if not state or not state.get("history_id"):
        case_ids = reconcile_recent_gmail(runtime)
        runtime.repository.set_gmail_state(
            {
                "history_id": latest_history_id,
                "email_address": notification.get("emailAddress"),
            }
        )
        return case_ids

    start_history_id = str(state["history_id"])
    try:
        history = runtime.gmail.history(start_history_id)
    except HttpError as exc:
        if exc.resp.status not in {404, 410}:
            raise
        case_ids = reconcile_recent_gmail(runtime)
        runtime.repository.set_gmail_state(
            {
                "history_id": latest_history_id,
                "email_address": notification.get("emailAddress"),
            }
        )
        return case_ids

    message_ids = {
        added["message"]["id"]
        for event in history.get("history", [])
        for added in event.get("messagesAdded", [])
        if "message" in added and "id" in added["message"]
    }

    case_ids = [
        case_id
        for msg_id in sorted(message_ids)
        if (case_id := ingest_gmail_message(runtime, msg_id)) is not None
    ]

    new_history_id = str(history.get("historyId") or latest_history_id)
    runtime.repository.set_gmail_state(
        {
            "history_id": new_history_id,
            "email_address": notification.get("emailAddress"),
        }
    )
    return case_ids


def reconcile_recent_gmail(runtime: Runtime, max_results: int | None = None) -> list[str]:
    """Periodic reconciliation job to recover any missed emails in target Gmail label."""
    label = runtime.settings.gmail_label or "INBOX"
    query = f"label:{label} newer_than:30d -in:spam -in:trash"
    messages = runtime.gmail.list_messages(query, max_results=max_results)
    return [
        case_id
        for item in messages
        if (case_id := ingest_gmail_message(runtime, item["id"])) is not None
    ]
