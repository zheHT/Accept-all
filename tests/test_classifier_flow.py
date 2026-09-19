"""Unit tests for classifier flow and triage rules."""
import json
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from backend.agents.classifier_flow import classify_email, _check_missing_attachments
from backend.models.schemas import EmailCategory


@pytest.fixture(autouse=True)
def fake_gemini_client():
    """Exercise classifier parsing with complete offline SDK responses."""
    def generate_content(*, contents, **_):
        text = contents.lower()
        if "seo" in text or "marketing" in text:
            category = "SPAM"
        elif "invoice" in text or "demurrage" in text:
            category = "INVOICE_QUERY"
        elif "new shipping instruction" in text or "booking creation" in text:
            category = "NEW_SI_REQUEST"
        elif "draft" in text or "cross-check" in text or "confirm docs" in text:
            category = "DOCUMENT_COMPARISON"
        else:
            category = "GENERAL"
        return SimpleNamespace(text=json.dumps({
            "category": category,
            "confidence": 0.95,
            "reasoning": "Offline Gemini response for classifier contract testing.",
            "is_comparison_candidate": category == "DOCUMENT_COMPARISON",
            "missing_attachments_flag": False,
            "detected_attachments": [],
        }))

    client = MagicMock()
    client.models.generate_content.side_effect = generate_content
    with patch("backend.agents.classifier_flow.genai.Client", return_value=client), patch.dict(
        os.environ, {"GEMINI_API_KEY": "test-key"}
    ):
        yield client


def test_classify_document_comparison():
    res = classify_email(
        email_id="test_001",
        subject="TO CONFIRM DOCS _ DRAFT BL AND SI",
        sender="willy@shipping.com",
        body="Attached are the SI and draft BL for OC 5RSG-00133. Please check the details and confirm if anything is mismatched.",
        attachment_previews={
            "email_001_SI.txt": "Shipper: Moorim Paper\nConsignee: PaperOne Inc\nWeight: 24000kg",
            "email_001_BL.txt": "Shipper: Moorim Paper\nConsignee: PaperOne Inc\nWeight: 24000kg",
        },
    )
    assert res.category == EmailCategory.DOCUMENT_COMPARISON
    assert res.is_comparison_candidate is True
    assert res.missing_attachments_flag is False
    assert 0.0 <= res.confidence <= 1.0


def test_classify_deceptive_subject_document_comparison():
    # Deceptive subject line must be overridden by body intent
    res = classify_email(
        email_id="test_002",
        subject="General Inquiry regarding our order",
        sender="client@tradex.com",
        body="Dear customer service, please cross-check the draft B/L against the attached shipping instructions and verify the ports match.",
        attachment_previews={
            "si.txt": "Port of Loading: Singapore",
            "draft_bl.txt": "Port of Loading: Singapore",
        },
    )
    assert res.category == EmailCategory.DOCUMENT_COMPARISON
    assert res.is_comparison_candidate is True
    assert res.missing_attachments_flag is False


def test_classify_new_si_request():
    res = classify_email(
        email_id="test_003",
        subject="New Shipping Instruction - Booking BKG-88910",
        sender="shipper@export.com",
        body="Dear Operations, please find attached our new Shipping Instruction for booking creation. Please file SI accordingly.",
        attachment_previews={
            "SI_BKG88910.txt": "Shipper: Apex Cargo\nConsignee: Global Tech",
        },
    )
    assert res.category == EmailCategory.NEW_SI_REQUEST
    assert res.is_comparison_candidate is False
    assert res.missing_attachments_flag is False


def test_classify_invoice_query():
    res = classify_email(
        email_id="test_004",
        subject="Dispute on Demurrage Invoice INV-2026-991",
        sender="finance@importer.com",
        body="We received freight billing invoice INV-2026-991 including demurrage charges of $500. Container was returned in time, please issue credit note.",
        attachment_previews={
            "INV-2026-991.pdf": "Invoice INV-2026-991\nDemurrage charges: $500",
        },
    )
    assert res.category == EmailCategory.INVOICE_QUERY
    assert res.is_comparison_candidate is False


def test_classify_general_schedule():
    res = classify_email(
        email_id="test_005",
        subject="Vessel Delay Notice - MV OCEAN STAR V.120N",
        sender="ops@carrier.com",
        body="Please be advised that MV OCEAN STAR V.120N is experiencing delays due to typhoon. Revised ETA at Busan is 25-Sep.",
        attachment_previews={},
    )
    assert res.category == EmailCategory.GENERAL
    assert res.is_comparison_candidate is False


def test_classify_spam():
    res = classify_email(
        email_id="test_006",
        subject="Grow your revenue with our SEO services & email marketing!",
        sender="sales@boostpromo.net",
        body="We offer special discount on SEO marketing campaigns to get #1 Google ranking. Unsubscribe if not interested.",
        attachment_previews={},
    )
    assert res.category == EmailCategory.SPAM
    assert res.is_comparison_candidate is False


def test_missing_attachments_guardrail():
    # Document comparison request but NO attachments provided
    res = classify_email(
        email_id="test_007",
        subject="Please verify draft BL against SI",
        sender="ops@customer.com",
        body="Please verify the draft BL against our SI urgently. Attached are the files (forgot to attach).",
        attachment_previews={},
    )
    assert res.category == EmailCategory.DOCUMENT_COMPARISON
    assert res.is_comparison_candidate is True
    assert res.missing_attachments_flag is True


def test_scanned_attachment_markers_count_as_present():
    # Document comparison has two supplied PDFs even when downstream review is needed.
    res = classify_email(
        email_id="test_008",
        subject="Confirm draft B/L with SI",
        sender="ops@customer.com",
        body="Please check and cross-check the draft BL against SI.",
        attachment_previews={
            "draft_bl.pdf": "[PDF document: original bytes retained]",
            "si.pdf": "[PDF document: original bytes retained]",
        },
    )
    assert res.category == EmailCategory.DOCUMENT_COMPARISON
    assert res.is_comparison_candidate is True
    assert res.missing_attachments_flag is False
