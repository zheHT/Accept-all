from dataclasses import FrozenInstanceError

import pytest
from pydantic import ValidationError

from backend.extraction import DocumentInput, DocumentPairResult
from backend.extraction.schemas import (
    ComparisonStatus,
    DocumentKind,
    ExtractedDocument,
    PreparedDocument,
    ReviewReason,
    ValidationResult,
)


VALID = {
    "shipper": "APRIL FAR EAST (M) SDN BHD",
    "consignee": "MOORIM SP CO., LTD",
    "notify_party": "UAB NOVAKOPA",
    "port_of_loading": "PORT KLANG (WESTPORT), MALAYSIA",
    "port_of_discharge": "CALLAO, PERU",
    "container_count": 1,
    "gross_weight_kg": 21577,
}


def test_extracted_document_has_exact_required_nullable_fields():
    assert set(ExtractedDocument.model_fields) == set(VALID)
    assert ExtractedDocument(**{**VALID, "shipper": None}).shipper is None


def test_extracted_document_rejects_missing_and_extra_keys():
    with pytest.raises(ValidationError):
        ExtractedDocument(
            **{key: value for key, value in VALID.items() if key != "shipper"}
        )
    with pytest.raises(ValidationError):
        ExtractedDocument(**VALID, booking_number="BKG-1")


def test_schema_contracts_and_public_exports_are_available():
    assert DocumentInput("si.pdf", b"data") == DocumentInput("si.pdf", b"data")
    assert PreparedDocument("si.pdf", "application/pdf") == PreparedDocument(
        "si.pdf", "application/pdf"
    )
    assert DocumentPairResult(validation=ValidationResult(
        status=ComparisonStatus.OK,
        has_defect=False,
        defect_fields=[],
    )).si is None
    assert DocumentKind.SI.value == "SI"
    assert ReviewReason.MISSING_VALUE.value == "missing_value"


def test_document_inputs_and_prepared_documents_are_immutable():
    document = DocumentInput("si.pdf", b"data")
    with pytest.raises(FrozenInstanceError):
        document.filename = "other.pdf"
