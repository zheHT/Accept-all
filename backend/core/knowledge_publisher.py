from __future__ import annotations

import hashlib
import json
import logging
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.core.config import Settings
from backend.core.explainer import CaseExplainer
from backend.core.repository import CaseRepository

logger = logging.getLogger(__name__)

DOCS_SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
]


class KnowledgePublisher:
    def __init__(
        self,
        repository: CaseRepository,
        explainer: CaseExplainer,
        settings: Settings,
        local_dir: Path | None = None,
    ) -> None:
        self.repository = repository
        self.explainer = explainer
        self.settings = settings
        self.local_dir = local_dir or Path(".local-blobs") / "knowledge_base"

    def aggregate_week_data(self, iso_week: str) -> dict[str, Any]:
        cases = self.repository.list_cases(limit=200)
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

    def build_weekly_markdown(self, aggregated: dict[str, Any], narrative: str) -> str:
        lines = [
            f"# ClassAll Weekly Knowledge Base — {aggregated['iso_week']}",
            "",
            "## 1. Executive Summary",
            narrative,
            "",
            "## 2. Ingestion & Classification Counts",
            "| Category | Count |",
            "| :--- | :--- |",
        ]
        for cat, cnt in sorted(aggregated["category_counts"].items()):
            lines.append(f"| {cat} | {cnt} |")
        if not aggregated["category_counts"]:
            lines.append("| None | 0 |")

        lines.extend([
            "",
            "## 3. Verification Outcomes",
            "| Outcome Status | Count |",
            "| :--- | :--- |",
        ])
        for st, cnt in sorted(aggregated["status_counts"].items()):
            lines.append(f"| {st} | {cnt} |")
        if not aggregated["status_counts"]:
            lines.append("| None | 0 |")

        lines.extend([
            "",
            "## 4. Repeated Operational Assumptions",
            "| Field | Assumption / Normalization | Evidence Count | Status |",
            "| :--- | :--- | :--- | :--- |",
        ])
        for a in aggregated["assumptions"]:
            lines.append(
                f"| {a['field']} | {a['normalized_value']} | "
                f"{a['evidence_count']} | {a['status'].upper()} |"
            )
        if not aggregated["assumptions"]:
            lines.append("| - | No assumptions recorded this week | 0 | - |")

        lines.extend([
            "",
            "## 5. Reviewer Governance",
            "All assumptions marked as ACCEPTED reflect verified operations confirmed by team "
            "reviewers. Unconfirmed assumptions remain PROPOSED until evaluated.",
            "",
            f"*Generated by ClassAll Publisher for reporting period {aggregated['iso_week']}*",
        ])
        return "\n".join(lines)

    def build_registry_markdown(self) -> str:
        assumptions = self.repository.list_assumptions()
        lines = [
            "# ClassAll Operational Assumption Registry",
            "",
            "This document is the authoritative human-approved registry of operational rules, "
            "abbreviation mappings, and parsing interpretations across shipping documents.",
            "",
            "## 1. Approved Rules (Accepted)",
            "| Field | Operational Interpretation | Evidence Count | Last Confirmed By | Date |",
            "| :--- | :--- | :--- | :--- | :--- |",
        ]
        accepted = [a for a in assumptions if a.get("status") == "accepted"]
        for a in accepted:
            conf_by = a.get("last_confirmed_by") or "operator"
            conf_date = a.get("last_confirmed_date") or "-"
            lines.append(
                f"| {a['field']} | {a['normalized_value']} | {a['evidence_count']} | "
                f"{conf_by} | {conf_date} |"
            )
        if not accepted:
            lines.append("| - | No approved rules in registry yet | - | - | - |")

        lines.extend([
            "",
            "## 2. Pending Candidates (Proposed)",
            "| Field | Candidate Rule | Evidence Count |",
            "| :--- | :--- | :--- |",
        ])
        proposed = [a for a in assumptions if a.get("status") != "accepted"]
        for a in proposed:
            lines.append(f"| {a['field']} | {a['normalized_value']} | {a['evidence_count']} |")
        if not proposed:
            lines.append("| - | No pending candidate rules | - |")

        lines.extend([
            "",
            "*ClassAll Operational Assumption Registry — Synchronized Rulebook*",
        ])
        return "\n".join(lines)

    def publish_to_drive_or_local(
        self, title: str, markdown_content: str, filename_prefix: str
    ) -> tuple[str, str]:
        """Publishes to Google Docs if credentials available; else writes local files."""
        # Try Google Docs/Drive API first if not in local mode
        if self.settings.app_env.lower() not in {"local", "test"}:
            try:
                import google.auth
                from googleapiclient.discovery import build

                credentials, _ = google.auth.default(scopes=DOCS_SCOPES)
                docs_service = build("docs", "v1", credentials=credentials)

                # Create document
                doc = docs_service.documents().create(body={"title": title}).execute()
                doc_id = doc.get("documentId")
                drive_url = f"https://docs.google.com/document/d/{doc_id}/edit"

                # Insert text
                docs_service.documents().batchUpdate(
                    documentId=doc_id,
                    body={
                        "requests": [
                            {
                                "insertText": {
                                    "location": {"index": 1},
                                    "text": markdown_content,
                                }
                            }
                        ]
                    },
                ).execute()

                logger.info("Published %s to Google Docs: %s", title, drive_url)
                return doc_id, drive_url
            except Exception as exc:
                logger.warning(
                    "Google Drive/Docs API unavailable or failed (%s). "
                    "Falling back to local storage.",
                    exc,
                )

        # Local storage fallback
        self.local_dir.mkdir(parents=True, exist_ok=True)
        md_file = self.local_dir / f"{filename_prefix}.md"
        md_file.write_text(markdown_content, encoding="utf-8")

        # Also write a basic HTML preview
        html_file = self.local_dir / f"{filename_prefix}.html"
        style = (
            "body{font-family:system-ui,sans-serif;margin:40px;max-width:800px;"
            "line-height:1.6;color:#1e293b;background:#f8fafc;}"
            "pre{background:#e2e8f0;padding:16px;border-radius:6px;overflow-x:auto;}"
            "table{border-collapse:collapse;width:100%;margin:16px 0;}"
            "th,td{border:1px solid #cbd5e1;padding:8px 12px;text-align:left;}"
            "th{background:#f1f5f9;}"
        )
        html_content = (
            f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>{title}</title>"
            f"<style>{style}</style></head>"
            f"<body><pre>{markdown_content}</pre></body></html>"
        )
        html_file.write_text(html_content, encoding="utf-8")

        doc_id = f"local-{filename_prefix}"
        drive_url = f"/api/knowledge-base/preview/{filename_prefix}"
        return doc_id, drive_url

    def publish_weekly(self, iso_week: str) -> dict[str, Any]:
        aggregated = self.aggregate_week_data(iso_week)
        narrative = self.generate_narrative(aggregated)
        weekly_md = self.build_weekly_markdown(aggregated, narrative)
        content_hash = hashlib.sha256(weekly_md.encode("utf-8")).hexdigest()

        # Idempotency check: if already published with identical content_hash
        existing = self.repository.get_knowledge_base_week(iso_week)
        if existing and existing.get("content_hash") == content_hash:
            return {**existing, "idempotent": True}

        # Publish Weekly Doc
        title = f"ClassAll Assumptions — {iso_week}"
        doc_id, drive_url = self.publish_to_drive_or_local(
            title=title,
            markdown_content=weekly_md,
            filename_prefix=f"ClassAll_Assumptions_{iso_week}",
        )

        # Synchronize Evergreen Assumption Registry
        registry_md = self.build_registry_markdown()
        self.publish_to_drive_or_local(
            title="ClassAll Assumption Registry",
            markdown_content=registry_md,
            filename_prefix="ClassAll_Assumption_Registry",
        )

        week_record = {
            "week": iso_week,
            "drive_file_id": doc_id,
            "drive_url": drive_url,
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
