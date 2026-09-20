from typing import Any

from backend.extraction.schemas import (
    ComparisonStatus,
    ExtractedDocument,
    ReviewReason,
    ValidationResult,
)


FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)


def needs_review(
    reason: ReviewReason,
) -> ValidationResult:
    return ValidationResult(
        status=ComparisonStatus.NEEDS_REVIEW,
        has_defect=False,
        defect_fields=[],
        review_reason=reason,
    )


def _normalize(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(value.split()).casefold()

    return value


def validate_documents(
    si: ExtractedDocument,
    bl: ExtractedDocument,
) -> ValidationResult:
    if any(
        getattr(si, field) is None
        or getattr(bl, field) is None
        for field in FIELDS
    ):
        return needs_review(
            ReviewReason.MISSING_VALUE,
        )

    defect_fields = [
        field
        for field in FIELDS
        if _normalize(getattr(si, field))
        != _normalize(getattr(bl, field))
    ]

    if defect_fields:
        return ValidationResult(
            status=ComparisonStatus.MISMATCH,
            has_defect=True,
            defect_fields=defect_fields,
        )

    return ValidationResult(
        status=ComparisonStatus.OK,
        has_defect=False,
        defect_fields=[],
    )
