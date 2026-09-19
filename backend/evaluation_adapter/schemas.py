"""Schemas for the isolated local evaluation adapter."""
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class EmailCategory(str, Enum):
    """Operational categories for incoming maritime shipping correspondence."""
    DOCUMENT_COMPARISON = "DOCUMENT_COMPARISON"
    NEW_SI_REQUEST = "NEW_SI_REQUEST"
    INVOICE_QUERY = "INVOICE_QUERY"
    GENERAL = "GENERAL"
    SPAM = "SPAM"


class EmailClassification(BaseModel):
    """Structured output representing the triage classification of an email."""
    model_config = ConfigDict(extra="ignore")

    category: EmailCategory = Field(
        ...,
        description="The assigned operational category."
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0."
    )
    reasoning: str = Field(
        ...,
        description="A concise 1-sentence operational rationale explaining the routing decision."
    )
    is_comparison_candidate: bool = Field(
        ...,
        description="Strictly True for DOCUMENT_COMPARISON requiring downstream 7-field discrepancy validation."
    )
    missing_attachments_flag: bool = Field(
        default=False,
        description="True if comparison was requested but attachments are missing, unreadable, or corrupted."
    )
    detected_attachments: list[str] = Field(
        default_factory=list,
        description="List of detected attachment names or preview identifiers."
    )


class EmailInputPayload(BaseModel):
    """Incoming request payload representing an email message to classify."""
    model_config = ConfigDict(extra="ignore")

    email_id: str = Field(
        ...,
        description="Unique identifier for the incoming email."
    )
    subject: str = Field(
        ...,
        description="Subject line of the email."
    )
    body: str = Field(
        ...,
        description="Full text body of the email message."
    )
    sender: str | None = Field(
        default="",
        description="Sender email address or display name."
    )
    attachments: list[str] | None = Field(
        default_factory=list,
        description="List of attachment paths, filenames, or identifiers."
    )


class SubmissionItem(BaseModel):
    """Evaluation submission record shape matching sample_submission.json."""
    model_config = ConfigDict(extra="ignore")

    category: str = Field(
        ...,
        description="Category string matching the evaluator format."
    )
    status: str | None = Field(
        default=None,
        description="Evaluation status: OK, MISMATCH, MISMATCH_DETECTED, or NEEDS_REVIEW."
    )
    has_defect: bool | None = Field(
        default=None,
        description="Boolean indicating whether a defect was detected."
    )
    defect_fields: list[str] = Field(
        default_factory=list,
        description="List of fields where discrepancies/defects were detected."
    )
    review_reason: str | None = Field(
        default=None,
        description="Reason why human review is required if status is NEEDS_REVIEW."
    )
