from __future__ import annotations

import base64
import json
import re
from collections.abc import Callable
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parseaddr
from typing import Any

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from backend.core.schemas import EmailEnvelope

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify"


def _decode_b64(value: str | None) -> bytes:
    if not value:
        return b""
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _walk_parts(part: dict[str, Any]) -> list[dict[str, Any]]:
    parts = [part]
    for child in part.get("parts", []) or []:
        parts.extend(_walk_parts(child))
    return parts


def _client_config(raw: str) -> dict[str, Any]:
    if not raw or not raw.strip():
        raise RuntimeError(
            "Gmail OAuth client JSON is not configured. Please set the GMAIL_OAUTH_CLIENT_JSON "
            "secret in Google Secret Manager or environment."
        )
    try:
        value = json.loads(raw)
    except Exception as exc:
        raise ValueError(
            f"Invalid Gmail OAuth client JSON: expecting valid JSON but got: {exc}"
        ) from exc
    if not isinstance(value, dict) or ("web" not in value and "installed" not in value):
        raise ValueError("Gmail OAuth client JSON must contain web or installed configuration")
    return value


class GmailClient:
    def __init__(
        self,
        client_json: str,
        refresh_token: str = "",
        redirect_uri: str = "",
        address: str = "me",
        refresh_token_provider: Callable[[], str] | None = None,
        label: str = "INBOX",
    ) -> None:
        self.client_json = client_json
        self.refresh_token = refresh_token
        self.redirect_uri = redirect_uri
        self.address = address or "me"
        self.refresh_token_provider = refresh_token_provider
        self.label = label or "INBOX"

    def authorization_url(self, state: str) -> str:
        flow = Flow.from_client_config(
            _client_config(self.client_json), scopes=[GMAIL_SCOPE], state=state
        )
        flow.redirect_uri = self.redirect_uri
        url, _ = flow.authorization_url(
            access_type="offline", include_granted_scopes="true", prompt="consent"
        )
        return url

    def exchange_code(self, code: str, state: str) -> Credentials:
        flow = Flow.from_client_config(
            _client_config(self.client_json), scopes=[GMAIL_SCOPE], state=state
        )
        flow.redirect_uri = self.redirect_uri
        flow.fetch_token(code=code)
        return flow.credentials

    @property
    def is_configured(self) -> bool:
        if not self.client_json or not self.client_json.strip():
            return False
        try:
            config = _client_config(self.client_json)
            return bool(config.get("web") or config.get("installed"))
        except Exception:
            return False

    def _credentials(self) -> Credentials:
        if not self.is_configured:
            raise RuntimeError(
                "Gmail OAuth client is not configured. Please set the GMAIL_OAUTH_CLIENT_JSON secret."
            )
        config = _client_config(self.client_json)
        app = config.get("web") or config["installed"]
        refresh_token = (
            self.refresh_token_provider() if self.refresh_token_provider else self.refresh_token
        )
        if not refresh_token:
            raise RuntimeError("Gmail refresh token is not configured")
        return Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri=app["token_uri"],
            client_id=app["client_id"],
            client_secret=app["client_secret"],
            scopes=[GMAIL_SCOPE],
        )

    def service(self) -> Any:
        return build("gmail", "v1", credentials=self._credentials(), cache_discovery=False)

    def renew_watch(self, topic_name: str) -> dict[str, Any]:
        return (
            self.service()
            .users()
            .watch(
                userId=self.address,
                body={
                    "topicName": topic_name,
                    "labelIds": [self.label],
                    "labelFilterBehavior": "INCLUDE",
                },
            )
            .execute()
        )

    def history(self, start_history_id: str) -> dict[str, Any]:
        service = self.service()
        events: list[dict[str, Any]] = []
        page_token: str | None = None
        latest_history_id = start_history_id
        while True:
            request = service.users().history().list(
                userId=self.address,
                startHistoryId=start_history_id,
                historyTypes=["messageAdded"],
                labelId=self.label,
                pageToken=page_token,
            )
            page = request.execute()
            events.extend(page.get("history", []))
            latest_history_id = str(page.get("historyId") or latest_history_id)
            page_token = page.get("nextPageToken")
            if not page_token:
                return {"history": events, "historyId": latest_history_id}

    def parse_email_envelope(self, message_data: dict[str, Any]) -> EmailEnvelope:
        """Parse raw Gmail message payload into canonical EmailEnvelope."""
        message_id = message_data.get("id", "")
        thread_id = message_data.get("threadId", "")
        headers = {
            item.get("name", "").lower(): item.get("value", "")
            for item in message_data.get("payload", {}).get("headers", [])
        }

        sender = parseaddr(headers.get("reply-to") or headers.get("from", ""))[1] or headers.get("from", "")
        recipients_raw = [headers.get("to", ""), headers.get("cc", "")]
        recipients = [addr for _, addr in getaddresses([r for r in recipients_raw if r]) if addr]

        subject = headers.get("subject", "")
        received_at = headers.get("date") or message_data.get("internalDate")

        parts = _walk_parts(message_data.get("payload", {}))
        plain_text_parts: list[str] = []
        html_parts: list[str] = []
        attachments: list[tuple[str, str, bytes]] = []

        for part in parts:
            mime_type = part.get("mimeType", "")
            body = part.get("body", {})
            filename = part.get("filename", "")

            # Plain text body part
            if not filename and mime_type == "text/plain" and body.get("data"):
                plain_text_parts.append(_decode_b64(body["data"]).decode("utf-8", errors="replace"))
            # HTML body part
            elif not filename and mime_type == "text/html" and body.get("data"):
                html_parts.append(_decode_b64(body["data"]).decode("utf-8", errors="replace"))

            # Attachment part
            if filename:
                att_id = body.get("attachmentId")
                if att_id:
                    att_data = self.get_attachment(message_id, att_id)
                elif body.get("data"):
                    att_data = _decode_b64(body.get("data"))
                else:
                    att_data = b""
                attachments.append((filename, mime_type, att_data))

        plain_text = "\n".join(plain_text_parts).strip()
        html_body = "\n".join(html_parts).strip()

        # If plain text is empty but HTML is present, strip HTML tags for plain text fallback
        if not plain_text and html_body:
            plain_text = re.sub(r"<[^>]+>", " ", html_body)
            plain_text = re.sub(r"\s+", " ", plain_text).strip()

        return EmailEnvelope(
            message_id=message_id,
            thread_id=thread_id,
            sender=sender,
            recipients=recipients,
            subject=subject,
            plain_text_body=plain_text,
            html_body=html_body,
            received_at=str(received_at) if received_at else None,
            attachments=attachments,
            source_metadata={
                "headers": headers,
                "label_ids": message_data.get("labelIds", []),
                "snippet": message_data.get("snippet", ""),
            },
        )

    def get_message(self, message_id: str) -> dict[str, Any]:
        return (
            self.service()
            .users()
            .messages()
            .get(userId=self.address, id=message_id, format="full")
            .execute()
        )

    def list_messages(
        self, query: str, max_results: int | None = None
    ) -> list[dict[str, str]]:
        service = self.service()
        messages: list[dict[str, str]] = []
        page_token: str | None = None
        while True:
            remaining = None if max_results is None else max_results - len(messages)
            if remaining is not None and remaining <= 0:
                return messages
            page = (
                service.users()
                .messages()
                .list(
                    userId=self.address,
                    q=query,
                    maxResults=min(500, remaining) if remaining is not None else 500,
                    pageToken=page_token,
                )
                .execute()
            )
            messages.extend(page.get("messages", []))
            page_token = page.get("nextPageToken")
            if not page_token:
                return messages

    def get_attachment(self, message_id: str, attachment_id: str) -> bytes:
        result = (
            self.service()
            .users()
            .messages()
            .attachments()
            .get(userId=self.address, messageId=message_id, id=attachment_id)
            .execute()
        )
        return base64.urlsafe_b64decode(result["data"])

    def create_reply_draft(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        thread_id: str,
        message_id_header: str = "",
        attachments: list[tuple[str, str, bytes]] | None = None,
    ) -> dict[str, Any]:
        message = EmailMessage()
        message["To"] = to
        message["Subject"] = subject
        if message_id_header:
            message["In-Reply-To"] = message_id_header
            message["References"] = message_id_header
        message.set_content(body)
        for filename, content_type, data in attachments or []:
            if not data:
                continue
            ct = content_type or "application/octet-stream"
            if "/" in ct:
                maintype, subtype = ct.split("/", 1)
            else:
                maintype, subtype = "application", "octet-stream"
            message.add_attachment(
                data,
                maintype=maintype,
                subtype=subtype,
                filename=filename,
            )
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        return (
            self.service()
            .users()
            .drafts()
            .create(userId=self.address, body={"message": {"raw": raw, "threadId": thread_id}})
            .execute()
        )

    def update_draft(
        self, draft_id: str, *, to: str, subject: str, body: str, thread_id: str
    ) -> dict[str, Any]:
        message = EmailMessage()
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        return (
            self.service()
            .users()
            .drafts()
            .update(
                userId=self.address,
                id=draft_id,
                body={"id": draft_id, "message": {"raw": raw, "threadId": thread_id}},
            )
            .execute()
        )

    def get_draft(self, draft_id: str) -> dict[str, Any]:
        return (
            self.service()
            .users()
            .drafts()
            .get(userId=self.address, id=draft_id, format="raw")
            .execute()
        )

    def get_draft_content(self, draft_id: str) -> dict[str, str]:
        draft = self.get_draft(draft_id)
        raw = base64.urlsafe_b64decode(draft["message"]["raw"])
        message = BytesParser(policy=policy.default).parsebytes(raw)
        body = message.get_body(preferencelist=("plain",))
        return {
            "to": str(message.get("To", "")),
            "subject": str(message.get("Subject", "")),
            "body": body.get_content().strip() if body else "",
        }

    def send_draft(self, draft_id: str) -> dict[str, Any]:
        return (
            self.service()
            .users()
            .drafts()
            .send(userId=self.address, body={"id": draft_id})
            .execute()
        )
