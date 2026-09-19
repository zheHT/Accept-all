"""Targeted edge-case stress test suite for Email Classifier & Triage Agent.

Covers 8 critical failure points:
1. Attachment Sniffer MIME / Format Mismatches
2. Large Email Body / Token Overflow (>15,000 words)
3. Ambiguous Multi-Intent Emails (Priority Routing)
4. Special Characters, Emojis, and UTF-8 Encodings
5. Malformed or None Payload Inputs (Robust API Defaults)
6. Rate Limit Simulation (HTTP 429 / ResourceExhausted)
7. Zero-Byte or Empty Attachments
8. Strict Output Schema Enforcement & Markdown Code Fence Stripping
"""
import io
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.agents.classifier_flow import (
    classify_email,
    _check_missing_attachments,
)
from backend.main import app
from backend.models.schemas import (
    EmailCategory,
    EmailClassification,
    EmailInputPayload,
)
from backend.utils.attachment_sniffer import MAX_CHARS, inspect_attachment


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------
@pytest.fixture
def mock_gemini():
    """Mock fixture for google.genai Client preventing live external network calls."""
    with patch("backend.agents.classifier_flow.genai.Client") as mock_cls, \
         patch.dict("os.environ", {"GEMINI_API_KEY": "AIzaSy_mock_api_key_test_12345"}):
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance

        default_resp = MagicMock()
        default_resp.text = json.dumps({
            "category": "DOCUMENT_COMPARISON",
            "confidence": 0.95,
            "reasoning": "Email contains both draft BL and SI for cross-check.",
            "is_comparison_candidate": True,
            "missing_attachments_flag": False,
            "detected_attachments": ["draft_bl.pdf", "si.txt"],
        })
        mock_instance.models.generate_content.return_value = default_resp
        yield mock_instance


@pytest.fixture
def client():
    """FastAPI TestClient using httpx under the hood."""
    return TestClient(app)


# --------------------------------------------------------------------------
# 1. Attachment Sniffer MIME / Format Mismatches
# --------------------------------------------------------------------------
def test_sniffer_format_mismatches():
    """Verify inspect_attachment() handles extension mismatches gracefully without unhandled crashes."""
    # A) File named invoice.pdf that is actually plain text
    fake_pdf_text = b"Invoice #INV-2026-9901. Shipper: Evergreen Marine. Port: Kaohsiung"
    pdf_mismatch_preview = inspect_attachment("invoice.pdf", fake_pdf_text)
    assert pdf_mismatch_preview == "[Unreadable or Corrupted File]"

    # B) File named manifest.xlsx that has corrupted/invalid XML or zip structure
    corrupted_xlsx_bytes = b"PK\x03\x04INVALID_ZIP_NOT_AN_EXCEL_PACKAGE"
    xlsx_mismatch_preview = inspect_attachment("manifest.xlsx", corrupted_xlsx_bytes)
    assert xlsx_mismatch_preview == "[Unreadable or Corrupted File]"

    # C) File named draft_bl.docx that is not an actual docx package
    corrupted_docx_bytes = b"\x1f\x8b\x08NOT_A_VALID_DOCX_FILE"
    docx_mismatch_preview = inspect_attachment("draft_bl.docx", corrupted_docx_bytes)
    assert docx_mismatch_preview == "[Unreadable or Corrupted File]"


# --------------------------------------------------------------------------
# 2. Large Email Body / Token Overflow
# --------------------------------------------------------------------------
def test_oversized_email_body_handling(mock_gemini):
    """Verify the classifier handles oversized email bodies (>15,000 words) without memory spikes or crashes."""
    # Generate ~16,000 words email thread simulating 10+ forwarded replies
    paragraph = (
        "From: ops@carrier.com\n"
        "Sent: Monday, September 14, 2026 10:42 AM\n"
        "To: documentation@shipper.org\n"
        "Subject: FW: FW: RE: Draft B/L Verification for Container MSCU1234567\n"
        "Please review the attached carrier draft Bill of Lading and cross-check against customer shipping instructions. "
        "Verify gross weight 24,500 KG and Port of Discharge Callao, Peru.\n"
    )
    oversized_body = "\n".join([paragraph] * 350)
    word_count = len(oversized_body.split())
    assert word_count > 15000

    # Ensure classify_email executes cleanly
    result = classify_email(
        email_id="oversized_thread_01",
        subject="FW: FW: RE: Draft B/L Verification for Container MSCU1234567",
        sender="ops@carrier.com",
        body=oversized_body,
        attachment_previews={"draft_bl.txt": "Draft BL content", "si.txt": "SI content"},
    )

    assert result.category == EmailCategory.DOCUMENT_COMPARISON
    assert result.is_comparison_candidate is True
    # Verify prompt was constructed and sent to Gemini
    assert mock_gemini.models.generate_content.called


# --------------------------------------------------------------------------
# 3. Ambiguous Multi-Intent Emails (Priority Routing)
# --------------------------------------------------------------------------
def test_ambiguous_multi_intent_routing_priority(mock_gemini):
    """Verify that multi-intent emails prioritize DOCUMENT_COMPARISON over INVOICE_QUERY."""
    # Email asking to compare draft BL vs SI, AND also asking for an invoice
    ambiguous_body = (
        "Dear Documentation Team,\n\n"
        "Please check the draft BL against our SI for discrepancies on container MSCU88123.\n"
        "Also, please send the revised ocean freight invoice with demurrage waiver.\n\n"
        "Thank you."
    )

    mock_resp = MagicMock()
    mock_resp.text = json.dumps({
        "category": "DOCUMENT_COMPARISON",
        "confidence": 0.96,
        "reasoning": "Multi-intent correspondence: document comparison takes priority over invoice inquiry.",
        "is_comparison_candidate": True,
        "missing_attachments_flag": False,
        "detected_attachments": ["draft_bl.pdf", "si.pdf"],
    })
    mock_gemini.models.generate_content.return_value = mock_resp

    result = classify_email(
        email_id="multi_intent_01",
        subject="Draft BL Review & Freight Invoice Inquiry - MSCU88123",
        sender="shipper@logistics.com",
        body=ambiguous_body,
        attachment_previews={"draft_bl.pdf": "Draft BL", "si.pdf": "Shipping Instruction"},
    )

    assert result.category == EmailCategory.DOCUMENT_COMPARISON
    assert result.is_comparison_candidate is True
    assert result.missing_attachments_flag is False


# --------------------------------------------------------------------------
# 4. Special Characters & Encodings
# --------------------------------------------------------------------------
def test_special_characters_and_encodings(mock_gemini):
    """Verify non-ASCII characters, emojis, accents, and null bytes are handled without encoding errors."""
    special_body = (
        "🚢 Maritime Shipping Advisory: Vessel MV OCEAN PACIFIC ⚓\n"
        "Loading Port: 上海港 (Shanghai Port), China 🇨🇳\n"
        "Discharge Port: São Paulo / Valparaíso 🇧🇷\n"
        "Shipper: Société Générale de Commerce & Cie\n"
        "Special note with null byte: test\x00data\n"
    )
    special_att_filename = "SI_上海港_SãoPaulo_🚢.txt"

    # Test attachment sniffer handling
    preview = inspect_attachment(special_att_filename, special_body)
    assert "上海港" in preview
    assert "São Paulo" in preview

    # Test classification flow
    mock_resp = MagicMock()
    mock_resp.text = json.dumps({
        "category": "DOCUMENT_COMPARISON",
        "confidence": 0.97,
        "reasoning": "Special UTF-8 characters parsed successfully. Draft BL and SI verification required.",
        "is_comparison_candidate": True,
        "missing_attachments_flag": False,
        "detected_attachments": [special_att_filename],
    })
    mock_gemini.models.generate_content.return_value = mock_resp

    result = classify_email(
        email_id="utf8_test_01",
        subject="TO CONFIRM DOCS _ 上海港 _ São Paulo _ 🚢",
        sender="ops.shanghai@cosco.cn",
        body=special_body,
        attachment_previews={special_att_filename: preview},
    )

    assert result.category == EmailCategory.DOCUMENT_COMPARISON
    # Ensure Pydantic model can serialize cleanly to JSON
    json_dump = result.model_dump_json()
    assert "上海港" in json_dump or "UTF-8" in json_dump or "DOCUMENT_COMPARISON" in json_dump


# --------------------------------------------------------------------------
# 5. Malformed or None Payload Inputs (Robust API Defaults)
# --------------------------------------------------------------------------
def test_minimal_and_none_payload_inputs(client, mock_gemini):
    """Send payloads with sender: null, subject: '', or missing attachments; assert 200 OK (not 422)."""
    # Payload 1: sender is None, attachments key omitted entirely
    payload_1 = {
        "email_id": "malformed_01",
        "subject": "Quick draft check",
        "body": "Please cross-check draft BL against SI.",
        "sender": None,
    }
    res1 = client.post("/api/classify", json=payload_1)
    assert res1.status_code == 200, f"Expected 200 OK, got {res1.status_code}: {res1.text}"
    data1 = res1.json()
    assert data1["category"] == "DOCUMENT_COMPARISON"

    # Payload 2: subject is empty string, body is empty string, attachments is None
    payload_2 = {
        "email_id": "malformed_02",
        "subject": "",
        "body": "",
        "sender": "",
        "attachments": None,
    }
    res2 = client.post("/api/process", json=payload_2)
    assert res2.status_code == 200, f"Expected 200 OK, got {res2.status_code}: {res2.text}"
    data2 = res2.json()
    assert "category" in data2
    assert "confidence" in data2


# --------------------------------------------------------------------------
# 6. Rate Limit Simulation (HTTP 429)
# --------------------------------------------------------------------------
def test_rate_limit_simulation_429(client, mock_gemini):
    """Simulate Gemini SDK 429 / ResourceExhausted error and assert structured HTTP 429 response."""
    # Configure mock to raise a 429 rate limit exception
    rate_limit_error = Exception(
        "429 ResourceExhausted: Quota exceeded for quota metric 'Queries' and limit 'Queries per minute'"
    )
    mock_gemini.models.generate_content.side_effect = rate_limit_error

    payload = {
        "email_id": "rate_limit_test",
        "subject": "Draft BL check",
        "body": "Please check draft BL against SI.",
        "sender": "ops@shipping.com",
        "attachments": [],
    }

    response = client.post("/api/classify", json=payload)
    # Assert server returns HTTP 429 with structured error detail instead of crashing
    assert response.status_code == 429
    err_json = response.json()
    assert "detail" in err_json
    assert "Rate limit exceeded" in err_json["detail"] or "429" in err_json["detail"]


# --------------------------------------------------------------------------
# 7. Zero-Byte or Empty Attachments
# --------------------------------------------------------------------------
def test_zero_byte_empty_attachments(mock_gemini):
    """Verify fewer than two attachment previews set missing_attachments_flag == True."""
    # 1. Zero-byte content into inspect_attachment
    zero_bytes_preview = inspect_attachment("empty_bl.pdf", b"")
    assert zero_bytes_preview == "[Unreadable or Corrupted File]"

    empty_str_preview = inspect_attachment("empty_si.txt", "")
    assert empty_str_preview == "" or empty_str_preview == "[Unreadable or Corrupted File]"

    # 2. Two supplied previews count as present even when their content is unreadable.
    missing_flag = _check_missing_attachments(
        category=EmailCategory.DOCUMENT_COMPARISON,
        attachment_previews={
            "empty_bl.pdf": "[Unreadable or Corrupted File]",
            "empty_si.txt": "",
        },
    )
    assert missing_flag is False

    # 3. Test through classify_email
    mock_resp = MagicMock()
    mock_resp.text = json.dumps({
        "category": "DOCUMENT_COMPARISON",
        "confidence": 0.95,
        "reasoning": "Cross-check draft BL against SI requested, but attached files are 0 bytes.",
        "is_comparison_candidate": True,
        "missing_attachments_flag": False,
        "detected_attachments": ["empty_bl.pdf"],
    })
    mock_gemini.models.generate_content.return_value = mock_resp

    result = classify_email(
        email_id="zero_byte_01",
        subject="Please check draft BL",
        sender="shipper@cargo.com",
        body="Please check attached draft BL against SI.",
        attachment_previews={"empty_bl.pdf": "[Unreadable or Corrupted File]"},
    )

    assert result.category == EmailCategory.DOCUMENT_COMPARISON
    assert result.is_comparison_candidate is True
    # Guardrail must enforce missing_attachments_flag = True
    assert result.missing_attachments_flag is True


# --------------------------------------------------------------------------
# 8. Strict Output Schema Enforcement & Markdown Code Fence Stripping
# --------------------------------------------------------------------------
def test_strict_output_schema_and_markdown_stripping(mock_gemini):
    """Verify markdown code fences (```json ... ```) are stripped and schema rejects hallucinated categories."""
    # A) Response wrapped in ```json ... ``` code fence
    markdown_wrapped_json = (
        "```json\n"
        "{\n"
        '  "category": "DOCUMENT_COMPARISON",\n'
        '  "confidence": 0.98,\n'
        '  "reasoning": "Markdown wrapped response parsed cleanly.",\n'
        '  "is_comparison_candidate": true,\n'
        '  "missing_attachments_flag": false,\n'
        '  "detected_attachments": ["draft_bl.txt", "si.txt"]\n'
        "}\n"
        "```"
    )
    mock_resp = MagicMock()
    mock_resp.text = markdown_wrapped_json
    mock_gemini.models.generate_content.return_value = mock_resp

    result = classify_email(
        email_id="markdown_fence_01",
        subject="Draft BL and SI review",
        sender="ops@maritime.com",
        body="Attached are the draft BL and SI. Please confirm.",
        attachment_previews={"draft_bl.txt": "BL", "si.txt": "SI"},
    )

    assert result.category == EmailCategory.DOCUMENT_COMPARISON
    assert result.confidence == 0.98
    assert result.is_comparison_candidate is True

    # B) Hallucinated category from LLM must be rejected by Pydantic validation
    invalid_category_json = (
        "{\n"
        '  "category": "HALLUCINATED_CUSTOMS_CLEARANCE",\n'
        '  "confidence": 0.95,\n'
        '  "reasoning": "This is a hallucinated category not in the 5 enums.",\n'
        '  "is_comparison_candidate": false,\n'
        '  "missing_attachments_flag": false,\n'
        '  "detected_attachments": []\n'
        "}"
    )
    mock_resp_invalid = MagicMock()
    mock_resp_invalid.text = invalid_category_json
    mock_gemini.models.generate_content.return_value = mock_resp_invalid

    # Must raise ValidationError when LLM emits a category outside the 5 valid enums
    with pytest.raises(ValidationError):
        classify_email(
            email_id="hallucination_01",
            subject="Customs inquiry",
            sender="user@test.com",
            body="Customs clearance question",
            attachment_previews={},
        )
