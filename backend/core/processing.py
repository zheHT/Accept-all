from __future__ import annotations

from typing import Any, Protocol

from backend.core.blob_store import BlobStore
from backend.core.documents import extract_text
from backend.core.inference import ModelRouter, ModelRoutingError
from backend.core.repository import CaseRepository
from backend.core.schemas import (
    DocumentType,
    EmailCategory,
    GraderResult,
    ResultStatus,
    ReviewReason,
)
from backend.core.validation import compare_documents


class ReviewNotifier(Protocol):
    def send_review_alert(self, case: dict[str, Any]) -> None: ...


class NullNotifier:
    def send_review_alert(self, case: dict[str, Any]) -> None:
        del case


class CaseProcessor:
    def __init__(
        self,
        repository: CaseRepository,
        blobs: BlobStore,
        router: ModelRouter,
        *,
        lease_seconds: int = 600,
        notifier: ReviewNotifier | None = None,
    ) -> None:
        self.repository = repository
        self.blobs = blobs
        self.router = router
        self.lease_seconds = lease_seconds
        self.notifier = notifier or NullNotifier()

    def process(self, case_id: str) -> dict[str, Any] | None:
        if not self.repository.acquire_processing_lease(case_id, self.lease_seconds):
            return self.repository.get_case(case_id)
        case = self.repository.get_case(case_id)
        if case is None:
            raise KeyError(case_id)

        stored_documents = self.repository.list_documents(case_id)
        attachments: list[dict[str, Any]] = []
        for document in stored_documents:
            data = self.blobs.download(document["gcs_uri"])
            text, readable = extract_text(document["filename"], data)
            attachments.append(
                {
                    **document,
                    "bytes": data,
                    "text": text,
                    "readable": readable,
                }
            )

        try:
            outcome = self.router.infer(case.get("subject", ""), case.get("body", ""), attachments)
            threshold = float(
                self.repository.get_platform_settings().get("confidence_threshold", 0.85)
            )
            low_confidence_fields = self._low_confidence_fields(outcome.extraction, threshold)
            result = self._validate(outcome.extraction, attachments, low_confidence_fields)
            changes = {
                "category": outcome.extraction.category.value,
                "result": result.model_dump(mode="json"),
                "model_used": outcome.model_used,
                "fallback_reason": outcome.fallback_reason,
                "rationale": outcome.extraction.rationale,
                "assumptions": outcome.extraction.assumptions,
                "low_confidence": bool(low_confidence_fields),
                "low_confidence_fields": low_confidence_fields,
                "confidence_threshold": threshold,
                "processing_error": None,
            }
            by_filename = {item.filename: item for item in outcome.extraction.documents}
            for document in stored_documents:
                extracted = by_filename.get(document["filename"])
                if extracted:
                    self.repository.update_document(
                        case_id,
                        document["document_id"],
                        {"extraction": extracted.model_dump(mode="json")},
                    )
        except ModelRoutingError as exc:
            category = self._heuristic_category(case.get("subject", ""), case.get("body", ""))
            result = GraderResult(
                category=category,
                status=ResultStatus.NEEDS_REVIEW,
                review_reason=ReviewReason.UNREADABLE,
            )
            changes = {
                "category": category.value,
                "result": result.model_dump(mode="json"),
                "model_used": None,
                "fallback_reason": "both_models_failed",
                "processing_error": str(exc),
                "rationale": "Automated extraction was unavailable; human review is required.",
                "assumptions": [],
            }

        completed = self.repository.complete_case(case_id, changes)
        self.repository.append_event(case_id, "processing_completed", changes)
        if completed["result"]["status"] in {
            ResultStatus.MISMATCH.value,
            ResultStatus.NEEDS_REVIEW.value,
        }:
            self.notifier.send_review_alert(completed)
        return completed

    def _validate(
        self,
        extraction: Any,
        attachments: list[dict[str, Any]],
        low_confidence_fields: list[str] | None = None,
    ) -> GraderResult:
        if extraction.category != EmailCategory.BL_COMPARISON:
            return GraderResult(category=extraction.category, status=ResultStatus.OK)
        if len(attachments) < 2:
            return GraderResult(
                category=extraction.category,
                status=ResultStatus.NEEDS_REVIEW,
                review_reason=ReviewReason.MISSING_ATTACHMENT,
            )
        if any(not attachment["readable"] for attachment in attachments):
            return GraderResult(
                category=extraction.category,
                status=ResultStatus.NEEDS_REVIEW,
                review_reason=ReviewReason.UNREADABLE,
            )
        si_docs = [doc for doc in extraction.documents if doc.document_type == DocumentType.SI]
        bl_docs = [doc for doc in extraction.documents if doc.document_type == DocumentType.BL]
        if len(si_docs) != 1 or len(bl_docs) != 1:
            return GraderResult(
                category=extraction.category,
                status=ResultStatus.NEEDS_REVIEW,
                review_reason=ReviewReason.WRONG_DOC_TYPE,
            )
        if si_docs[0].fields is None or bl_docs[0].fields is None:
            return GraderResult(
                category=extraction.category,
                status=ResultStatus.NEEDS_REVIEW,
                review_reason=ReviewReason.MISSING_VALUE,
            )
        if low_confidence_fields:
            return GraderResult(
                category=extraction.category,
                status=ResultStatus.NEEDS_REVIEW,
                review_reason=ReviewReason.LOW_CONFIDENCE,
            )
        return compare_documents(si_docs[0].fields, bl_docs[0].fields)

    @staticmethod
    def _low_confidence_fields(extraction: Any, threshold: float) -> list[str]:
        public_names = {"gross_weight_kg": "gross_weight"}
        affected: set[str] = set()
        for document in extraction.documents:
            if document.fields is None:
                continue
            for field_name, field_value in document.fields:
                if field_value.value is not None and field_value.confidence < threshold:
                    affected.add(public_names.get(field_name, field_name))
        return sorted(affected)

    @staticmethod
    def _heuristic_category(subject: str, body: str) -> EmailCategory:
        text = f"{subject} {body}".upper()
        if "BL" in text and any(token in text for token in ("CONFIRM", "COMPARE", "DRAFT")):
            return EmailCategory.BL_COMPARISON
        if "SI" in text or "SHIPPING INSTRUCTION" in text:
            return EmailCategory.SI_REQUEST
        if "INVOICE" in text or "CHARGE" in text:
            return EmailCategory.INVOICE_QUERY
        return EmailCategory.GENERAL
