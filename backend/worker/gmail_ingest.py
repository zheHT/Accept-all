from __future__ import annotations

import base64
from email.utils import parseaddr
from pathlib import Path
from typing import Any

from backend.core.documents import SUPPORTED_EXTENSIONS
from backend.core.runtime import Runtime


def _decode(value: str | None) -> bytes:
    if not value:
        return b""
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _headers(message: dict[str, Any]) -> dict[str, str]:
    return {
        item["name"].lower(): item.get("value", "")
        for item in message.get("payload", {}).get("headers", [])
    }


def _walk_parts(part: dict[str, Any]) -> list[dict[str, Any]]:
    values = [part]
    for child in part.get("parts", []) or []:
        values.extend(_walk_parts(child))
    return values


def ingest_gmail_message(runtime: Runtime, message_id: str) -> str | None:
    message = runtime.gmail.get_message(message_id)
    headers = _headers(message)
    parts = _walk_parts(message.get("payload", {}))
    text_parts: list[str] = []
    attachments: list[tuple[str, str, bytes]] = []
    for part in parts:
        mime_type = part.get("mimeType", "")
        body = part.get("body", {})
        filename = part.get("filename", "")
        if mime_type == "text/plain" and body.get("data"):
            text_parts.append(_decode(body["data"]).decode("utf-8", errors="replace"))
        if filename and Path(filename).suffix.lower() in SUPPORTED_EXTENSIONS:
            if body.get("attachmentId"):
                data = runtime.gmail.get_attachment(message_id, body["attachmentId"])
            else:
                data = _decode(body.get("data"))
            attachments.append((filename, mime_type, data))
    if not attachments:
        return None
    sender = parseaddr(headers.get("reply-to") or headers.get("from", ""))[1]
    metadata = {
        "source_type": "gmail",
        "source_message_id": message_id,
        "sender": sender,
        "subject": headers.get("subject", ""),
        "body": "\n".join(text_parts).strip(),
        "run_id": None,
        "owner_chat_id": runtime.settings.telegram_admin_chat_id or None,
        "gmail_thread_id": message.get("threadId", ""),
        "gmail_message_id_header": headers.get("message-id", ""),
    }
    case, _ = runtime.ingestor.ingest(metadata, attachments)
    return case["case_id"]


def process_gmail_notification(runtime: Runtime, notification: dict[str, Any]) -> list[str]:
    latest_history_id = str(notification["historyId"])
    state = runtime.repository.get_gmail_state()
    if not state or not state.get("history_id"):
        runtime.repository.set_gmail_state(
            {"history_id": latest_history_id, "email_address": notification.get("emailAddress")}
        )
        return []
    history = runtime.gmail.history(str(state["history_id"]))
    message_ids = {
        added["message"]["id"]
        for event in history.get("history", [])
        for added in event.get("messagesAdded", [])
    }
    case_ids = [
        case_id
        for message_id in sorted(message_ids)
        if (case_id := ingest_gmail_message(runtime, message_id)) is not None
    ]
    runtime.repository.set_gmail_state(
        {
            "history_id": history.get("historyId", latest_history_id),
            "email_address": notification.get("emailAddress"),
        }
    )
    return case_ids


def reconcile_recent_gmail(runtime: Runtime) -> list[str]:
    messages = runtime.gmail.list_messages(
        "in:inbox has:attachment newer_than:7d -in:spam -in:trash", max_results=100
    )
    return [
        case_id
        for item in messages
        if (case_id := ingest_gmail_message(runtime, item["id"])) is not None
    ]
