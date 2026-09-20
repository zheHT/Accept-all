from typing import Annotated

from fastapi import (
    APIRouter,
    File,
    HTTPException,
    UploadFile,
    status,
)

from app.config import get_settings
from app.schemas import VerificationResult
from app.services.checker import (
    ShippingDocumentChecker,
)
from app.services.gemini import (
    GeminiConfigurationError,
    GeminiExtractionError,
    GeminiExtractionService,
)
from app.services.ingestion import (
    DocumentConversionError,
    DocumentIngestionService,
    UnsupportedDocumentError,
)


router = APIRouter(
    prefix="/api/v1",
)

settings = get_settings()

ingestion_service = DocumentIngestionService()

gemini_service = GeminiExtractionService(
    settings=settings,
)

checker_service = ShippingDocumentChecker()


@router.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "shipping-document-checker",
    }


@router.post(
    "/check",
    response_model=VerificationResult,
)
async def check_documents(
    files: Annotated[
        list[UploadFile],
        File(
            description=(
                "Shipping documents to compare. "
                "Supported: PDF, DOCX, XLSX."
            )
        ),
    ],
) -> VerificationResult:

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "At least one document is required."
            ),
        )

    if len(files) > settings.max_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Maximum {settings.max_files} "
                "documents per request."
            ),
        )

    extracted_documents = []

    for upload in files:
        filename = upload.filename or "document"

        raw_data = await upload.read()

        if len(raw_data) > settings.max_upload_bytes:
            raise HTTPException(
                status_code=(
                    status.HTTP_413_CONTENT_TOO_LARGE
                ),
                detail=(
                    f"'{filename}' exceeds the "
                    f"{settings.max_upload_mb} MB "
                    "upload limit."
                ),
            )

        try:
            normalized = (
                ingestion_service.normalize(
                    filename=filename,
                    data=raw_data,
                )
            )

        except UnsupportedDocumentError as exc:
            raise HTTPException(
                status_code=(
                    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
                ),
                detail=str(exc),
            ) from exc

        except DocumentConversionError as exc:
            raise HTTPException(
                status_code=(
                    status.HTTP_422_UNPROCESSABLE_ENTITY
                ),
                detail=str(exc),
            ) from exc

        try:
            extracted = (
                await gemini_service.extract(
                    normalized
                )
            )

        except GeminiConfigurationError as exc:
            raise HTTPException(
                status_code=(
                    status.HTTP_500_INTERNAL_SERVER_ERROR
                ),
                detail=str(exc),
            ) from exc

        except GeminiExtractionError as exc:
            raise HTTPException(
                status_code=(
                    status.HTTP_502_BAD_GATEWAY
                ),
                detail=str(exc),
            ) from exc

        extracted_documents.append(
            extracted
        )

    return checker_service.check(
        extracted_documents
    )