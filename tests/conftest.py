from __future__ import annotations

from pathlib import Path

import pytest

from backend.core.blob_store import LocalBlobStore
from backend.core.config import Settings
from backend.core.explainer import CaseExplainer
from backend.core.gmail import GmailClient
from backend.core.inference import ModelRouter
from backend.core.ingestion import CaseIngestor
from backend.core.knowledge_publisher import KnowledgePublisher
from backend.core.publisher import MemoryPublisher
from backend.core.repository import InMemoryRepository
from backend.core.runtime import Runtime


class FakeTelegram:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str, dict | None]] = []
        self.callbacks: list[tuple[str, str]] = []

    def send_message(self, chat_id, text, *, reply_markup=None):
        self.messages.append((str(chat_id), text, reply_markup))
        return {"message_id": len(self.messages)}

    def answer_callback(self, callback_query_id, text):
        self.callbacks.append((callback_query_id, text))

    def send_chat_action(self, chat_id, action="typing"):
        return {"ok": True}

    def edit_message_text(self, chat_id, message_id, text, *, reply_markup=None):
        idx = int(message_id) - 1
        if 0 <= idx < len(self.messages):
            self.messages[idx] = (str(chat_id), text, reply_markup)
            return {"message_id": message_id}
        self.messages.append((str(chat_id), text, reply_markup))
        return {"message_id": len(self.messages)}

    def delete_message(self, chat_id, message_id):
        return True

    def get_file(self, file_id):
        return b"document", f"documents/{file_id}.txt"


class FakeNotifier:
    def __init__(self) -> None:
        self.cases: list[dict] = []

    def send_review_alert(self, case):
        self.cases.append(case)

    def send_spam_alert(self, case):
        self.cases.append(case)


class FakeGmail(GmailClient):
    def __init__(self) -> None:
        super().__init__(
            client_json='{"web":{"client_id":"x","client_secret":"y","token_uri":"http://token"}}',
            label="INBOX",
        )
        self.drafts: dict[str, dict[str, str]] = {}
        self.sent: list[str] = []

    def get_attachment(self, message_id: str, attachment_id: str) -> bytes:
        return b"fake attachment data"

    def create_reply_draft(
        self,
        *,
        to,
        subject,
        body,
        thread_id,
        message_id_header="",
        attachments=None,
    ):
        del message_id_header
        draft_id = f"draft-{len(self.drafts) + 1}"
        self.drafts[draft_id] = {
            "to": to,
            "subject": subject,
            "body": body,
            "thread_id": thread_id,
            "attachments": attachments or [],
        }
        return {"id": draft_id}

    def update_draft(self, draft_id, *, to, subject, body, thread_id):
        self.drafts[draft_id] = {"to": to, "subject": subject, "body": body, "thread_id": thread_id}
        return {"id": draft_id}

    def get_draft_content(self, draft_id):
        return self.drafts[draft_id].copy()

    def send_draft(self, draft_id):
        self.sent.append(draft_id)
        return {"id": f"sent-{draft_id}"}


@pytest.fixture
def runtime(tmp_path: Path) -> Runtime:
    settings = Settings(
        app_env="test",
        grader_ingest_key="test-key",
        telegram_webhook_secret="webhook-secret",
        telegram_bot_token="fake-token",
        gmail_oauth_client_json='{"web":{"client_id":"x","client_secret":"y","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","redirect_uris":["http://localhost"]}}',
    )
    repository = InMemoryRepository()
    blobs = LocalBlobStore(tmp_path / "blobs")
    publisher = MemoryPublisher()
    telegram = FakeTelegram()
    gmail = FakeGmail()
    router = ModelRouter(
        project="test",
        location="global",
        primary_model="primary",
        fallback_model="fallback",
        generator=lambda *_: (_ for _ in ()).throw(RuntimeError("set a test generator")),
    )
    explainer = CaseExplainer("test", "global", "primary", enabled=False)
    knowledge_publisher = KnowledgePublisher(
        repository=repository,
        explainer=explainer,
    )
    return Runtime(
        settings=settings,
        repository=repository,
        blobs=blobs,
        publisher=publisher,
        ingestor=CaseIngestor(repository, blobs, publisher, max_upload_bytes=1024 * 1024),
        router=router,
        explainer=explainer,
        telegram=telegram,  # type: ignore[arg-type]
        notifier=FakeNotifier(),  # type: ignore[arg-type]
        gmail=gmail,  # type: ignore[arg-type]
        knowledge_publisher=knowledge_publisher,
    )
