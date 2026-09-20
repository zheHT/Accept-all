from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class ComparisonStatus(StrEnum):
    OK = "OK"
    MISMATCH = "MISMATCH"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class ReviewReason(StrEnum):
    WRONG_DOC_TYPE = "wrong_doc_type"
    MISSING_ATTACHMENT = "missing_attachment"
    UNREADABLE = "unreadable"
    MISSING_VALUE = "missing_value"


class DocumentKind(StrEnum):
    SI = "SI"
    BL = "BL"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class ExtractedDocument(BaseModel):
    """
    Exactly seven fields.

    Keys are mandatory, but values are nullable because null means:
    "I could not reliably extract this from THIS document."
    """

    model_config = ConfigDict(extra="forbid")

    shipper: str | None
    consignee: str | None
    notify_party: str | None
    port_of_loading: str | None
    port_of_discharge: str | None
    container_count: int | None
    gross_weight_kg: int | None


class ValidationResult(BaseModel):
    status: ComparisonStatus
    has_defect: bool
    defect_fields: list[str]
    review_reason: ReviewReason | None = None


class DocumentPairResult(BaseModel):
    si: ExtractedDocument | None = None
    bl: ExtractedDocument | None = None
    validation: ValidationResult


@dataclass(frozen=True)
class DocumentInput:
    filename: str
    data: bytes
    mime_type: str | None = None


@dataclass(frozen=True)
class PreparedDocument:
    filename: str
    mime_type: str

    # Text-like documents use this.
    text: str | None = None

    # PDFs use this.
    data: bytes | None = None