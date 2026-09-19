from pydantic import ValidationError

from backend.models.schemas import (
    EmailCategory,
    EmailClassification,
    EmailInputPayload,
    SubmissionItem,
)


def test_email_categories():
    assert EmailCategory.DOCUMENT_COMPARISON == "DOCUMENT_COMPARISON"
    assert EmailCategory.NEW_SI_REQUEST == "NEW_SI_REQUEST"
    assert EmailCategory.INVOICE_QUERY == "INVOICE_QUERY"
    assert EmailCategory.GENERAL == "GENERAL"
    assert EmailCategory.SPAM == "SPAM"
    assert len(EmailCategory) == 5


def test_email_classification_valid():
    item = EmailClassification(
        category=EmailCategory.DOCUMENT_COMPARISON,
        confidence=0.95,
        reasoning="Draft BL and SI attached for cross-check.",
        is_comparison_candidate=True,
        missing_attachments_flag=False,
        detected_attachments=["bl.txt", "si.txt"],
    )
    assert item.category == EmailCategory.DOCUMENT_COMPARISON
    assert item.confidence == 0.95
    assert item.is_comparison_candidate is True
    assert item.missing_attachments_flag is False
    assert len(item.detected_attachments) == 2


def test_email_classification_confidence_bounds():
    # ge=0.0, le=1.0
    threw_high = False
    try:
        EmailClassification(
            category=EmailCategory.GENERAL,
            confidence=1.5,  # Out of bounds
            reasoning="Too high confidence",
            is_comparison_candidate=False,
        )
    except ValidationError:
        threw_high = True
    assert threw_high, "Expected ValidationError for confidence > 1.0"

    threw_low = False
    try:
        EmailClassification(
            category=EmailCategory.GENERAL,
            confidence=-0.1,  # Out of bounds
            reasoning="Too low confidence",
            is_comparison_candidate=False,
        )
    except ValidationError:
        threw_low = True
    assert threw_low, "Expected ValidationError for confidence < 0.0"


def test_email_input_payload():
    payload = EmailInputPayload(
        email_id="email_100",
        subject="Draft B/L verification",
        body="Please check attached docs",
        sender="shipper@example.com",
        attachments=["email_100_BL.txt"],
    )
    assert payload.email_id == "email_100"
    assert payload.subject == "Draft B/L verification"
    assert payload.attachments == ["email_100_BL.txt"]


def test_submission_item_shape():
    sub = SubmissionItem(
        category="DOCUMENT_COMPARISON",
        status="NEEDS_REVIEW",
        review_reason="Missing or unreadable attachment files",
        has_defect=None,
        defect_fields=[],
    )
    dumped = sub.model_dump()
    assert dumped["category"] == "DOCUMENT_COMPARISON"
    assert dumped["status"] == "NEEDS_REVIEW"
    assert dumped["review_reason"] == "Missing or unreadable attachment files"
    assert dumped["has_defect"] is None
    assert dumped["defect_fields"] == []
