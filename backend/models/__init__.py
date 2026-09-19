"""Pydantic schemas and models for email classification and submission."""
from backend.models.schemas import (
    EmailCategory,
    EmailClassification,
    EmailInputPayload,
    SubmissionItem,
)

__all__ = [
    "EmailCategory",
    "EmailClassification",
    "EmailInputPayload",
    "SubmissionItem",
]
