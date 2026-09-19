import asyncio
import os
from pathlib import Path

import httpx
from google import genai
from google.genai import errors, types

from backend.extraction.schemas import ExtractedDocument, PreparedDocument


MODEL_ENV = "GEMINI_MODEL"
DEFAULT_MODEL = "gemini-2.5-flash"


class DocumentExtractionError(Exception):
    """Gemini returned data that does not meet the document schema."""


class GeminiServiceError(Exception):
    """Gemini could not service an extraction request."""


async def extract_document(
    document: PreparedDocument,
    *,
    client=None,
    sleep=asyncio.sleep,
) -> ExtractedDocument:
    owned_client = client is None
    try:
        active_client = client or genai.Client()
    except Exception as exc:
        raise GeminiServiceError(str(exc)) from exc

    try:
        for attempt in range(3):
            try:
                response = await active_client.aio.models.generate_content(
                    model=os.getenv(MODEL_ENV, DEFAULT_MODEL),
                    contents=_contents(document),
                    config=types.GenerateContentConfig(
                        system_instruction=_load_system_instruction(),
                        temperature=0.0,
                        response_mime_type="application/json",
                        response_schema=ExtractedDocument,
                    ),
                )
                parsed = response.parsed
                if isinstance(parsed, ExtractedDocument):
                    return parsed
                return ExtractedDocument.model_validate_json(response.text)
            except Exception as exc:
                if _is_transient(exc) and attempt < 2:
                    await sleep(2**attempt)
                    continue
                if _is_sdk_failure(exc):
                    raise GeminiServiceError(str(exc)) from exc
                raise DocumentExtractionError(
                    "Gemini returned invalid document data."
                ) from exc
    finally:
        if owned_client:
            await active_client.aio.aclose()
            active_client.close()


def _contents(document: PreparedDocument) -> list[str | types.Part]:
    if document.mime_type == "application/pdf":
        if document.data is None:
            raise ValueError("Prepared PDF has no data.")
        return [types.Part.from_bytes(data=document.data, mime_type=document.mime_type)]

    if document.text is None:
        raise ValueError("Prepared text document has no text.")
    return [document.text]


def _load_system_instruction() -> str:
    return (
        Path(__file__).resolve().parents[1] / "skills" / "extractor.md"
    ).read_text(encoding="utf-8")


def _is_transient(exc: Exception) -> bool:
    code = _status_code(exc)
    return isinstance(exc, (TimeoutError, httpx.TimeoutException)) or code == 429 or (
        isinstance(code, int) and 500 <= code < 600
    )


def _is_sdk_failure(exc: Exception) -> bool:
    return isinstance(exc, (errors.APIError, OSError, httpx.TransportError)) or (
        _status_code(exc) is not None
    )


def _status_code(exc: Exception) -> int | None:
    for attribute in ("code", "status_code", "status"):
        code = getattr(exc, attribute, None)
        if isinstance(code, int):
            return code
    return None
