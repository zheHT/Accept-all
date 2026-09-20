from copy import deepcopy
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from backend.api.main import create_app
from backend.api.views import VERIFIED_FIELDS


@pytest.fixture
def review_client(runtime):
    runtime.repository.create_case("case-review", {
        "source_type": "gmail", "source_message_id": "message-review",
        "processing_state": "TERMINAL",
        "result": {"status": "NEEDS_REVIEW", "review_reason": "low_confidence"},
        "low_confidence_fields": ["shipper", "consignee"],
    })
    for role in ("SI", "BL"):
        fields = {
            "gross_weight_kg" if field == "gross_weight" else field: {
                "value": f"{field} value", "confidence": 0.7 if field == "shipper" else 1,
            } for field, _ in VERIFIED_FIELDS
        }
        runtime.repository.add_document("case-review", role, {
            "filename": f"{role}.pdf", "content_type": "application/pdf",
            "gcs_uri": runtime.blobs.upload(f"{role}.pdf", b"%PDF-1.4\nfixture", "application/pdf"),
            "extraction": {"document_type": role, "fields": fields},
        })
    return TestClient(create_app(runtime))


def save_field(client, field="shipper", version=0, **kwargs):
    return client.put(f"/api/cases/case-review/fields/{field}/review", json={
        "decision": "correct", "expected_version": version,
        "value": "Corrected shipper", "note": "Checked original PDF", **kwargs,
    })


def test_correction_survives_reload_and_keeps_other_issues_visible(runtime, review_client):
    originals = deepcopy(runtime.repository.list_documents("case-review"))
    response = save_field(review_client)
    assert response.status_code == 200, response.text
    detail = response.json()
    review = detail["field_reviews"]["shipper"]
    assert review["reviewer_id"] == "local-reviewer"
    assert review["reviewer"] == "local@example.test"
    assert review["original_bl"]["value"] == "shipper value"
    assert review["value"] == "Corrected shipper"
    assert review["at"]
    assert detail["review_decision"] is None
    assert detail["unresolved_fields"] == ["consignee"]
    assert detail["review_progress"] == {"completed": 1, "total": 2}
    assert review_client.get("/api/cases/case-review").json()["field_reviews"] == detail["field_reviews"]
    assert review_client.get("/api/reviews").json()["items"][0]["case_id"] == "case-review"
    assert runtime.repository.list_documents("case-review") == originals
    assert runtime.gmail.drafts == {}


def test_concurrent_review_does_not_overwrite_history(runtime, review_client):
    assert save_field(review_client).status_code == 200
    assert save_field(review_client, value="stale overwrite").status_code == 409
    case = runtime.repository.get_case("case-review")
    assert len(case["review_history"]) == 1
    assert case["field_reviews"]["shipper"]["value"] == "Corrected shipper"


def test_unreadable_stays_unresolved_and_blocks_final_approval(review_client):
    response = save_field(review_client, decision="unreadable", value=None)
    assert response.status_code == 200
    assert response.json()["unresolved_fields"] == ["shipper", "consignee"]
    assert not response.json()["field_reviews"]["shipper"]["resolved"]
    response = review_client.post("/api/cases/case-review/review", json={
        "decision": "APPROVE", "expected_version": 1,
    })
    assert response.status_code == 409


def test_all_fields_reviewed_allows_explicit_approval(review_client):
    assert save_field(review_client).status_code == 200
    response = save_field(review_client, field="consignee", version=1, decision="confirm")
    assert response.status_code == 200
    assert response.json()["unresolved_fields"] == []
    assert response.json()["review_decision"] is None
    response = review_client.post("/api/cases/case-review/review", json={
        "decision": "APPROVE", "expected_version": 2,
    })
    assert response.status_code == 200
    assert review_client.get("/api/reviews").json()["items"] == []
    assert save_field(review_client, version=3).status_code == 409


@pytest.mark.parametrize("overrides", [
    {"value": "  "}, {"decision": "APPROVE"}, {"document_role": "OTHER"},
    {"expected_version": -1},
])
def test_invalid_field_review_rejected(review_client, overrides):
    assert save_field(review_client, **overrides).status_code == 422


def test_unknown_field_rejected(review_client):
    assert save_field(review_client, field="vessel").status_code == 422


def test_corrections_to_both_missing_sides_are_preserved(runtime, review_client):
    for role in ("SI", "BL"):
        doc = next(d for d in runtime.repository.list_documents("case-review") if d["document_id"] == role)
        doc["extraction"]["fields"]["shipper"]["value"] = None
        runtime.repository.update_document("case-review", role, {"extraction": doc["extraction"]})
    assert save_field(review_client, decision="confirm").status_code == 422
    first = save_field(review_client, document_role="SI", value="Source shipper")
    assert first.status_code == 200
    assert not first.json()["field_reviews"]["shipper"]["resolved"]
    second = save_field(review_client, version=1, value="BL shipper")
    record = second.json()["field_reviews"]["shipper"]
    assert record["resolved"]
    assert record["effective_values"] == {"si": "Source shipper", "bl": "BL shipper"}
    assert len(second.json()["review_history"]) == 2


def test_retry_invalidates_current_decisions_but_preserves_history(runtime, review_client):
    save_field(review_client)
    assert review_client.post("/api/cases/case-review/retry?expected_version=1").status_code == 200
    case = runtime.repository.get_case("case-review")
    assert case["field_reviews"] == {}
    assert len(case["review_history"]) == 1
    assert save_field(review_client, version=2).status_code == 409


def test_pdf_content_is_authenticated_scoped_and_not_cached(runtime, review_client):
    response = review_client.get("/api/cases/case-review/documents/SI/content")
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "private, no-store"
    assert review_client.get("/api/cases/case-review/documents/missing/content").status_code == 404
    runtime.repository.create_case("other", {})
    assert review_client.get("/api/cases/other/documents/SI/content").status_code == 404
    runtime.settings.app_env = "production"
    assert review_client.get("/api/cases/case-review/documents/SI/content").status_code == 401
    assert save_field(review_client).status_code == 401


def test_non_pdf_content_cannot_render_as_html(runtime, review_client):
    runtime.repository.add_document("case-review", "html", {
        "filename": "danger.html", "content_type": "text/html",
        "gcs_uri": runtime.blobs.upload("danger.html", b"<script>alert(1)</script>", "text/html"),
    })
    response = review_client.get("/api/cases/case-review/documents/html/content")
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["x-content-type-options"] == "nosniff"


def test_pdf_page_count_comes_from_original_bytes(runtime, review_client):
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.add_blank_page(width=612, height=792)
    target = BytesIO()
    writer.write(target)
    runtime.blobs.upload("SI.pdf", target.getvalue(), "application/pdf")
    response = review_client.get("/api/cases/case-review/documents/SI/content", headers={
        "Origin": "http://localhost:5173",
    })
    assert response.status_code == 200
    assert response.headers["x-document-page-count"] == "2"
    assert "X-Document-Page-Count" in response.headers["access-control-expose-headers"]


def test_gross_weight_internal_key_is_visible_for_review(runtime, review_client):
    runtime.repository.update_case("case-review", {"low_confidence_fields": ["gross_weight_kg"]})
    detail = review_client.get("/api/cases/case-review").json()
    assert detail["unresolved_fields"] == ["gross_weight"]
    assert detail["comparisons"][-1]["low_confidence"] is True
    assert review_client.get("/api/reviews").json()["items"][0]["unresolved_fields"] == ["gross_weight"]
