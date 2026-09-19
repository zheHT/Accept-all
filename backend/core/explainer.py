from __future__ import annotations

import json
from typing import Any


class CaseExplainer:
    def __init__(self, project: str, location: str, model: str, *, enabled: bool = True) -> None:
        self.project = project
        self.location = location
        self.model = model
        self.enabled = enabled

    def explain(self, case: dict[str, Any], question: str) -> str:
        evidence = {
            "case_id": case["case_id"],
            "category": case.get("category"),
            "result": case.get("result"),
            "rationale": case.get("rationale"),
            "assumptions": case.get("assumptions", []),
        }
        if not self.enabled:
            return self._deterministic(evidence)
        from google import genai
        from google.genai import types

        client = genai.Client(vertexai=True, project=self.project, location=self.location)
        response = client.models.generate_content(
            model=self.model,
            contents=(
                "Answer the reviewer question using only the stored case evidence below. "
                "If the evidence does not answer it, say so. Do not invent facts or reveal "
                "hidden chain-of-thought.\n\n"
                f"Evidence: {json.dumps(evidence, default=str)}\n\nQuestion: {question}"
            ),
            config=types.GenerateContentConfig(temperature=0),
        )
        return response.text.strip()

    @staticmethod
    def _deterministic(evidence: dict[str, Any]) -> str:
        result = evidence.get("result") or {}
        details = result.get("defect_fields") or [result.get("review_reason", "no discrepancy")]
        assumptions = evidence.get("assumptions") or []
        return (
            f"The stored result is {result.get('status', 'unknown')}. "
            f"Recorded details: {', '.join(filter(None, details))}. "
            f"Recorded assumptions: {', '.join(assumptions) if assumptions else 'none'}."
        )
