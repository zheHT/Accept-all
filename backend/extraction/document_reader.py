from io import BytesIO
from pathlib import Path
from zipfile import is_zipfile

from markitdown import MarkItDown, StreamInfo
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from backend.extraction.schemas import DocumentInput, DocumentKind, PreparedDocument


class DocumentReadError(Exception):
    pass


class UnsupportedDocumentError(DocumentReadError):
    pass


class UnreadableDocumentError(DocumentReadError):
    pass


def prepare_document(document: DocumentInput) -> PreparedDocument:
    extension = Path(document.filename).suffix.casefold()

    if extension == ".txt":
        return PreparedDocument(document.filename, "text/plain", text=_decode_text(document.data))
    if extension in {".docx", ".xlsx"}:
        return PreparedDocument(
            document.filename,
            "text/plain",
            text=_convert_office(document.data, document.filename, extension),
        )
    if extension == ".pdf":
        _validate_pdf(document.data)
        return PreparedDocument(document.filename, "application/pdf", data=document.data)

    raise UnsupportedDocumentError(
        f"Unsupported document type: {extension or '<none>'}"
    )


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue

    raise UnreadableDocumentError("Unable to decode text document.")


def _convert_office(data: bytes, filename: str, extension: str) -> str:
    if not is_zipfile(BytesIO(data)):
        raise UnreadableDocumentError(
            f"Unable to read {extension[1:].upper()} document."
        )

    try:
        result = MarkItDown(enable_plugins=False).convert_stream(
            BytesIO(data),
            stream_info=StreamInfo(extension=extension, filename=filename),
        )
        text = result.markdown.strip()
    except Exception as exc:
        raise UnreadableDocumentError(
            f"Unable to read {extension[1:].upper()} document."
        ) from exc

    if not text:
        raise UnreadableDocumentError(f"Empty {extension[1:].upper()} document.")
    return text


def _validate_pdf(data: bytes) -> None:
    try:
        reader = PdfReader(BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise UnreadableDocumentError("Encrypted PDF is not supported.")
        if len(reader.pages) == 0:
            raise UnreadableDocumentError("PDF contains no pages.")
    except (PdfReadError, EOFError, ValueError, OSError) as exc:
        raise UnreadableDocumentError("Unable to read PDF document.") from exc


def detect_document_kind(document: PreparedDocument) -> DocumentKind:
    if not document.text:
        return DocumentKind.UNKNOWN

    title = _normalized_title(document.text)
    if title.startswith(
        ("COMMERCIAL INVOICE", "PACKING LIST", "CERTIFICATE OF ORIGIN")
    ):
        return DocumentKind.OTHER
    if title.startswith(
        ("SHIPPING INSTRUCTION", "BILL OF LADING INSTRUCTION", "BL INSTRUCTION")
    ):
        return DocumentKind.SI
    if title.startswith("BILL OF LADING"):
        return DocumentKind.BL
    return DocumentKind.UNKNOWN


def _normalized_title(text: str) -> str:
    for line in text.splitlines():
        title = line.strip()
        if title:
            return " ".join(title.lstrip("#").strip().upper().split())
    return ""
