from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

VERIFIED_FIELDS = (
    ("shipper", "Shipper"),
    ("consignee", "Consignee"),
    ("notify_party", "Notify party"),
    ("port_of_loading", "Port of loading"),
    ("port_of_discharge", "Port of discharge"),
    ("container_count", "Container count"),
    ("gross_weight", "Gross weight"),
)


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or UTC).astimezone(UTC)
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    return datetime.min.replace(tzinfo=UTC)


def _cursor_value(case: dict[str, Any]) -> tuple[str, str]:
    return _as_datetime(case.get("created_at")).isoformat(), str(case.get("case_id", ""))


def encode_cursor(case: dict[str, Any]) -> str:
    raw = json.dumps(_cursor_value(case), separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        created_at, case_id = json.loads(raw)
        return str(created_at), str(case_id)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid cursor") from exc


def paginate(
    cases: list[dict[str, Any]], limit: int, cursor: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    ordered = sorted(
        cases,
        key=lambda item: (_as_datetime(item.get("created_at")), str(item.get("case_id", ""))),
        reverse=True,
    )
    if cursor:
        marker = decode_cursor(cursor)
        ordered = [item for item in ordered if _cursor_value(item) < marker]
    page = ordered[:limit]
    next_cursor = encode_cursor(page[-1]) if len(ordered) > limit and page else None
    return page, next_cursor


def _public_document(document: dict[str, Any]) -> dict[str, Any]:
    extraction = document.get("extraction") or {}
    return {
        "document_id": document.get("document_id"),
        "filename": document.get("filename"),
        "content_type": document.get("content_type"),
        "size_bytes": document.get("size_bytes", 0),
        "sha256": document.get("sha256"),
        "document_type": extraction.get("document_type", "UNKNOWN"),
        "readable": extraction.get("readable"),
    }


def _field(extraction: dict[str, Any], field: str) -> dict[str, Any]:
    internal = "gross_weight_kg" if field == "gross_weight" else field
    value = ((extraction.get("fields") or {}).get(internal) or {})
    return {
        "value": value.get("value"),
        "confidence": value.get("confidence"),
        "unit": value.get("unit"),
        "evidence": value.get("evidence"),
    }


def build_comparisons(documents: list[dict[str, Any]], case: dict[str, Any]) -> list[dict[str, Any]]:
    by_type: dict[str, dict[str, Any]] = {}
    for document in documents:
        extraction = document.get("extraction") or {}
        doc_type = extraction.get("document_type")
        if doc_type in {"SI", "BL"}:
            by_type[doc_type] = extraction
    defects = set((case.get("result") or {}).get("defect_fields") or [])
    low_confidence = set(case.get("low_confidence_fields") or [])
    return [
        {
            "field": field,
            "label": label,
            "si": _field(by_type.get("SI", {}), field),
            "bl": _field(by_type.get("BL", {}), field),
            "matches": field not in defects and (
                "gross_weight_kg" not in defects or field != "gross_weight"
            ),
            "low_confidence": field in low_confidence,
        }
        for field, label in VERIFIED_FIELDS
    ]


def build_case_summary(case: dict[str, Any]) -> dict[str, Any]:
    result = case.get("result") or {}
    return {
        "case_id": case.get("case_id"),
        "source_type": case.get("source_type"),
        "source_message_id": case.get("source_message_id"),
        "sender": case.get("sender", ""),
        "subject": case.get("subject", ""),
        "received_at": case.get("received_at"),
        "created_at": case.get("created_at"),
        "updated_at": case.get("updated_at"),
        "processing_state": case.get("processing_state"),
        "category": result.get("category") or case.get("category"),
        "status": result.get("status"),
        "review_reason": result.get("review_reason"),
        "defect_fields": result.get("defect_fields", []),
        "review_decision": case.get("review_decision"),
        "low_confidence": bool(case.get("low_confidence")),
        "low_confidence_fields": case.get("low_confidence_fields", []),
        "version": case.get("version", 0),
        "draft_state": case.get("draft_state"),
    }


def build_case_detail(case: dict[str, Any], documents: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        **build_case_summary(case),
        "body": case.get("body", ""),
        "recipients": case.get("recipients", []),
        "rationale": case.get("rationale", ""),
        "assumptions": case.get("assumptions", []),
        "result": case.get("result"),
        "documents": [_public_document(document) for document in documents],
        "comparisons": build_comparisons(documents, case),
        "draft": (
            {
                "state": case.get("draft_state"),
                "subject": case.get("draft_subject"),
                "body": case.get("draft_body"),
                "content_hash": case.get("draft_content_hash"),
            }
            if case.get("gmail_draft_id")
            else None
        ),
    }


def dashboard_view(cases: list[dict[str, Any]], period: str) -> dict[str, Any]:
    now = datetime.now(ZoneInfo("Asia/Kuala_Lumpur"))
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    selected = [
        case
        for case in cases
        if _as_datetime(case.get("created_at")) >= start.astimezone(UTC)
    ]
    statuses = [(case.get("result") or {}).get("status") for case in selected]
    unresolved = [
        case
        for case in cases
        if (case.get("result") or {}).get("status") in {"MISMATCH", "NEEDS_REVIEW"}
        and not case.get("review_decision")
    ]
    processing = [
        case
        for case in cases
        if case.get("processing_state") in {"DRAFT", "QUEUED", "PROCESSING"}
    ]
    return {
        "period": period,
        "timezone": "Asia/Kuala_Lumpur",
        "generated_at": datetime.now(UTC).isoformat(),
        "metrics": {
            "total": len(selected),
            "matches": statuses.count("OK"),
            "mismatches": statuses.count("MISMATCH"),
            "needs_review": statuses.count("NEEDS_REVIEW"),
            "processing": len(processing),
            "unresolved": len(unresolved),
        },
        "attention_items": [build_case_summary(case) for case in unresolved[:10]],
        "recent_items": [build_case_summary(case) for case in selected[:10]],
    }
