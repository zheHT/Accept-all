import re
import unicodedata
from difflib import SequenceMatcher

from backend.core.schemas import (
    EmailCategory,
    GraderResult,
    ResultStatus,
    ReviewReason,
    ShippingDocument,
)

TEXT_FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
)
MISSING_MARKERS = {"", "?", "???", "_______", "TBA", "N/A", "NA", "UNKNOWN"}


def normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    value = unicodedata.normalize("NFKC", value).upper().strip()
    value = re.sub(r"[^A-Z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def is_missing(value: str | None) -> bool:
    return normalize_text(value) in MISSING_MARKERS


def compare_documents(
    si: ShippingDocument,
    bl: ShippingDocument,
    *,
    text_similarity_threshold: float = 0.85,
    weight_tolerance: float = 0.005,
) -> GraderResult:
    defect_fields: list[str] = []

    for field_name in TEXT_FIELDS:
        si_value = getattr(si, field_name).value
        bl_value = getattr(bl, field_name).value
        if is_missing(si_value) or is_missing(bl_value):
            return GraderResult(
                category=EmailCategory.BL_COMPARISON,
                status=ResultStatus.NEEDS_REVIEW,
                review_reason=ReviewReason.MISSING_VALUE,
            )
        ratio = SequenceMatcher(None, normalize_text(si_value), normalize_text(bl_value)).ratio()
        if ratio < text_similarity_threshold:
            defect_fields.append(field_name)

    si_count = si.container_count.value
    bl_count = bl.container_count.value
    si_weight = si.gross_weight_kg.value
    bl_weight = bl.gross_weight_kg.value
    if si_count is None or bl_count is None or si_weight is None or bl_weight is None:
        return GraderResult(
            category=EmailCategory.BL_COMPARISON,
            status=ResultStatus.NEEDS_REVIEW,
            review_reason=ReviewReason.MISSING_VALUE,
        )

    if int(si_count) != int(bl_count):
        defect_fields.append("container_count")

    denominator = max(abs(si_weight), 1.0)
    if abs(si_weight - bl_weight) / denominator > weight_tolerance:
        defect_fields.append("gross_weight_kg")

    if defect_fields:
        return GraderResult(
            category=EmailCategory.BL_COMPARISON,
            status=ResultStatus.MISMATCH,
            defect_fields=defect_fields,
            has_defect=True,
        )
    return GraderResult(category=EmailCategory.BL_COMPARISON, status=ResultStatus.OK)
