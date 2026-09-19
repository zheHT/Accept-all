from __future__ import annotations

import base64
import json
from collections.abc import Callable
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from typing import Any

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify"


def _client_config(raw: str) -> dict[str, Any]:
    value = json.loads(raw)
    if "web" not in value and "installed" not in value:
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
    ) -> None:
        self.client_json = client_json
        self.refresh_token = refresh_token
        self.redirect_uri = redirect_uri
        self.address = address or "me"
        self.refresh_token_provider = refresh_token_provider

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

    def _credentials(self) -> Credentials:
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
                    "labelIds": ["INBOX"],
                    "labelFilterBehavior": "INCLUDE",
                },
            )
            .execute()
        )

    def history(self, start_history_id: str) -> dict[str, Any]:
        return (
            self.service()
            .users()
            .history()
            .list(
                userId=self.address,
                startHistoryId=start_history_id,
                historyTypes=["messageAdded"],
                labelId="INBOX",
            )
            .execute()
        )

    def get_message(self, message_id: str) -> dict[str, Any]:
        return (
            self.service()
            .users()
            .messages()
            .get(userId=self.address, id=message_id, format="full")
            .execute()
        )

    def list_messages(self, query: str, max_results: int = 100) -> list[dict[str, str]]:
        result = (
            self.service()
            .users()
            .messages()
            .list(userId=self.address, q=query, maxResults=max_results)
            .execute()
        )
        return result.get("messages", [])

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
    ) -> dict[str, Any]:
        message = EmailMessage()
        message["To"] = to
        message["Subject"] = subject
        if message_id_header:
            message["In-Reply-To"] = message_id_header
            message["References"] = message_id_header
        message.set_content(body)
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
