from __future__ import annotations

from typing import Any

from backend.api.views import build_comparisons, required_review_fields
from backend.core.repository import utcnow
from backend.core.schemas import FieldReviewRequest


def field_review_changes(
    case: dict[str, Any],
    documents: list[dict[str, Any]],
    field: str,
    request: FieldReviewRequest,
    reviewer: dict[str, Any],
) -> dict[str, Any]:
    comparisons = build_comparisons(documents, case)
    comparison = next((item for item in comparisons if item["field"] == field), None)
    if comparison is None:
        raise ValueError("unknown verification field")
    role = request.document_role.lower()
    other_role = "si" if role == "bl" else "bl"
    previous = (case.get("field_reviews") or {}).get(field) or {}
    effective = dict(previous.get("effective_values") or {
        "si": comparison["si"]["value"], "bl": comparison["bl"]["value"],
    })
    original = effective[role]
    if request.decision == "confirm" and (
        original in (None, "") or effective[other_role] in (None, "")
    ):
        raise ValueError("missing values cannot be confirmed; supply a correction or mark unreadable")
    value = request.value if request.decision == "correct" else (
        original if request.decision == "confirm" else None
    )
    effective[role] = value
    record = {
        "field": field,
        "decision": request.decision,
        "document_role": request.document_role,
        "value": value,
        "effective_values": effective,
        "note": request.note,
        "reviewer": reviewer.get("email") or reviewer.get("uid"),
        "reviewer_id": reviewer.get("uid"),
        "at": utcnow().isoformat(),
        "original_si": comparison["si"],
        "original_bl": comparison["bl"],
        "resolved": request.decision != "unreadable" and effective[other_role] not in (None, ""),
    }
    reviews = {**(case.get("field_reviews") or {}), field: record}
    return {
        "field_reviews": reviews,
        "review_history": [*(case.get("review_history") or []), record],
        "required_review_fields": required_review_fields({**case, "field_reviews": reviews}, comparisons),
        # Saving evidence is not a final case decision.
        "review_decision": None,
    }
