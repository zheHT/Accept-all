import pytest

from backend.extraction.schemas import ComparisonStatus, ExtractedDocument, ReviewReason, ValidationResult
from backend.extraction.validator import validate_documents


BASE = {
    "shipper": "APRIL FAR EAST (M) SDN BHD",
    "consignee": "MOORIM SP CO., LTD",
    "notify_party": "UAB NOVAKOPA",
    "port_of_loading": "PORT KLANG (WESTPORT), MALAYSIA",
    "port_of_discharge": "CALLAO, PERU",
    "container_count": 1,
    "gross_weight_kg": 21577,
}


def document(**overrides) -> ExtractedDocument:
    return ExtractedDocument(**{**BASE, **overrides})


def test_matching_documents_are_ok():
    assert validate_documents(document(), document()) == ValidationResult(
        status=ComparisonStatus.OK,
        has_defect=False,
        defect_fields=[],
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("shipper", "OTHER SHIPPER"),
        ("consignee", "OTHER CONSIGNEE"),
        ("notify_party", "OTHER NOTIFY"),
        ("port_of_loading", "SINGAPORE"),
        ("port_of_discharge", "TUTICORIN, INDIA"),
        ("container_count", 2),
        ("gross_weight_kg", 21578),
    ],
)
def test_each_field_is_reported_as_a_mismatch(field, value):
    result = validate_documents(document(), document(**{field: value}))
    assert result.status == ComparisonStatus.MISMATCH
    assert result.has_defect is True
    assert result.defect_fields == [field]


def test_multiple_differences_use_stable_field_order():
    result = validate_documents(
        document(),
        document(
            gross_weight_kg=21578,
            shipper="OTHER SHIPPER",
            port_of_loading="SINGAPORE",
        ),
    )
    assert result.defect_fields == ["shipper", "port_of_loading", "gross_weight_kg"]


def test_same_port_code_does_not_hide_different_port_names():
    result = validate_documents(
        document(port_of_discharge="MOMBASA, KENYA"),
        document(port_of_discharge="TUTICORIN, INDIA"),
    )
    assert result.defect_fields == ["port_of_discharge"]


def test_any_null_field_requires_review_before_comparison():
    result = validate_documents(document(port_of_discharge=None), document())
    assert result == ValidationResult(
        status=ComparisonStatus.NEEDS_REVIEW,
        has_defect=False,
        defect_fields=[],
        review_reason=ReviewReason.MISSING_VALUE,
    )


def test_case_and_repeated_whitespace_are_equivalent():
    result = validate_documents(
        document(shipper="APRIL FAR EAST (M) SDN BHD"),
        document(shipper="  april   far east (m) sdn bhd  "),
    )
    assert result.status == ComparisonStatus.OK
