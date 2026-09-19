import base64
from typing import Any

from backend.core.documents import extract_text
from backend.core.gmail import GmailClient
from backend.core.processing import CaseProcessor
from backend.core.schemas import (
    DocumentExtraction,
    DocumentType,
    EmailCategory,
    EmailEnvelope,
    ModelExtraction,
    ResultStatus,
    ReviewReason,
)
from backend.worker.gmail_ingest import (
    ingest_gmail_message,
    process_gmail_notification,
    reconcile_recent_gmail,
)


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("utf-8").rstrip("=")


def _make_gmail_message(
    message_id: str,
    subject: str = "Test Subject",
    sender: str = "shipper@example.com",
    to: str = "ops@classall.com",
    cc: str = "logistics@client.com",
    plain_text: str = "Hello from plain text",
    html_text: str = "<p>Hello from <b>HTML</b></p>",
    attachments: list[tuple[str, str, bytes]] | None = None,
) -> dict[str, Any]:
    parts = [
        {
            "mimeType": "text/plain",
            "filename": "",
            "body": {"data": _b64(plain_text)},
        },
        {
            "mimeType": "text/html",
            "filename": "",
            "body": {"data": _b64(html_text)},
        },
    ]
    for filename, mime_type, data in attachments or []:
        parts.append(
            {
                "mimeType": mime_type,
                "filename": filename,
                "body": {"data": base64.urlsafe_b64encode(data).decode().rstrip("=")},
            }
        )

    return {
        "id": message_id,
        "threadId": f"thread-{message_id}",
        "internalDate": "1773839200000",
        "labelIds": ["INBOX", "UNREAD"],
        "snippet": plain_text[:50],
        "payload": {
            "headers": [
                {"name": "From", "value": f"Shipper Name <{sender}>"},
                {"name": "To", "value": to},
                {"name": "Cc", "value": cc},
                {"name": "Subject", "value": subject},
                {"name": "Date", "value": "Sat, 19 Sep 2026 12:00:00 +0000"},
                {"name": "Message-ID", "value": f"<{message_id}@mail.example.com>"},
            ],
            "parts": parts,
        },
    }


def test_parse_email_envelope_multipart():
    client = GmailClient(
        client_json='{"web":{"client_id":"cid","client_secret":"cs","token_uri":"http://token"}}',
        label="INBOX",
    )
    raw_message = _make_gmail_message(
        message_id="msg_001",
        subject="TO CONFIRM DOCS _ 5RSG-00133",
        sender="shipper@shipping.com",
        to="ops@classall.com",
        cc="customs@broker.com",
        plain_text="Please cross-check SI against draft BL.",
        html_text="<div>Please <b>cross-check</b> SI against draft BL.</div>",
        attachments=[
            ("SI_5RSG00133.txt", "text/plain", b"Shipper: Moorim Paper\nPort: Callao"),
            ("Draft_BL.pdf", "application/pdf", b"%PDF-1.4 sample pdf content"),
        ],
    )

    envelope = client.parse_email_envelope(raw_message)
    assert isinstance(envelope, EmailEnvelope)
    assert envelope.message_id == "msg_001"
    assert envelope.thread_id == "thread-msg_001"
    assert envelope.sender == "shipper@shipping.com"
    assert "ops@classall.com" in envelope.recipients
    assert "customs@broker.com" in envelope.recipients
    assert envelope.subject == "TO CONFIRM DOCS _ 5RSG-00133"
    assert "cross-check SI against draft BL" in envelope.plain_text_body
    assert "<b>cross-check</b>" in envelope.html_body
    assert len(envelope.attachments) == 2
    assert envelope.attachments[0][0] == "SI_5RSG00133.txt"
    assert envelope.attachments[1][0] == "Draft_BL.pdf"


def test_missing_attachment_governance(runtime):
    """Emails arriving with 0 attachments must not be dropped; they should ingest and flag MISSING_ATTACHMENT."""
    message_id = "msg_no_att_01"
    msg_data = _make_gmail_message(
        message_id=message_id,
        subject="URGENT: Draft BL Comparison - MSCU88123",
        plain_text="Please check our draft BL against SI urgently. (Forgot to attach files)",
        attachments=[],
    )

    runtime.gmail.get_message = lambda mid: msg_data
    runtime.router.generator = lambda model, subj, body, atts: ModelExtraction(
        category=EmailCategory.BL_COMPARISON,
        confidence_score=0.98,
        rationale="Comparison requested",
        assumptions=[],
        documents=[],
    )

    case_id = ingest_gmail_message(runtime, message_id)
    assert case_id is not None

    # Case exists in repository
    case = runtime.repository.get_case(case_id)
    assert case is not None
    assert case["source_message_id"] == message_id

    # Run case through CaseProcessor
    processor = CaseProcessor(runtime.repository, runtime.blobs, runtime.router)
    completed = processor.process(case_id)

    assert completed is not None
    res = completed["result"]
    assert res["status"] == ResultStatus.NEEDS_REVIEW.value
    assert res["review_reason"] == ReviewReason.MISSING_ATTACHMENT.value


def test_unsupported_attachment_governance(runtime):
    """Unsupported or corrupt files must be ingested and flagged UNREADABLE or WRONG_DOC_TYPE instead of crashing."""
    message_id = "msg_bad_att_02"
    msg_data = _make_gmail_message(
        message_id=message_id,
        subject="TO CONFIRM DOCS _ BKG-99210",
        plain_text="Attached are the files for booking 99210.",
        attachments=[
            ("SI_Doc.bin", "application/octet-stream", b"\x00\x01\x02\x03corrupt-blob"),
            ("BL_Doc.xyz", "application/octet-stream", b"\xff\xfe\xfd"),
        ],
    )

    runtime.gmail.get_message = lambda mid: msg_data
    runtime.router.generator = lambda model, subj, body, atts: ModelExtraction(
        category=EmailCategory.BL_COMPARISON,
        confidence_score=0.95,
        rationale="Files provided",
        assumptions=[],
        documents=[
            DocumentExtraction(filename="SI_Doc.bin", document_type=DocumentType.SI, readable=False),
            DocumentExtraction(filename="BL_Doc.xyz", document_type=DocumentType.BL, readable=False),
        ],
    )

    # Must NOT raise ValueError on ingestion
    case_id = ingest_gmail_message(runtime, message_id)
    assert case_id is not None

    # Documents stored in repository
    docs = runtime.repository.list_documents(case_id)
    assert len(docs) == 2

    # extract_text returns readable=False
    text, readable = extract_text("SI_Doc.bin", b"\x00\x01\x02\x03corrupt-blob")
    assert readable is False

    # Process case
    processor = CaseProcessor(runtime.repository, runtime.blobs, runtime.router)
    completed = processor.process(case_id)
    assert completed is not None
    res = completed["result"]
    assert res["status"] == ResultStatus.NEEDS_REVIEW.value
    assert res["review_reason"] in [
        ReviewReason.UNREADABLE.value,
        ReviewReason.WRONG_DOC_TYPE.value,
    ]


def test_pubsub_notification_advances_history_cursor(runtime):
    """Pub/Sub notifications must ingest new messages and advance the repository history_id cursor."""
    runtime.repository.set_gmail_state({"history_id": "1000", "email_address": "test@example.com"})

    msg_data = _make_gmail_message(
        message_id="msg_history_01",
        subject="SI Inquiry",
        plain_text="Please find info.",
        attachments=[],
    )
    runtime.gmail.get_message = lambda mid: msg_data

    # Mock history listing
    runtime.gmail.history = lambda start_id: {
        "historyId": "1005",
        "history": [
            {
                "messagesAdded": [
                    {"message": {"id": "msg_history_01", "threadId": "t1"}}
                ]
            }
        ],
    }

    notification = {"historyId": "1005", "emailAddress": "test@example.com"}
    case_ids = process_gmail_notification(runtime, notification)

    assert len(case_ids) == 1
    new_state = runtime.repository.get_gmail_state()
    assert new_state["history_id"] == "1005"

    # Idempotent second push should not re-ingest duplicate cases
    runtime.gmail.history = lambda start_id: {"historyId": "1005", "history": []}
    case_ids_second = process_gmail_notification(runtime, notification)
    assert len(case_ids_second) == 0
    assert runtime.repository.get_gmail_state()["history_id"] == "1005"


def test_custom_gmail_label_configuration(runtime):
    """Verify GmailClient and reconciliation query respect custom GMAIL_LABEL."""
    runtime.settings.gmail_label = "CLASSALL_INBOX"
    client = GmailClient(
        client_json='{"web":{"client_id":"c","client_secret":"s","token_uri":"http://t"}}',
        label=runtime.settings.gmail_label,
    )
    assert client.label == "CLASSALL_INBOX"

    captured_query = []
    runtime.gmail.list_messages = lambda q, max_results=100: captured_query.append(q) or []

    reconcile_recent_gmail(runtime)
    assert len(captured_query) == 1
    assert "label:CLASSALL_INBOX" in captured_query[0]
