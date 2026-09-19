from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from google.api_core.exceptions import DeadlineExceeded, GatewayTimeout, TooManyRequests
from pydantic import ValidationError

from backend.core.schemas import ModelExtraction

SYSTEM_PROMPT = """You classify shipping operations email and extract shipping documents.
Return only the requested schema. Categories are BL_COMPARISON, SI_REQUEST,
INVOICE_QUERY, GENERAL, and SPAM. For BL_COMPARISON, identify each attachment as
SI, BL, OTHER, or UNKNOWN and extract exactly these fields: shipper, consignee,
notify_party, port_of_loading, port_of_discharge, container_count, gross_weight_kg.
Normalize gross weight to kilograms. Never invent a missing value. Evidence must
be a short source snippet. Assumptions must be concise, explicit, and reviewable;
do not expose private chain-of-thought."""


class ModelRoutingError(RuntimeError):
    pass


@dataclass(slots=True)
class InferenceOutcome:
    extraction: ModelExtraction
    model_used: str
    fallback_reason: str | None


Generator = Callable[[str, str, str, list[dict[str, Any]]], ModelExtraction]


class ModelRouter:
    def __init__(
        self,
        *,
        project: str,
        location: str,
        primary_model: str,
        fallback_model: str,
        generator: Generator | None = None,
    ) -> None:
        self.project = project
        self.location = location
        self.primary_model = primary_model
        self.fallback_model = fallback_model
        self.generator = generator or self._google_generate

    def infer(self, subject: str, body: str, attachments: list[dict[str, Any]]) -> InferenceOutcome:
        try:
            extraction = self.generator(self.primary_model, subject, body, attachments)
            return InferenceOutcome(extraction, self.primary_model, None)
        except Exception as exc:
            first_error = exc
            if not _fallback_eligible(exc):
                raise ModelRoutingError(
                    f"primary={type(exc).__name__}; fallback=not_attempted"
                ) from exc

        try:
            extraction = self.generator(self.fallback_model, subject, body, attachments)
            return InferenceOutcome(extraction, self.fallback_model, type(first_error).__name__)
        except Exception as exc:
            raise ModelRoutingError(
                f"primary={type(first_error).__name__}; fallback={type(exc).__name__}"
            ) from exc

    def _google_generate(
        self, model: str, subject: str, body: str, attachments: list[dict[str, Any]]
    ) -> ModelExtraction:
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=self.project,
            location=self.location,
        )
        parts: list[Any] = [
            types.Part.from_text(
                text=f"Email subject: {subject}\n\nEmail body:\n{body}\n\nAttachments follow."
            )
        ]
        for attachment in attachments:
            parts.append(types.Part.from_text(text=f"Attachment: {attachment['filename']}"))
            if attachment.get("content_type") == "application/pdf":
                parts.append(
                    types.Part.from_bytes(data=attachment["bytes"], mime_type="application/pdf")
                )
            else:
                parts.append(types.Part.from_text(text=attachment.get("text") or "[UNREADABLE]"))
        response = client.models.generate_content(
            model=model,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=ModelExtraction,
                temperature=0,
            ),
        )
        try:
            if isinstance(response.parsed, ModelExtraction):
                return response.parsed
            if response.parsed is not None:
                return ModelExtraction.model_validate(response.parsed)
            return ModelExtraction.model_validate_json(response.text)
        except (ValidationError, ValueError, TypeError) as exc:
            raise ValueError("model returned invalid structured output") from exc


def _fallback_eligible(exc: Exception) -> bool:
    if isinstance(
        exc,
        (
            ValueError,
            ValidationError,
            TimeoutError,
            DeadlineExceeded,
            GatewayTimeout,
            TooManyRequests,
        ),
    ):
        return True
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    return status in {429, 504}
