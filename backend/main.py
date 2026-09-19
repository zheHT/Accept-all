"""FastAPI application for Maritime Shipping Email Classifier & Triage Agent."""
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.agents.classifier_flow import classify_email
from backend.models.schemas import EmailClassification, EmailInputPayload
from backend.utils.attachment_sniffer import inspect_attachment


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown logging."""
    yield


app = FastAPI(
    title="Maritime Shipping Email Classifier & Triage API",
    description="Automated triage pipeline for maritime shipping customer correspondence, classifying into 5 operational categories.",
    version="1.0.0",
    lifespan=lifespan,
)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "*",
]

# Setup CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    gemini_client_ready: bool


@app.get("/health", response_model=HealthResponse, tags=["Health"])
def health():
    """Health check endpoint indicating service availability and GenAI client readiness."""
    has_key = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    return HealthResponse(
        status="ok",
        service="email_classifier_triage_agent",
        version="1.0.0",
        gemini_client_ready=has_key,
    )


@app.post(
    "/api/classify",
    response_model=EmailClassification,
    status_code=status.HTTP_200_OK,
    tags=["Classification"],
    summary="Classify and triage an incoming shipping email",
)
@app.post(
    "/api/process",
    response_model=EmailClassification,
    status_code=status.HTTP_200_OK,
    tags=["Classification"],
    summary="Alias to classify and triage an incoming shipping email",
)
def classify_endpoint(payload: EmailInputPayload) -> EmailClassification:
    """Classify incoming email payload into one of 5 operational categories:

    - DOCUMENT_COMPARISON (with discrepancy candidate flag)
    - NEW_SI_REQUEST
    - INVOICE_QUERY
    - GENERAL
    - SPAM
    """
    try:
        # Build attachment previews dict if attachments are provided
        attachment_previews: dict[str, str] = {}
        for att in (payload.attachments or []):
            # If it's a file path that exists locally, inspect it
            if os.path.exists(att) and os.path.isfile(att):
                try:
                    with open(att, "rb") as f:
                        preview = inspect_attachment(att, f.read())
                        attachment_previews[att] = preview
                except Exception:
                    attachment_previews[att] = "[Unreadable or Corrupted File]"
            else:
                # Store placeholder name
                attachment_previews[att] = f"Attachment file: {att}"

        result = classify_email(
            email_id=payload.email_id,
            subject=payload.subject,
            sender=payload.sender or "",
            body=payload.body,
            attachment_previews=attachment_previews,
        )
        return result
    except Exception as e:
        err_str = str(e).lower()
        if "429" in err_str or "resourceexhausted" in err_str or "rate limit" in err_str or "too many requests" in err_str:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: {str(e)}",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Classification error: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
