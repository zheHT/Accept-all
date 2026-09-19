from backend.core.schemas import ExtractedField, ExtractedNumericField, ShippingDocument
from backend.core.validation import compare_documents, normalize_text


def document(**overrides):
    values = {
        "shipper": ExtractedField(value="APRIL International Enterprise Pte Ltd"),
        "consignee": ExtractedField(value="Example Paper Co."),
        "notify_party": ExtractedField(value="Example Logistics"),
        "port_of_loading": ExtractedField(value="Singapore"),
        "port_of_discharge": ExtractedField(value="Callao, Peru"),
        "container_count": ExtractedNumericField(value=4, unit="containers"),
        "gross_weight_kg": ExtractedNumericField(value=100_000, unit="kg"),
    }
    values.update(overrides)
    return ShippingDocument(**values)


def test_text_normalization_is_stable():
    assert normalize_text("  Callao,_Peru  ") == "CALLAO PERU"


def test_matching_documents_are_ok():
    result = compare_documents(document(), document())
    assert result.status == "OK"
    assert result.has_defect is False


def test_text_and_numeric_defects_are_reported():
    bl = document(
        consignee=ExtractedField(value="Different Company"),
        container_count=ExtractedNumericField(value=5, unit="containers"),
    )
    result = compare_documents(document(), bl)
    assert result.status == "MISMATCH"
    assert set(result.defect_fields) == {"consignee", "container_count"}


def test_weight_tolerance_and_missing_value():
    within = document(gross_weight_kg=ExtractedNumericField(value=100_400, unit="kg"))
    assert compare_documents(document(), within).status == "OK"
    missing = document(shipper=ExtractedField(value="TBA"))
    result = compare_documents(document(), missing)
    assert result.status == "NEEDS_REVIEW"
    assert result.review_reason == "missing_value"
