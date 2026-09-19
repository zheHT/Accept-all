from backend.extraction.document_reader import (
    DocumentReadError,
    UnsupportedDocumentError,
    detect_document_kind,
    prepare_document,
)
from backend.extraction.extractor_flow import (
    DocumentExtractionError,
    extract_document,
)
from backend.extraction.schemas import (
    DocumentInput,
    DocumentKind,
    DocumentPairResult,
    PreparedDocument,
    ReviewReason,
)
from backend.extraction.validator import needs_review, validate_documents


async def process_document_pair(
    si_input: DocumentInput | None,
    bl_input: DocumentInput | None,
    *,
    extractor=extract_document,
) -> DocumentPairResult:
    if si_input is None or bl_input is None:
        return DocumentPairResult(
            validation=needs_review(ReviewReason.MISSING_ATTACHMENT)
        )

    try:
        si = prepare_document(si_input)
        bl = prepare_document(bl_input)
    except (DocumentReadError, UnsupportedDocumentError):
        return DocumentPairResult(validation=needs_review(ReviewReason.UNREADABLE))

    return await process_prepared_document_pair(si, bl, extractor=extractor)


async def process_prepared_document_pair(
    si: PreparedDocument,
    bl: PreparedDocument,
    *,
    extractor=extract_document,
) -> DocumentPairResult:
    if _wrong_kind(si, DocumentKind.SI) or _wrong_kind(bl, DocumentKind.BL):
        return DocumentPairResult(validation=needs_review(ReviewReason.WRONG_DOC_TYPE))

    try:
        extracted_si = await extractor(si)
        extracted_bl = await extractor(bl)
    except DocumentExtractionError:
        return DocumentPairResult(validation=needs_review(ReviewReason.UNREADABLE))

    return DocumentPairResult(
        si=extracted_si,
        bl=extracted_bl,
        validation=validate_documents(extracted_si, extracted_bl),
    )


def _wrong_kind(document: PreparedDocument, expected: DocumentKind) -> bool:
    return detect_document_kind(document) not in {expected, DocumentKind.UNKNOWN}
