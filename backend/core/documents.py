from __future__ import annotations

from pathlib import Path

from backend.extraction.document_reader import (
    DocumentReadError,
    prepare_document,
)
from backend.extraction.schemas import DocumentInput

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".txt"}


def extract_text(filename: str, data: bytes) -> tuple[str, bool]:
    if Path(filename).suffix.casefold() not in SUPPORTED_EXTENSIONS:
        return "", False
    try:
        prepared = prepare_document(DocumentInput(filename, data))
    except DocumentReadError:
        return "", False
    return (prepared.text or "").strip(), True
