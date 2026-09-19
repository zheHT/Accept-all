"""Compatibility attachment preview wrapper backed by Pillar 3 preparation."""

from backend.extraction.document_reader import DocumentReadError, prepare_document
from backend.extraction.schemas import DocumentInput

MAX_CHARS = 1000

def inspect_attachment(filename: str, content: bytes | str) -> str:
    """Prepare an attachment preview without duplicating Pillar 3 parsing."""
    data = content.encode() if isinstance(content, str) else content
    try:
        prepared = prepare_document(DocumentInput(filename=filename, data=data))
    except DocumentReadError:
        return "[Unreadable or Corrupted File]"
    if prepared.text is not None:
        return prepared.text[:MAX_CHARS].strip()
    return "[PDF document: original bytes retained]"
