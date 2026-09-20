from __future__ import annotations

import hashlib
import json
import logging
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.core.explainer import CaseExplainer
from backend.core.repository import CaseRepository

logger = logging.getLogger(__name__)


class KnowledgePublisher:
    def __init__(
        self,
        repository: CaseRepository,
        explainer: CaseExplainer,
    ) -> None:
        self.repository = repository
        self.explainer = explainer

    def aggregate_week_data(self, iso_week: str) -> dict[str, Any]:
        try:
            year_text, week_text = iso_week.split("-W", 1)
            week_start = datetime.fromisocalendar(int(year_text), int(week_text), 1).replace(
                tzinfo=UTC
            )
        except (ValueError, TypeError) as exc:
            raise ValueError("week must use ISO format YYYY-Www") from exc
        week_end = week_start + timedelta(days=7)

        def in_requested_week(case: dict[str, Any]) -> bool:
            created = case.get("created_at")
            if isinstance(created, str):
                created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if isinstance(created, datetime):
                if created.tzinfo is None:
                    created = created.replace(tzinfo=UTC)
                return week_start <= created.astimezone(UTC) < week_end
            return False

        cases = [
            case for case in self.repository.list_cases(limit=5000) if in_requested_week(case)
        ]
        status_counts = Counter(
            (case.get("result") or {}).get("status", "PENDING") for case in cases
        )
        category_counts = Counter(
            (case.get("result") or {}).get("category", case.get("category", "UNKNOWN"))
            for case in cases
        )

        extracted_assumptions: dict[str, dict[str, Any]] = {}
        for case in cases:
            case_id = case.get("case_id", "")
            assumptions = case.get("assumptions") or []
            review_decision = case.get("review_decision")

            for item in assumptions:
                if isinstance(item, dict):
                    field = item.get("field", "general")
                    val = item.get("assumption", "")
                    conf = float(item.get("confidence", 0.9))
                else:
                    field = "general"
                    val = str(item)
                    conf = 0.9

                norm_key = f"{field}:{val.strip().lower()}"
                if norm_key not in extracted_assumptions:
                    status = "accepted" if review_decision == "APPROVE" else "proposed"
                    extracted_assumptions[norm_key] = {
                        "assumption_id": hashlib.sha256(norm_key.encode()).hexdigest()[:16],
                        "field": field,
                        "normalized_value": val,
                        "evidence_count": 1,
                        "confidence": conf,
                        "case_links": [case_id],
                        "status": status,
                        "last_confirmed_by": "reviewer" if review_decision == "APPROVE" else None,
                        "last_confirmed_date": (
                            datetime.now(UTC).isoformat()
                            if review_decision == "APPROVE"
                            else None
                        ),
                        "created_at": datetime.now(UTC).isoformat(),
                    }
                else:
                    entry = extracted_assumptions[norm_key]
                    entry["evidence_count"] += 1
                    if case_id and case_id not in entry["case_links"]:
                        entry["case_links"].append(case_id)
                    if review_decision == "APPROVE":
                        entry["status"] = "accepted"
                        entry["last_confirmed_by"] = "reviewer"
                        entry["last_confirmed_date"] = datetime.now(UTC).isoformat()

        # Save assumptions into repository
        for record in extracted_assumptions.values():
            self.repository.save_assumption(record)

        return {
            "iso_week": iso_week,
            "total_cases": len(cases),
            "status_counts": dict(status_counts),
            "category_counts": dict(category_counts),
            "assumptions": list(extracted_assumptions.values()),
        }

    def generate_narrative(self, aggregated: dict[str, Any]) -> str:
        prompt = (
            "You are the ClassAll shipping operations expert. Generate a concise 3-4 sentence "
            "executive summary for the weekly knowledge base report based on operational stats. "
            "Highlight key categories, validation discrepancy trends, and notable recurring "
            "assumptions. Do not invent facts or mention hidden reasoning.\n\n"
            f"Stats: {json.dumps(aggregated, default=str)}"
        )
        try:
            narrative = self.explainer.explain({"case_id": "weekly-summary"}, prompt)
            if narrative and not narrative.startswith("The stored result is"):
                return narrative
        except Exception as exc:
            logger.warning("Gemini narrative synthesis encountered an error: %s", exc)

        # Deterministic fallback narrative
        total = aggregated["total_cases"]
        ok = aggregated["status_counts"].get("OK", 0)
        mismatch = aggregated["status_counts"].get("MISMATCH", 0)
        review = aggregated["status_counts"].get("NEEDS_REVIEW", 0)
        assump_count = len(aggregated["assumptions"])

        return (
            f"During {aggregated['iso_week']}, ClassAll processed {total} shipping operation "
            f"cases. Deterministic verification yielded {ok} matching cases, {mismatch} detected "
            f"discrepancies, and {review} cases requiring human review. A total of {assump_count} "
            "operational assumptions were documented and tracked for human confirmation."
        )

    def publish_weekly(self, iso_week: str) -> dict[str, Any]:
        aggregated = self.aggregate_week_data(iso_week)
        narrative = self.generate_narrative(aggregated)
        stable_assumptions = [
            {
                "field": assumption.get("field"),
                "normalized_value": assumption.get("normalized_value"),
                "evidence_count": assumption.get("evidence_count"),
                "confidence": assumption.get("confidence"),
                "status": assumption.get("status"),
            }
            for assumption in aggregated["assumptions"]
        ]
        content_hash = hashlib.sha256(
            json.dumps(
                {
                    "iso_week": iso_week,
                    "status_counts": aggregated["status_counts"],
                    "category_counts": aggregated["category_counts"],
                    "assumptions": sorted(
                        stable_assumptions,
                        key=lambda assumption: (
                            str(assumption["field"]),
                            str(assumption["normalized_value"]),
                        ),
                    ),
                    "narrative": narrative,
                },
                sort_keys=True,
                default=str,
            ).encode("utf-8")
        ).hexdigest()

        # Idempotency check: if already published with identical content_hash
        existing = self.repository.get_knowledge_base_week(iso_week)
        if existing and existing.get("content_hash") == content_hash:
            return {**existing, "idempotent": True}

        week_record = {
            "week": iso_week,
            "content_hash": content_hash,
            "source_watermark": f"cases-{aggregated['total_cases']}",
            "published_at": datetime.now(UTC).isoformat(),
            "status": "published",
            "cases_analyzed": aggregated["total_cases"],
            "status_counts": aggregated["status_counts"],
            "category_counts": aggregated["category_counts"],
            "assumptions_count": len(aggregated["assumptions"]),
            "summary_narrative": narrative,
        }

        self.repository.save_knowledge_base_week(week_record)
        return week_record
