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
        "raw_text": document.get("raw_text") or extraction.get("raw_text"),
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
            "low_confidence": field in low_confidence or (
                field == "gross_weight" and "gross_weight_kg" in low_confidence
            ),
        }
        for field, label in VERIFIED_FIELDS
    ]


def build_case_summary(case: dict[str, Any]) -> dict[str, Any]:
    result = case.get("result") or {}
    required = case.get("required_review_fields")
    if required is None:
        flagged = set(result.get("defect_fields") or []) | set(case.get("low_confidence_fields") or [])
        if "gross_weight_kg" in flagged:
            flagged.add("gross_weight")
        required = [field for field, _ in VERIFIED_FIELDS if field in flagged]
    field_reviews = case.get("field_reviews") or {}
    unresolved = [field for field in required if not field_reviews.get(field, {}).get("resolved")]
    confidence_val = (
        case.get("confidence")
        or case.get("confidence_score")
        or (case.get("result") or {}).get("confidence")
        or (case.get("result") or {}).get("confidence_score")
    )
    if confidence_val is None:
        if case.get("low_confidence"):
            flagged_count = len(case.get("low_confidence_fields") or []) or 1
            confidence_val = max(0.55, 0.74 - (flagged_count - 1) * 0.05)
        elif result.get("status") == "MISMATCH":
            defects_count = len(result.get("defect_fields") or []) or 1
            confidence_val = max(0.72, 0.88 - (defects_count - 1) * 0.04)
        elif result.get("status") == "NEEDS_REVIEW":
            reason = str(result.get("review_reason") or "").lower()
            confidence_val = 0.52 if "unreadable" in reason else (0.74 if "missing" in reason else 0.68)
        elif result.get("status") == "OK":
            confidence_val = 0.96
        else:
            confidence_val = 0.85
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
        "confidence": round(float(confidence_val), 2),
        "version": case.get("version", 0),
        "draft_state": case.get("draft_state"),
        "unresolved_fields": unresolved,
        "review_progress": {"total": len(required), "completed": len(required) - len(unresolved)},
    }


def build_case_detail(case: dict[str, Any], documents: list[dict[str, Any]]) -> dict[str, Any]:
    comparisons = build_comparisons(documents, case)
    required = required_review_fields(case, comparisons)
    summary = build_case_summary({**case, "required_review_fields": required})
    valid_confidences = [
        val["confidence"]
        for comp in comparisons
        for val in (comp.get("si", {}), comp.get("bl", {}))
        if isinstance(val.get("confidence"), (int, float)) and val["confidence"] > 0
    ]
    if valid_confidences:
        summary["confidence"] = round(sum(valid_confidences) / len(valid_confidences), 2)
    return {
        **summary,
        "body": case.get("body", ""),
        "recipients": case.get("recipients", []),
        "rationale": case.get("rationale", ""),
        "assumptions": case.get("assumptions", []),
        "result": case.get("result"),
        "documents": [_public_document(document) for document in documents],
        "comparisons": comparisons,
        "field_reviews": case.get("field_reviews") or {},
        "review_history": case.get("review_history") or [],
        "draft": (
            {
                "state": (case.get("correction_draft") or {}).get("state") or case.get("draft_state", "READY"),
                "subject": (case.get("correction_draft") or {}).get("subject") or case.get("draft_subject", ""),
                "body": (case.get("correction_draft") or {}).get("body") or case.get("draft_body", ""),
                "content_hash": (case.get("correction_draft") or {}).get("content_hash") or case.get("draft_content_hash", ""),
                "delivery_mode": (case.get("correction_draft") or {}).get("delivery_mode") or ("live" if case.get("has_live_gmail") else "compose"),
                "origin": (case.get("correction_draft") or {}).get("origin", "template"),
                "gmail_url": (case.get("correction_draft") or {}).get("gmail_url") or case.get("gmail_draft_url"),
                "has_live_gmail": (case.get("correction_draft") or {}).get("delivery_mode") == "live" if (case.get("correction_draft") or {}).get("delivery_mode") else bool(case.get("has_live_gmail")),
                "attachments": (case.get("correction_draft") or {}).get("attachments") or case.get("draft_attachments", []),
                "prepared_at": (case.get("correction_draft") or {}).get("prepared_at"),
                "sent_at": (case.get("correction_draft") or {}).get("sent_at"),
                "sent_by": (case.get("correction_draft") or {}).get("sent_by"),
            }
            if (case.get("correction_draft") and (case.get("correction_draft") or {}).get("subject"))
            or case.get("gmail_draft_id")
            or case.get("draft_subject")
            or case.get("draft_body")
            else None
        ),
    }


def required_review_fields(case: dict[str, Any], comparisons: list[dict[str, Any]]) -> list[str]:
    """Keep the original issues visible even after a reviewer supplies a value."""
    required = set(case.get("required_review_fields") or [])
    for comparison in comparisons:
        if (
            not comparison["matches"]
            or comparison["low_confidence"]
            or any(comparison[role]["value"] in (None, "") for role in ("si", "bl"))
        ):
            required.add(comparison["field"])
    # Some cases are routed for document-level uncertainty with no flagged field.
    if not required and (case.get("result") or {}).get("status") == "NEEDS_REVIEW":
        required.update(field for field, _ in VERIFIED_FIELDS)
    required.update(case.get("field_reviews") or {})
    return [field for field, _ in VERIFIED_FIELDS if field in required]


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
