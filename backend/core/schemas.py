from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class EmailCategory(StrEnum):
    BL_COMPARISON = "BL_COMPARISON"
    SI_REQUEST = "SI_REQUEST"
    INVOICE_QUERY = "INVOICE_QUERY"
    GENERAL = "GENERAL"
    SPAM = "SPAM"


class ResultStatus(StrEnum):
    OK = "OK"
    MISMATCH = "MISMATCH"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class ReviewReason(StrEnum):
    WRONG_DOC_TYPE = "wrong_doc_type"
    MISSING_ATTACHMENT = "missing_attachment"
    UNREADABLE = "unreadable"
    MISSING_VALUE = "missing_value"
    LOW_CONFIDENCE = "low_confidence"


class ProcessingState(StrEnum):
    DRAFT = "DRAFT"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    TERMINAL = "TERMINAL"
    DEAD_LETTER = "DEAD_LETTER"


class IngestionState(StrEnum):
    PENDING = "PENDING"
    DOCUMENTS_STORED = "DOCUMENTS_STORED"
    TASK_PUBLISHED = "TASK_PUBLISHED"


class ReviewDecision(StrEnum):
    APPROVE = "APPROVE"
    DECLINE = "DECLINE"


class DocumentType(StrEnum):
    SI = "SI"
    BL = "BL"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class DocumentRoute(BaseModel):
    filename: str
    document_type: DocumentType


class EmailClassification(BaseModel):
    category: EmailCategory
    confidence_score: float = Field(ge=0.0, le=1.0)
    rationale: str
    assumptions: list[str] = Field(default_factory=list)
    documents: list[DocumentRoute] = Field(default_factory=list)


class ExtractedField(BaseModel):
    value: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    evidence: str | None = None
    assumption: str | None = None


class ExtractedNumericField(BaseModel):
    value: float | None = None
    unit: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    evidence: str | None = None
    assumption: str | None = None


class ShippingDocument(BaseModel):
    shipper: ExtractedField = Field(default_factory=ExtractedField)
    consignee: ExtractedField = Field(default_factory=ExtractedField)
    notify_party: ExtractedField = Field(default_factory=ExtractedField)
    port_of_loading: ExtractedField = Field(default_factory=ExtractedField)
    port_of_discharge: ExtractedField = Field(default_factory=ExtractedField)
    container_count: ExtractedNumericField = Field(
        default_factory=lambda: ExtractedNumericField(unit="containers")
    )
    gross_weight_kg: ExtractedNumericField = Field(
        default_factory=lambda: ExtractedNumericField(unit="kg")
    )


class DocumentExtraction(BaseModel):
    filename: str
    document_type: DocumentType
    readable: bool = True
    fields: ShippingDocument | None = None
    rationale: str = ""


class ModelExtraction(BaseModel):
    category: EmailCategory
    confidence_score: float = Field(ge=0.0, le=1.0)
    rationale: str
    assumptions: list[str] = Field(default_factory=list)
    documents: list[DocumentExtraction] = Field(default_factory=list)


class GraderResult(BaseModel):
    category: EmailCategory
    status: ResultStatus
    review_reason: ReviewReason | None = None
    defect_fields: list[str] = Field(default_factory=list)
    has_defect: bool = False

    @model_validator(mode="after")
    def enforce_contract(self) -> GraderResult:
        if self.status == ResultStatus.MISMATCH:
            if not self.has_defect or not self.defect_fields or self.review_reason is not None:
                raise ValueError("MISMATCH requires defect fields and no review reason")
        elif self.status == ResultStatus.NEEDS_REVIEW:
            if self.review_reason is None or self.has_defect or self.defect_fields:
                raise ValueError("NEEDS_REVIEW requires one review reason and no defects")
        elif self.has_defect or self.defect_fields or self.review_reason is not None:
            raise ValueError("OK cannot contain defects or a review reason")
        return self


class IngestMetadata(BaseModel):
    source_type: str
    source_message_id: str
    sender: str = ""
    subject: str = ""
    body: str = ""
    run_id: str | None = None
    owner_chat_id: str | None = None


class ReviewRequest(BaseModel):
    decision: ReviewDecision
    expected_version: int = Field(ge=0)
    note: str = ""


class ExplainRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


class DraftUpdateRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=998)
    body: str = Field(min_length=1, max_length=20000)
    expected_version: int = Field(ge=0)


class DraftSendRequest(BaseModel):
    expected_version: int = Field(ge=0)
    expected_content_hash: str = Field(min_length=64, max_length=64)


class PlatformSettingsUpdate(BaseModel):
    confidence_threshold: float = Field(ge=0.5, le=1.0)
    mismatch_alerts_enabled: bool


class PlatformSettingsView(PlatformSettingsUpdate):
    low_confidence_requires_review: bool = True
    missing_value_requires_review: bool = True
    unreadable_requires_review: bool = True


class StoredDocument(BaseModel):
    document_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    gcs_uri: str


class CaseView(BaseModel):
    case_id: str
    source_type: str
    source_message_id: str
    processing_state: ProcessingState
    result: GraderResult | None = None
    version: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssumptionRecord(BaseModel):
    assumption_id: str
    field: str
    normalized_value: str
    evidence_count: int = 1
    confidence: float = 1.0
    case_links: list[str] = Field(default_factory=list)
    status: str = "proposed"  # proposed, accepted, rejected, superseded
    last_confirmed_by: str | None = None
    last_confirmed_date: str | None = None
    created_at: str = ""


class KnowledgeBaseWeekRecord(BaseModel):
    week: str  # e.g. 2026-W38
    drive_file_id: str | None = None
    drive_url: str | None = None
    preview_uri: str | None = None
    content_hash: str
    source_watermark: str = ""
    published_at: str
    status: str = "published"
    cases_analyzed: int = 0
    status_counts: dict[str, int] = Field(default_factory=dict)
    category_counts: dict[str, int] = Field(default_factory=dict)
    assumptions_count: int = 0
    summary_narrative: str = ""


class KnowledgeBaseResponse(BaseModel):
    weeks: list[KnowledgeBaseWeekRecord]
    registry: list[AssumptionRecord]


class EmailEnvelope(BaseModel):
    message_id: str
    thread_id: str
    sender: str
    recipients: list[str] = Field(default_factory=list)
    subject: str = ""
    plain_text_body: str = ""
    html_body: str = ""
    received_at: str | None = None
    attachments: list[tuple[str, str, bytes]] = Field(default_factory=list)
    source_metadata: dict[str, Any] = Field(default_factory=dict)


TERMINAL_STATES = {ProcessingState.TERMINAL, ProcessingState.DEAD_LETTER}
