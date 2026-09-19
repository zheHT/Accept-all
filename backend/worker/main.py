from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from google.auth.exceptions import RefreshError

from backend.core.config import get_settings
from backend.core.processing import CaseProcessor
from backend.core.runtime import Runtime, build_runtime
from backend.worker.gmail_ingest import process_gmail_notification, reconcile_recent_gmail


def _signal_gmail_reconnect(runtime: Runtime) -> None:
    state = runtime.repository.get_gmail_state() or {}
    if (
        state.get("oauth_status") != "reconnect_required"
        and runtime.settings.telegram_admin_chat_id
    ):
        runtime.telegram.send_message(
            runtime.settings.telegram_admin_chat_id,
            "<b>Gmail reconnect required</b>\n"
            f"Open {runtime.settings.dashboard_base_url} and reconnect the demo mailbox. "
            "Inbox messages remain in Gmail and will be reconciled after reconnecting.",
        )
    runtime.repository.set_gmail_state(
        {"oauth_status": "reconnect_required", "oauth_error": "refresh_failed"}
    )


def _pubsub_data(envelope: dict[str, Any]) -> dict[str, Any]:
    try:
        encoded = envelope["message"]["data"]
        return json.loads(base64.b64decode(encoded))
    except (KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(400, "invalid Pub/Sub envelope") from exc


def create_app(runtime: Runtime | None = None) -> FastAPI:
    runtime = runtime or build_runtime(get_settings())
    processor = CaseProcessor(
        runtime.repository,
        runtime.blobs,
        runtime.router,
        lease_seconds=runtime.settings.processing_lease_seconds,
        notifier=runtime.notifier,
    )
    app = FastAPI(title="ClassAll Worker", version="0.1.0")
    app.state.runtime = runtime

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "classall-worker"}

    @app.post("/internal/pubsub/doc-task")
    def document_task(envelope: dict[str, Any]) -> dict[str, Any]:
        payload = _pubsub_data(envelope)
        case_id = payload.get("case_id")
        if not case_id:
            raise HTTPException(400, "case_id is required")
        case = processor.process(case_id)
        return {"case_id": case_id, "state": case.get("processing_state") if case else None}

    @app.post("/internal/pubsub/gmail-event")
    def gmail_event(envelope: dict[str, Any]) -> dict[str, Any]:
        notification = _pubsub_data(envelope)
        try:
            case_ids = process_gmail_notification(runtime, notification)
            runtime.repository.set_gmail_state({"oauth_status": "connected", "oauth_error": None})
        except RefreshError:
            _signal_gmail_reconnect(runtime)
            return {"accepted": 0, "case_ids": [], "reconnect_required": True}
        return {"accepted": len(case_ids), "case_ids": case_ids}

    @app.post("/internal/cron/gmail-watch")
    def gmail_watch() -> dict[str, Any]:
        topic = (
            f"projects/{runtime.settings.google_cloud_project}/topics/"
            f"{runtime.settings.gmail_events_topic}"
        )
        try:
            watch = runtime.gmail.renew_watch(topic)
        except RefreshError:
            _signal_gmail_reconnect(runtime)
            return {"reconnect_required": True}
        reconciled = reconcile_recent_gmail(runtime)
        runtime.repository.set_gmail_state(
            {
                "history_id": watch["historyId"],
                "watch_expiration": watch["expiration"],
                "oauth_status": "connected",
                "oauth_error": None,
            }
        )
        return {"history_id": watch["historyId"], "reconciled_cases": len(reconciled)}

    @app.post("/internal/cron/gmail-reconcile")
    def gmail_reconcile() -> dict[str, Any]:
        limit = int(
            runtime.repository.get_platform_settings().get(
                "gmail_reconcile_limit", runtime.settings.gmail_reconcile_limit
            )
        )
        case_ids = reconcile_recent_gmail(runtime, max_results=limit)
        if case_ids and runtime.settings.telegram_admin_chat_id:
            runtime.telegram.send_message(
                runtime.settings.telegram_admin_chat_id,
                f"<b>Hourly Gmail reconciliation</b>\n"
                f"Cases handled: <b>{len(case_ids)}</b>\n"
                f"Hourly cap: <b>{limit}</b>",
            )
        return {"accepted": len(case_ids), "limit": limit, "case_ids": case_ids}

    @app.get("/api/cron/summary")
    def weekly_summary() -> dict[str, Any]:
        year, week, _ = datetime.now(UTC).isocalendar()
        iso_week = f"{year}-W{week:02d}"
        if not runtime.repository.claim_weekly_summary(iso_week):
            return {"iso_week": iso_week, "already_sent": True}
        try:
            published = runtime.knowledge_publisher.publish_weekly(iso_week)
            if runtime.settings.telegram_admin_chat_id:
                drive_link = published.get("drive_url", "N/A")
                runtime.telegram.send_message(
                    runtime.settings.telegram_admin_chat_id,
                    "<b>ClassAll weekly summary & Knowledge Base published</b>\n"
                    f"Week: <code>{iso_week}</code>\n"
                    f"Cases analyzed: {published.get('cases_analyzed', 0)}\n"
                    f"Status: {json.dumps(published.get('status_counts', {}), sort_keys=True)}\n"
                    f"Assumptions tracked: {published.get('assumptions_count', 0)}\n"
                    f"Doc: <a href=\"{drive_link}\">Open Weekly Knowledge Base</a>",
                )
        except Exception:
            runtime.repository.release_weekly_summary(iso_week)
            raise
        return {**published, "iso_week": iso_week, "already_sent": False}

    return app


app = create_app()
