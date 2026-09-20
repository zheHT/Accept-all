from __future__ import annotations

import hmac
import html
import logging
import re
import secrets
import time
from contextlib import suppress
from io import BytesIO
from datetime import date
from typing import Annotated, Any
from urllib.parse import quote

logger = logging.getLogger(__name__)

import google.auth.transport.requests
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from google.api_core.exceptions import Conflict, GoogleAPIError, NotFound
from google.cloud import secretmanager
from google.oauth2 import id_token
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from backend.api.field_review import field_review_changes
from backend.api.markdown_preview import render_preview_document
from backend.api.views import (
    build_case_detail,
    build_case_summary,
    dashboard_view,
    paginate,
)
from backend.core.config import get_settings
from backend.core.ingestion import stable_case_id
from backend.core.runtime import Runtime, build_runtime
from backend.core.schemas import (
    DraftSendRequest,
    DraftUpdateRequest,
    ExplainRequest,
    FieldReviewRequest,
    IngestionState,
    IngestMetadata,
    PlatformSettingsUpdate,
    ProcessingState,
    ReviewDecision,
    ReviewRequest,
)
from backend.core.security import content_hash, sign_state, verify_state
from backend.core.telegram import TELEGRAM_HELP_TEXT, TELEGRAM_WELCOME_TEXT
from backend.core.workflows import create_case_draft
from backend.integrations.knowledge import secure_knowledge_publisher


def create_app(runtime: Runtime | None = None) -> FastAPI:
    settings = runtime.settings if runtime else get_settings()
    runtime = runtime or build_runtime(settings)
    secure_knowledge_publisher(runtime)
    app = FastAPI(title="ClassAll API", version="0.1.0")
    origins = [
        settings.dashboard_base_url.rstrip("/"),
        "https://classall-review-0866395749.web.app",
        "https://classall-review-0866395749.firebaseapp.com",
        "https://gen-lang-client-0866395749.web.app",
        "https://gen-lang-client-0866395749.firebaseapp.com",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        "http://127.0.0.1:3000",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys(o for o in origins if o)),
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://.*\.web\.app$|^https://.*\.firebaseapp\.com$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Document-Page-Count"],
    )
    app.state.runtime = runtime

    def require_ingest_key(x_ingest_key: Annotated[str | None, Header()] = None) -> None:
        expected = settings.grader_ingest_key
        if not expected:
            raise HTTPException(503, "grader ingestion is not configured")
        if not x_ingest_key or not hmac.compare_digest(x_ingest_key, expected):
            raise HTTPException(401, "invalid ingestion key")

    def require_user(
        authorization: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        if not settings.dashboard_auth_required:
            return {"uid": "local-reviewer", "email": "local@example.test", "admin": True}
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "Firebase bearer token required")
        try:
            claims = id_token.verify_firebase_token(
                authorization.removeprefix("Bearer "),
                google.auth.transport.requests.Request(),
                audience=settings.google_cloud_project,
            )
        except Exception as exc:
            raise HTTPException(401, "invalid Firebase token") from exc
        uid = str(claims.get("user_id") or claims.get("sub") or claims.get("uid") or "")
        if not uid:
            raise HTTPException(401, "Firebase user identity required")
        claims["uid"] = uid
        return claims

    def require_admin(claims: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
        if claims.get("admin") is not True:
            raise HTTPException(403, "administrator access required")
        return claims

    @app.get("/api/session")
    def session(claims: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
        return {"uid": claims["uid"], "is_admin": claims.get("admin") is True}

    def get_case_or_404(case_id: str) -> dict[str, Any]:
        case = runtime.repository.get_case(case_id)
        if case is None:
            raise HTTPException(404, "case not found")
        return case

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "classall-api"}

    @app.post("/api/ingest/runs", dependencies=[Depends(require_ingest_key)])
    def create_run(expected: int | None = None) -> dict[str, Any]:
        run_id = f"run-{int(time.time())}-{secrets.token_hex(4)}"
        return runtime.repository.create_run(run_id, expected)

    @app.post("/api/ingest/email", dependencies=[Depends(require_ingest_key)], status_code=202)
    async def ingest_email(
        metadata: Annotated[str, Form()],
        attachments: Annotated[list[UploadFile] | None, File()] = None,
    ) -> dict[str, Any]:
        try:
            parsed = IngestMetadata.model_validate_json(metadata)
            files = [
                (
                    upload.filename or "attachment",
                    upload.content_type or "application/octet-stream",
                    await upload.read(),
                )
                for upload in (attachments or [])
            ]
            case, created = runtime.ingestor.ingest(parsed.model_dump(), files)
            if created:
                invalidate_cached_cases()
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {
            "case_id": case["case_id"],
            "created": created,
            "status_url": f"/api/cases/{case['case_id']}",
        }

    @app.get("/api/ingest/runs/{run_id}", dependencies=[Depends(require_ingest_key)])
    def ingest_run(run_id: str) -> dict[str, Any]:
        run = runtime.repository.get_run(run_id)
        if run is None:
            raise HTTPException(404, "run not found")
        expected = run.get("expected")
        run["complete"] = expected is not None and run.get("terminal", 0) >= expected
        run["submission"] = run.get("results", {})
        return run

    _cached_cases: list[dict[str, Any]] | None = None
    _cached_cases_time: float = 0.0
    _cache_ttl: float = 10.0

    def get_cached_cases() -> list[dict[str, Any]]:
        nonlocal _cached_cases, _cached_cases_time
        now = time.time()
        if _cached_cases is None or (now - _cached_cases_time) > _cache_ttl:
            _cached_cases = runtime.repository.list_cases(limit=5000)
            _cached_cases_time = now
        return _cached_cases

    def invalidate_cached_cases() -> None:
        nonlocal _cached_cases, _cached_cases_time
        _cached_cases = None
        _cached_cases_time = 0.0

    def paged_cases(
        cases: list[dict[str, Any]], limit: int, cursor: str | None
    ) -> dict[str, Any]:
        try:
            page, next_cursor = paginate(cases, limit, cursor)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {
            "items": [build_case_summary(case) for case in page],
            "next_cursor": next_cursor,
        }

    @app.get("/api/dashboard", dependencies=[Depends(require_user)])
    def dashboard(period: str = Query(default="week", pattern="^(day|week|month)$")) -> dict[str, Any]:
        return dashboard_view(get_cached_cases(), period)

    @app.get("/api/inbox", dependencies=[Depends(require_user)])
    def inbox(
        limit: int = Query(default=50, ge=1, le=200), cursor: str | None = None
    ) -> dict[str, Any]:
        cases = [
            case
            for case in get_cached_cases()
            if case.get("source_type") == "gmail"
        ]
        return paged_cases(cases, limit, cursor)

    @app.get("/api/reviews", dependencies=[Depends(require_user)])
    def reviews(
        limit: int = Query(default=50, ge=1, le=200), cursor: str | None = None
    ) -> dict[str, Any]:
        cases = [
            case
            for case in get_cached_cases()
            if (case.get("result") or {}).get("status") in {"MISMATCH", "NEEDS_REVIEW"}
            and not case.get("review_decision")
        ]
        return paged_cases(cases, limit, cursor)

    @app.get("/api/cases", dependencies=[Depends(require_user)])
    def list_cases(
        status: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
        cursor: str | None = None,
    ) -> dict[str, Any]:
        if status:
            cases = [
                case
                for case in get_cached_cases()
                if (case.get("result") or {}).get("status") == status
            ]
        else:
            cases = get_cached_cases()
        return paged_cases(cases, limit, cursor)

    @app.get("/api/cases/{case_id}", dependencies=[Depends(require_user)])
    def get_case(case_id: str) -> dict[str, Any]:
        case = get_case_or_404(case_id)
        return build_case_detail(case, runtime.repository.list_documents(case_id))

    @app.post("/api/cases/{case_id}/retry", dependencies=[Depends(require_user)])
    def retry_case(case_id: str, expected_version: int | None = None) -> dict[str, Any]:
        get_case_or_404(case_id)
        try:
            updated = runtime.repository.update_case(
                case_id,
                {
                    "processing_state": ProcessingState.QUEUED.value,
                    "processing_error": None,
                    "review_decision": None,
                    "field_reviews": {},
                    "required_review_fields": [],
                },
                expected_version=expected_version,
            )
        except Conflict as exc:
            raise HTTPException(409, "case changed; refresh before retrying") from exc
        message_id = runtime.publisher.publish({"case_id": case_id})
        runtime.repository.append_event(case_id, "retry_queued", {"message_id": message_id})
        invalidate_cached_cases()
        return build_case_summary(updated)

    @app.get(
        "/api/cases/{case_id}/documents/{document_id}/download",
        dependencies=[Depends(require_user)],
    )
    def document_download(case_id: str, document_id: str) -> dict[str, str]:
        document = next(
            (
                item
                for item in runtime.repository.list_documents(case_id)
                if item["document_id"] == document_id
            ),
            None,
        )
        if document is None:
            raise HTTPException(404, "document not found")
        return {"url": runtime.blobs.signed_url(document["gcs_uri"])}

    @app.get(
        "/api/cases/{case_id}/documents/{document_id}/content",
        dependencies=[Depends(require_user)],
    )
    def document_content(case_id: str, document_id: str) -> Response:
        get_case_or_404(case_id)
        document = next(
            (item for item in runtime.repository.list_documents(case_id)
             if item["document_id"] == document_id),
            None,
        )
        if document is None:
            raise HTTPException(404, "document not found")
        try:
            data = runtime.blobs.download(document["gcs_uri"])
        except (FileNotFoundError, NotFound, KeyError, ValueError) as exc:
            raise HTTPException(404, "original document is unavailable") from exc
        except GoogleAPIError as exc:
            raise HTTPException(503, "document storage is temporarily unavailable") from exc
        # Only PDFs may render inline. Other attachment formats are downloads,
        # so uploaded HTML cannot execute on the API's origin.
        is_pdf = data.lstrip().startswith(b"%PDF-")
        filename = quote(str(document.get("filename") or "document"), safe="")
        headers = {
            "Content-Disposition": f"{'inline' if is_pdf else 'attachment'}; filename*=UTF-8''{filename}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        }
        if is_pdf:
            # Encrypted or damaged PDFs may still be downloaded, but must
            # not advertise an invented page count to the reviewer.
            with suppress(PdfReadError, ValueError, KeyError):
                headers["X-Document-Page-Count"] = str(len(PdfReader(BytesIO(data)).pages))
        return Response(
            content=data,
            media_type="application/pdf" if is_pdf else "application/octet-stream",
            headers=headers,
        )

    @app.put("/api/cases/{case_id}/fields/{field}/review")
    def review_field(
        case_id: str,
        field: str,
        request: FieldReviewRequest,
        reviewer: dict[str, Any] = Depends(require_user),  # noqa: B008
    ) -> dict[str, Any]:
        case = get_case_or_404(case_id)
        if case.get("processing_state") in {"DRAFT", "QUEUED", "PROCESSING"}:
            raise HTTPException(409, "wait for document processing to finish before reviewing")
        if case.get("review_decision"):
            raise HTTPException(409, "case is already resolved; reopen it before changing field decisions")
        if case.get("version") != request.expected_version:
            raise HTTPException(409, "case changed; refresh before reviewing")
        documents = runtime.repository.list_documents(case_id)
        try:
            changes = field_review_changes(case, documents, field, request, reviewer)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        try:
            # Evidence and history are saved together under the version check.
            updated = runtime.repository.update_case(
                case_id, changes, expected_version=request.expected_version,
            )
        except Conflict as exc:
            raise HTTPException(409, "case changed; refresh before reviewing") from exc
        invalidate_cached_cases()
        return build_case_detail(updated, documents)

    @app.post("/api/cases/{case_id}/review", dependencies=[Depends(require_user)])
    def review(case_id: str, request: ReviewRequest) -> dict[str, Any]:
        case = get_case_or_404(case_id)
        if request.decision == ReviewDecision.APPROVE and case.get("field_reviews"):
            detail = build_case_detail(case, runtime.repository.list_documents(case_id))
            if detail["unresolved_fields"]:
                raise HTTPException(409, "resolve all outstanding fields before approving this case")
        if request.decision == ReviewDecision.DECLINE and case.get("source_type") == "gmail":
            if case.get("version") != request.expected_version:
                raise HTTPException(409, "case changed; refresh before reviewing")
            try:
                draft_res = create_case_draft(runtime.repository, runtime.gmail, runtime.telegram, case)
                invalidate_cached_cases()
                return draft_res
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
        try:
            updated = runtime.repository.update_case(
                case_id,
                {"review_decision": request.decision.value, "review_note": request.note},
                expected_version=request.expected_version,
            )
        except Conflict as exc:
            raise HTTPException(409, "case changed; refresh before reviewing") from exc
        runtime.repository.append_event(
            case_id,
            "reviewed",
            {"decision": request.decision.value, "note": request.note},
        )
        invalidate_cached_cases()
        return updated

    @app.post("/api/cases/{case_id}/explain", dependencies=[Depends(require_user)])
    def explain(case_id: str, request: ExplainRequest) -> dict[str, str]:
        case = get_case_or_404(case_id)
        answer = runtime.explainer.explain(case, request.question)
        runtime.repository.append_event(
            case_id, "explanation_requested", {"question": request.question, "answer": answer}
        )
        return {"answer": answer}

    @app.put("/api/cases/{case_id}/draft", dependencies=[Depends(require_user)])
    def update_draft(case_id: str, request: DraftUpdateRequest) -> dict[str, Any]:
        case = get_case_or_404(case_id)
        if not case.get("gmail_draft_id"):
            raise HTTPException(409, "case has no Gmail draft")
        try:
            runtime.gmail.update_draft(
                case["gmail_draft_id"],
                to=case["sender"],
                subject=request.subject,
                body=request.body,
                thread_id=case.get("gmail_thread_id", ""),
            )
            updated = runtime.repository.update_case(
                case_id,
                {
                    "draft_subject": request.subject,
                    "draft_body": request.body,
                    "draft_content_hash": content_hash(request.subject, request.body),
                },
                expected_version=request.expected_version,
            )
            invalidate_cached_cases()
            return updated
        except Conflict as exc:
            raise HTTPException(409, "draft changed; refresh before editing") from exc

    @app.post("/api/cases/{case_id}/draft/send", dependencies=[Depends(require_user)])
    def send_draft(case_id: str, request: DraftSendRequest) -> dict[str, Any]:
        case = get_case_or_404(case_id)
        if case.get("version") != request.expected_version:
            raise HTTPException(409, "draft changed; refresh before sending")
        current = runtime.gmail.get_draft_content(case["gmail_draft_id"])
        current_hash = content_hash(current["subject"], current["body"])
        if current_hash != request.expected_content_hash:
            raise HTTPException(409, "Gmail draft changed; review the new content before sending")
        sent = runtime.gmail.send_draft(case["gmail_draft_id"])
        updated = runtime.repository.update_case(
            case_id,
            {"draft_state": "SENT", "gmail_sent_message_id": sent.get("id")},
            expected_version=request.expected_version,
        )
        runtime.repository.append_event(case_id, "gmail_draft_sent", {"message_id": sent.get("id")})
        invalidate_cached_cases()
        return updated

    def settings_view() -> dict[str, Any]:
        policy = runtime.repository.get_platform_settings()
        gmail_state = runtime.repository.get_gmail_state() or {}
        return {
            **policy,
            "low_confidence_requires_review": True,
            "missing_value_requires_review": True,
            "unreadable_requires_review": True,
            "gmail": {
                "address": gmail_state.get("email_address") or settings.gmail_address,
                "oauth_status": gmail_state.get("oauth_status", "not_connected"),
                "watch_expiration": gmail_state.get("watch_expiration"),
                "history_id_present": bool(gmail_state.get("history_id")),
            },
        }

    @app.get("/api/settings", dependencies=[Depends(require_admin)])
    def get_platform_settings() -> dict[str, Any]:
        return settings_view()

    @app.put("/api/settings", dependencies=[Depends(require_admin)])
    def update_platform_settings(request: PlatformSettingsUpdate) -> dict[str, Any]:
        runtime.repository.set_platform_settings(request.model_dump())
        return settings_view()

    @app.get("/api/knowledge-base/weeks", dependencies=[Depends(require_user)])
    def list_knowledge_base_weeks() -> list[dict[str, Any]]:
        return runtime.repository.list_knowledge_base_weeks()

    @app.get("/api/knowledge-base/weeks/{iso_week}", dependencies=[Depends(require_user)])
    def get_knowledge_base_week(iso_week: str) -> dict[str, Any]:
        week = runtime.repository.get_knowledge_base_week(iso_week)
        if not week:
            raise HTTPException(404, f"Weekly knowledge base for {iso_week} not found")
        return week

    @app.get("/api/knowledge-base/registry", dependencies=[Depends(require_user)])
    def list_assumptions(status: str | None = None) -> list[dict[str, Any]]:
        return runtime.repository.list_assumptions(status=status)

    @app.post("/api/knowledge-base/publish", dependencies=[Depends(require_user)])
    def publish_knowledge_base(week: str | None = None) -> dict[str, Any]:
        if not week:
            from datetime import UTC, datetime

            year, iso_wk, _ = datetime.now(UTC).isocalendar()
            week = f"{year}-W{iso_wk:02d}"
        return runtime.knowledge_publisher.publish_weekly(week)

    @app.get(
        "/api/knowledge-base/preview/{filename}",
        dependencies=[Depends(require_user)],
    )
    def preview_knowledge_base(filename: str) -> HTMLResponse:
        clean_name = re.sub(r"[^a-zA-Z0-9_\-]", "", filename)
        preview_uri = None
        if clean_name.startswith("ClassAll_Assumptions_"):
            iso_week = clean_name.removeprefix("ClassAll_Assumptions_")
            record = runtime.repository.get_knowledge_base_week(iso_week)
            preview_uri = (record or {}).get("preview_uri")
        if not preview_uri:
            raise HTTPException(404, "Preview document not found")
        markdown = runtime.knowledge_publisher.blobs.download(preview_uri).decode(
            "utf-8", errors="replace"
        )
        document = render_preview_document(markdown)
        return HTMLResponse(
            content=document,
            headers={
                "Content-Security-Policy": (
                    "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; "
                    "script-src 'none'; frame-ancestors 'none'; base-uri 'none'"
                ),
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        )

    @app.get("/api/integrations/gmail/oauth/start", dependencies=[Depends(require_admin)])
    def gmail_oauth_start() -> dict[str, str]:
        state = sign_state(
            {"exp": int(time.time()) + 600, "nonce": secrets.token_urlsafe(16)},
            settings.app_signing_secret,
        )
        return {"authorization_url": runtime.gmail.authorization_url(state)}

    @app.get("/api/integrations/gmail/oauth/callback")
    def gmail_oauth_callback(code: str, state: str) -> dict[str, str]:
        try:
            payload = verify_state(state, settings.app_signing_secret)
            if payload["exp"] < int(time.time()):
                raise ValueError("expired OAuth state")
            credentials = runtime.gmail.exchange_code(code, state)
            if not credentials.refresh_token:
                raise ValueError("Google did not return a refresh token")
            client = secretmanager.SecretManagerServiceClient()
            parent = client.secret_path(settings.google_cloud_project, "gmail-oauth-refresh-token")
            client.add_secret_version(
                request={
                    "parent": parent,
                    "payload": {"data": credentials.refresh_token.encode()},
                }
            )
            runtime.gmail.refresh_token = credentials.refresh_token
            runtime.repository.set_gmail_state({"oauth_status": "connected", "oauth_error": None})
        except Exception as exc:
            raise HTTPException(400, f"Gmail authorization failed: {type(exc).__name__}") from exc
        return {"status": "connected"}

    @app.post("/api/telegram-webhook")
    def telegram_webhook(
        update: dict[str, Any],
        x_telegram_bot_api_secret_token: Annotated[str | None, Header()] = None,
    ) -> dict[str, bool]:
        if not settings.telegram_webhook_secret or not hmac.compare_digest(
            x_telegram_bot_api_secret_token or "", settings.telegram_webhook_secret
        ):
            raise HTTPException(401, "invalid Telegram webhook secret")
        _handle_telegram_update(runtime, update)
        return {"ok": True}

    return app


def _handle_telegram_update(runtime: Runtime, update: dict[str, Any]) -> None:
    try:
        _process_telegram_update(runtime, update)
    except Exception as exc:
        logger.exception("Failed to process Telegram update: %s", exc)
        message = update.get("message") or {}
        chat_id = message.get("chat", {}).get("id")
        if chat_id:
            with suppress(Exception):
                runtime.telegram.send_message(
                    str(chat_id),
                    "⚠️ <i>An error occurred while processing your request. Please try again.</i>",
                )


def _process_telegram_update(runtime: Runtime, update: dict[str, Any]) -> None:
    callback = update.get("callback_query")
    if callback:
        _handle_callback(runtime, callback)
        return
    message = update.get("message") or {}
    if not message:
        return
    chat_id = str(message["chat"]["id"])
    text = (message.get("text") or message.get("caption") or "").strip()
    command = text.split(maxsplit=1)[0].split("@", 1)[0].lower() if text else ""
    runtime.telegram.send_chat_action(chat_id, "typing")
    if text.startswith("/start"):
        runtime.telegram.send_message(chat_id, TELEGRAM_WELCOME_TEXT)
        return
    if text.startswith("/help"):
        runtime.telegram.send_message(
            chat_id,
            TELEGRAM_HELP_TEXT.replace("/email-limit", "/email_limit")
            .replace("Show alert and hourly email settings", "Show alert and hourly email settings (admin)")
            .replace("Read a published weekly summary", "Open reports on the signed-in website"),
        )
        return
    lower_text = text.lower().strip()
    if lower_text in {
        "close notification",
        "close notifications",
        "turn off notification",
        "turn off notifications",
        "disable notification",
        "disable notifications",
        "mute notification",
        "mute notifications",
        "notifications off",
        "notification off",
    }:
        configured_admin = str(runtime.settings.telegram_admin_chat_id or "")
        private_chat = message["chat"].get("type", "private") == "private"
        sender_id = str(message.get("from", {}).get("id", chat_id))
        if not configured_admin or not private_chat or chat_id != configured_admin or sender_id != chat_id:
            runtime.telegram.send_message(
                chat_id,
                "Operational settings are managed by an administrator. You can still use all public bot features.",
            )
            return
        runtime.repository.set_platform_settings({"mismatch_alerts_enabled": False})
        runtime.telegram.send_message(
            chat_id, "<b>Notifications:</b> off\nMismatch alerts have been closed/turned off."
        )
        return
    if lower_text in {
        "open notification",
        "open notifications",
        "turn on notification",
        "turn on notifications",
        "enable notification",
        "enable notifications",
        "unmute notification",
        "unmute notifications",
        "notifications on",
        "notification on",
    }:
        configured_admin = str(runtime.settings.telegram_admin_chat_id or "")
        private_chat = message["chat"].get("type", "private") == "private"
        sender_id = str(message.get("from", {}).get("id", chat_id))
        if not configured_admin or not private_chat or chat_id != configured_admin or sender_id != chat_id:
            runtime.telegram.send_message(
                chat_id,
                "Operational settings are managed by an administrator. You can still use all public bot features.",
            )
            return
        runtime.repository.set_platform_settings({"mismatch_alerts_enabled": True})
        runtime.telegram.send_message(
            chat_id, "<b>Notifications:</b> on\nMismatch alerts have been opened/turned on."
        )
        return
    if command in {"/notifications", "/email_limit", "/email-limit", "/week"}:
        configured_admin = str(runtime.settings.telegram_admin_chat_id or "")
        private_chat = message["chat"].get("type", "private") == "private"
        sender_id = str(message.get("from", {}).get("id", chat_id))
        if not configured_admin or not private_chat or chat_id != configured_admin or sender_id != chat_id:
            if command == "/week":
                url = runtime.settings.dashboard_base_url.rstrip("/") + "/knowledge-base"
                runtime.telegram.send_message(
                    chat_id,
                    "Weekly reports are available to everyone after signing into the website.",
                    reply_markup={"inline_keyboard": [[{"text": "SIGN IN TO READ REPORTS", "url": url}]]},
                )
            else:
                runtime.telegram.send_message(chat_id, "Operational settings are managed by an administrator. You can still use all public bot features.")
            return
    if command == "/notifications":
        parts = text.split(maxsplit=1)
        if len(parts) == 2:
            if parts[1].lower() not in {"on", "off"}:
                runtime.telegram.send_message(chat_id, "Usage: <code>/notifications [on|off]</code>")
                return
            runtime.repository.set_platform_settings(
                {"mismatch_alerts_enabled": parts[1].strip().lower() == "on"}
            )
        settings = runtime.repository.get_platform_settings()
        enabled = "on" if settings.get("mismatch_alerts_enabled", True) else "off"
        limit = int(settings.get("gmail_reconcile_limit", runtime.settings.gmail_reconcile_limit))
        runtime.telegram.send_message(
            chat_id,
            f"<b>Notifications:</b> {enabled}\n"
            f"Hourly email limit: <b>{limit}</b>\n"
            f"Hourly reconciliation: <code>{html.escape(runtime.settings.gmail_reconcile_schedule)}</code>",
        )
        return
    if command in {"/email_limit", "/email-limit"}:
        parts = text.split(maxsplit=1)
        try:
            limit = int(parts[1]) if len(parts) == 2 else 0
        except ValueError:
            limit = 0
        if not 1 <= limit <= 500:
            runtime.telegram.send_message(chat_id, "Usage: <code>/email_limit 1..500</code>")
            return
        runtime.repository.set_platform_settings({"gmail_reconcile_limit": limit})
        runtime.telegram.send_message(chat_id, f"Hourly email limit: <b>{limit}</b>.")
        return
    if command == "/week":
        progress = runtime.telegram.send_message(chat_id, "⏳ <i>Fetching weekly operations summary...</i>")
        parts = text.split(maxsplit=1)
        week = parts[1].strip() if len(parts) == 2 else ""
        if not week:
            records = runtime.repository.list_knowledge_base_weeks()
            if not records:
                runtime.telegram.edit_message_text(
                    chat_id, progress.get("message_id", 0), "No weekly summaries have been published yet."
                )
                return
            record = records[0]
            week = str(record.get("week") or "")
        else:
            try:
                if not re.fullmatch(r"\d{4}-W\d{2}", week):
                    raise ValueError("invalid ISO week")
                date.fromisocalendar(int(week[:4]), int(week[-2:]), 1)
            except ValueError:
                runtime.telegram.edit_message_text(
                    chat_id, progress.get("message_id", 0), "Usage: <code>/week YYYY-W##</code> (e.g. <code>/week 2026-W38</code>)"
                )
                return
            record = runtime.repository.get_knowledge_base_week(week)
            if not record:
                runtime.telegram.edit_message_text(
                    chat_id, progress.get("message_id", 0), f"Summary for <code>{html.escape(week)}</code> not found."
                )
                return
        report_url = runtime.settings.dashboard_base_url.rstrip("/") + "/knowledge-base"
        markup = {"inline_keyboard": [[{"text": "OPEN WEEKLY SUMMARY", "url": report_url}]]}
        runtime.telegram.edit_message_text(
            chat_id,
            progress.get("message_id", 0),
            f"<b>Weekly summary {html.escape(week)}</b>\n\n"
            f"{html.escape(record.get('summary_narrative') or 'No narrative is available.')}\n"
            f"Cases analyzed: <b>{record.get('cases_analyzed', 0)}</b>",
            reply_markup=markup,
        )
        return
    if text.startswith("/ask"):
        parts = text.split(maxsplit=2)
        if len(parts) != 3:
            runtime.telegram.send_message(chat_id, "Usage: <code>/ask CASE_ID question</code>")
            return
        case = runtime.repository.get_case(parts[1].lower())
        if not case or str(case.get("owner_chat_id") or chat_id) != chat_id:
            runtime.telegram.send_message(chat_id, "That case is not available in this chat.")
            return
        progress = runtime.telegram.send_message(chat_id, "⏳ <i>Analyzing case with Gemini AI...</i>")
        answer = runtime.explainer.explain(case, parts[2])
        try:
            runtime.telegram.edit_message_text(chat_id, progress.get("message_id", 0), answer)
        except Exception:
            runtime.telegram.send_message(chat_id, answer)
        return
    if text.startswith("/newcase"):
        token = secrets.token_urlsafe(6).replace("-", "").replace("_", "")
        runtime.telegram.send_message(
            chat_id,
            f"New case token: <code>{token}</code>\n"
            f"Upload each document with caption <code>#{token}</code>, "
            f"then send <code>/submit {token}</code>.",
        )
        return
    if text.startswith("/submit"):
        parts = text.split(maxsplit=1)
        if len(parts) != 2:
            runtime.telegram.send_message(chat_id, "Usage: <code>/submit TOKEN</code>")
            return
        progress = runtime.telegram.send_message(chat_id, "⏳ <i>Verifying token & queuing AI analysis...</i>")
        source_message_id = f"{chat_id}:{parts[1].strip()}"
        case_id = stable_case_id("telegram", source_message_id)
        case = runtime.repository.get_case(case_id)
        if not case or str(case.get("owner_chat_id")) != chat_id:
            runtime.telegram.edit_message_text(chat_id, progress.get("message_id", 0), "Case token not found for this chat.")
            return
        message_id = runtime.publisher.publish({"case_id": case_id})
        runtime.repository.update_case(
            case_id,
            {
                "processing_state": ProcessingState.QUEUED.value,
                "ingestion_state": IngestionState.TASK_PUBLISHED.value,
                "task_message_id": message_id,
            },
        )
        runtime.telegram.edit_message_text(chat_id, progress.get("message_id", 0), f"Queued case <code>{case_id}</code>.")
        return
    document = message.get("document")
    if document:
        if not runtime.repository.allow_telegram_upload(
            chat_id, runtime.settings.telegram_uploads_per_hour
        ):
            runtime.telegram.send_message(
                chat_id,
                "Upload limit reached for this hour. Please try again later.",
            )
            return
        match = re.search(r"#([A-Za-z0-9_-]{4,32})", text)
        token = match.group(1) if match else str(message["message_id"])
        data, _ = runtime.telegram.get_file(document["file_id"])
        metadata = {
            "source_type": "telegram",
            "source_message_id": f"{chat_id}:{token}",
            "sender": str(message.get("from", {}).get("username", "")),
            "subject": text,
            "body": text,
            "run_id": None,
            "owner_chat_id": chat_id,
        }
        case, _ = runtime.ingestor.ingest(
            metadata,
            [(document.get("file_name", "attachment"), document.get("mime_type", ""), data)],
            publish=False,
            allow_append=True,
        )
        runtime.telegram.send_message(
            chat_id,
            f"Added document to <code>{case['case_id']}</code>. "
            f"Send <code>/submit {token}</code> when ready.",
        )
        return
    case_match = re.search(r"(case-[a-f0-9]{24})", text, flags=re.IGNORECASE)
    if case_match:
        case = runtime.repository.get_case(case_match.group(1).lower())
        if not case or str(case.get("owner_chat_id")) != chat_id:
            runtime.telegram.send_message(chat_id, "That case is not available in this chat.")
            return
        progress = runtime.telegram.send_message(chat_id, "⏳ <i>Retrieving case evidence & analyzing...</i>")
        answer = runtime.explainer.explain(case, text)
        try:
            runtime.telegram.edit_message_text(chat_id, progress.get("message_id", 0), answer)
        except Exception:
            runtime.telegram.send_message(chat_id, answer)
        return
    if text:
        progress = runtime.telegram.send_message(chat_id, "💭 <i>Thinking... Fetching answer...</i>")
        try:
            answer = runtime.explainer.assist(text)
        except Exception:
            answer = (
                "🚢 <b>ClassAll Maritime Assistant</b>\n\n"
                "I can help cross-check Shipping Instructions against draft Bills of Lading.\n\n"
                "• Send <code>/newcase</code> to start a new document check.\n"
                "• Upload documents with caption <code>#TOKEN</code>, then send <code>/submit TOKEN</code>.\n"
                "• Or ask a question about an existing case by mentioning its ID (e.g. <code>case-18e47...</code>)."
            )
        try:
            runtime.telegram.edit_message_text(chat_id, progress.get("message_id", 0), answer)
        except Exception:
            runtime.telegram.send_message(chat_id, answer)


def _handle_callback(runtime: Runtime, callback: dict[str, Any]) -> None:
    chat_id = str(callback["message"]["chat"]["id"])
    callback_id = callback["id"]
    try:
        action_name, action_id = callback.get("data", "").split(":", 1)
    except ValueError:
        runtime.telegram.answer_callback(callback_id, "Invalid action")
        return
    action = runtime.repository.consume_action(action_id, chat_id)
    if not action or action.get("action") != action_name.replace("send", "send_draft"):
        runtime.telegram.answer_callback(callback_id, "Action expired or already used")
        return
    case = runtime.repository.get_case(action["case_id"])
    if case is None or str(case.get("owner_chat_id") or chat_id) != chat_id:
        runtime.telegram.answer_callback(callback_id, "Case unavailable")
        return
    try:
        if action_name == "approve":
            runtime.repository.update_case(
                case["case_id"],
                {"review_decision": "APPROVE"},
                expected_version=action["expected_version"],
            )
            runtime.telegram.answer_callback(callback_id, "Case approved")
        elif action_name == "decline":
            create_case_draft(runtime.repository, runtime.gmail, runtime.telegram, case, chat_id)
            runtime.telegram.answer_callback(callback_id, "Draft created")
        elif action_name == "send":
            current = runtime.gmail.get_draft_content(case["gmail_draft_id"])
            if content_hash(current["subject"], current["body"]) != action["expected_content_hash"]:
                runtime.telegram.answer_callback(callback_id, "Draft changed; review it again")
                return
            sent = runtime.gmail.send_draft(case["gmail_draft_id"])
            runtime.repository.update_case(
                case["case_id"],
                {"draft_state": "SENT", "gmail_sent_message_id": sent.get("id")},
                expected_version=action["expected_version"],
            )
            runtime.telegram.answer_callback(callback_id, "Draft sent")
    except (Conflict, ValueError, RuntimeError):
        runtime.telegram.answer_callback(callback_id, "Case changed; refresh and try again")


app = create_app()

