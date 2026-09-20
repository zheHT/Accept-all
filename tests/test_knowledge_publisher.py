from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.main import create_app as create_api_app
from backend.core.runtime import Runtime
from backend.core.schemas import ResultStatus
from backend.worker.main import create_app as create_worker_app


def test_knowledge_publisher_aggregates_and_publishes(runtime: Runtime) -> None:
    # Seed cases with various statuses and assumptions
    runtime.repository.create_case(
        "case-1",
        {
            "case_id": "case-1",
            "category": "BL_COMPARISON",
            "result": {
                "category": "BL_COMPARISON",
                "status": ResultStatus.OK.value,
                "review_reason": None,
                "defect_fields": [],
                "has_defect": False,
            },
            "assumptions": [
                {
                    "field": "gross_weight_kg",
                    "assumption": "KGS converted to kg",
                    "confidence": 0.95,
                }
            ],
            "review_decision": "APPROVE",
        },
    )
    runtime.repository.create_case(
        "case-2",
        {
            "case_id": "case-2",
            "category": "SI_REQUEST",
            "result": {
                "category": "SI_REQUEST",
                "status": ResultStatus.NEEDS_REVIEW.value,
                "review_reason": "unreadable",
                "defect_fields": ["consignee"],
                "has_defect": True,
            },
            "assumptions": [
                {"field": "consignee", "assumption": "Interpreted faded stamp", "confidence": 0.65}
            ],
        },
    )

    # Publish weekly knowledge base
    published = runtime.knowledge_publisher.publish_weekly("2026-W38")

    assert published["week"] == "2026-W38"
    assert published["cases_analyzed"] == 2
    assert published["status_counts"]["OK"] == 1
    assert published["status_counts"]["NEEDS_REVIEW"] == 1
    assert published["assumptions_count"] == 2
    assert published["content_hash"]
    assert "drive_url" not in published
    assert "preview_uri" not in published

    # Verify repository storage
    stored_week = runtime.repository.get_knowledge_base_week("2026-W38")
    assert stored_week is not None
    assert stored_week["content_hash"] == published["content_hash"]

    # Verify assumptions stored in registry
    assumptions = runtime.repository.list_assumptions()
    assert len(assumptions) == 2
    accepted = [a for a in assumptions if a["status"] == "accepted"]
    assert len(accepted) == 1
    assert accepted[0]["field"] == "gross_weight_kg"

    # Test idempotency: republishing identical week
    republished = runtime.knowledge_publisher.publish_weekly("2026-W38")
    assert republished.get("idempotent") is True
    assert republished["content_hash"] == published["content_hash"]


def test_api_knowledge_base_routes(runtime: Runtime) -> None:
    api = TestClient(create_api_app(runtime))

    # Trigger publication via API
    resp = api.post("/api/knowledge-base/publish?week=2026-W39")
    assert resp.status_code == 200
    data = resp.json()
    assert data["week"] == "2026-W39"

    # List weeks
    weeks_resp = api.get("/api/knowledge-base/weeks")
    assert weeks_resp.status_code == 200
    weeks = weeks_resp.json()
    assert any(w["week"] == "2026-W39" for w in weeks)

    # Get specific week
    week_resp = api.get("/api/knowledge-base/weeks/2026-W39")
    assert week_resp.status_code == 200
    assert week_resp.json()["week"] == "2026-W39"

    # List assumption registry
    registry_resp = api.get("/api/knowledge-base/registry")
    assert registry_resp.status_code == 200
    assert isinstance(registry_resp.json(), list)

    # The removed document preview route must not be available.
    preview_resp = api.get("/api/knowledge-base/preview/ShipVerify_Assumptions_2026-W39")
    assert preview_resp.status_code == 404


def test_worker_weekly_summary_cron_publishes(runtime: Runtime) -> None:
    worker = TestClient(create_worker_app(runtime))

    # Invoke weekly cron summary
    resp = worker.get("/api/cron/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["already_sent"] is False
    assert "week" in data
    assert "drive_url" not in data
    assert data["status"] == "published"

    # Subsequent run in same week is already claimed
    second = worker.get("/api/cron/summary")
    assert second.status_code == 200
    assert second.json()["already_sent"] is True
