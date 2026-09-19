from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from pypdf import PdfWriter

from backend.extraction.extractor_flow import (
    DocumentExtractionError,
    GeminiServiceError,
)
from backend.extraction.schemas import (
    ComparisonStatus,
    DocumentInput,
    ExtractedDocument,
    ReviewReason,
)
from backend.extraction.service import process_document_pair


SI_TEXT = "SHIPPING INSTRUCTION\nShipper: APRIL FAR EAST"
BL_TEXT = "BILL OF LADING (DRAFT)\nShipper: APRIL FAR EAST"


def text_input(filename: str, text: str) -> DocumentInput:
    return DocumentInput(filename=filename, data=text.encode("utf-8"))


def blank_pdf_input(filename: str) -> DocumentInput:
    stream = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(stream)
    return DocumentInput(filename=filename, data=stream.getvalue())


def document(**overrides) -> ExtractedDocument:
    values = {
        "shipper": "APRIL FAR EAST (M) SDN BHD",
        "consignee": "MOORIM SP CO., LTD",
        "notify_party": "UAB NOVAKOPA",
        "port_of_loading": "PORT KLANG (WESTPORT), MALAYSIA",
        "port_of_discharge": "CALLAO, PERU",
        "container_count": 1,
        "gross_weight_kg": 21577,
    }
    return ExtractedDocument(**{**values, **overrides})


@pytest.mark.asyncio
async def test_missing_attachment_wins_without_calling_extractor():
    extractor = AsyncMock()

    result = await process_document_pair(
        text_input("si.txt", SI_TEXT), None, extractor=extractor
    )

    assert result.validation.review_reason == ReviewReason.MISSING_ATTACHMENT
    assert extractor.await_count == 0


@pytest.mark.asyncio
async def test_corrupt_document_returns_unreadable_without_calling_extractor():
    extractor = AsyncMock()

    result = await process_document_pair(
        DocumentInput("si.pdf", b"%PDF corrupt"),
        text_input("bl.txt", BL_TEXT),
        extractor=extractor,
    )

    assert result.validation.review_reason == ReviewReason.UNREADABLE
    assert extractor.await_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("si_text", "bl_text"),
    [
        (SI_TEXT, "COMMERCIAL INVOICE\nInvoice No: 1"),
        (BL_TEXT, BL_TEXT),
    ],
)
async def test_known_wrong_document_kind_wins_before_extraction(si_text, bl_text):
    extractor = AsyncMock()

    result = await process_document_pair(
        text_input("si.txt", si_text),
        text_input("bl.txt", bl_text),
        extractor=extractor,
    )

    assert result.validation.review_reason == ReviewReason.WRONG_DOC_TYPE
    assert extractor.await_count == 0


@pytest.mark.asyncio
async def test_si_and_bl_are_extracted_in_separate_source_isolated_calls():
    extractor = AsyncMock(side_effect=[document(), document()])

    result = await process_document_pair(
        text_input("si.txt", SI_TEXT),
        text_input("bl.txt", BL_TEXT),
        extractor=extractor,
    )

    assert result.validation.status == ComparisonStatus.OK
    assert extractor.await_count == 2
    assert extractor.await_args_list[0].args[0].text == SI_TEXT
    assert extractor.await_args_list[1].args[0].text == BL_TEXT


@pytest.mark.asyncio
async def test_unknown_structurally_valid_blank_pdfs_are_extracted_twice():
    extractor = AsyncMock(side_effect=[document(), document()])
    si = blank_pdf_input("si.pdf")
    bl = blank_pdf_input("bl.pdf")

    result = await process_document_pair(si, bl, extractor=extractor)

    assert result.validation.status == ComparisonStatus.OK
    assert extractor.await_count == 2
    assert extractor.await_args_list[0].args[0].data == si.data
    assert extractor.await_args_list[1].args[0].data == bl.data


@pytest.mark.asyncio
async def test_document_extraction_error_returns_unreadable():
    extractor = AsyncMock(side_effect=DocumentExtractionError("invalid response"))

    result = await process_document_pair(
        text_input("si.txt", SI_TEXT),
        text_input("bl.txt", BL_TEXT),
        extractor=extractor,
    )

    assert result.validation.review_reason == ReviewReason.UNREADABLE


@pytest.mark.asyncio
async def test_missing_extracted_value_requires_review():
    extractor = AsyncMock(side_effect=[document(), document(port_of_discharge=None)])

    result = await process_document_pair(
        text_input("si.txt", SI_TEXT),
        text_input("bl.txt", BL_TEXT),
        extractor=extractor,
    )

    assert result.validation.review_reason == ReviewReason.MISSING_VALUE


@pytest.mark.asyncio
async def test_mismatched_extracted_values_report_exact_fields():
    extractor = AsyncMock(
        side_effect=[document(), document(shipper="OTHER", gross_weight_kg=21578)]
    )

    result = await process_document_pair(
        text_input("si.txt", SI_TEXT),
        text_input("bl.txt", BL_TEXT),
        extractor=extractor,
    )

    assert result.validation.status == ComparisonStatus.MISMATCH
    assert result.validation.defect_fields == ["shipper", "gross_weight_kg"]


@pytest.mark.asyncio
async def test_gemini_service_error_propagates_unchanged():
    error = GeminiServiceError("Gemini unavailable")
    extractor = AsyncMock(side_effect=error)

    with pytest.raises(GeminiServiceError) as raised:
        await process_document_pair(
            text_input("si.txt", SI_TEXT),
            text_input("bl.txt", BL_TEXT),
            extractor=extractor,
        )

    assert raised.value is error
