"""Integration tests for FastAPI endpoints."""
from fastapi.testclient import TestClient

from backend.evaluation_adapter.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "email_classifier_triage_agent"
    assert "gemini_client_ready" in data


def test_classify_endpoint_document_comparison():
    payload = {
        "email_id": "api_test_01",
        "subject": "TO CONFIRM DOCS _ 5RSG-00133 _ CALLAO_PERU",
        "body": "Hi team, Attached are the SI and draft BL for OC 5RSG-00133. Please check the details and confirm.",
        "sender": "willy@shipping.com",
        "attachments": ["email_001_SI.txt", "email_001_BL.txt"],
    }
    response = client.post("/api/classify", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["category"] == "DOCUMENT_COMPARISON"
    assert data["is_comparison_candidate"] is True
    assert 0.0 <= data["confidence"] <= 1.0
    assert isinstance(data["reasoning"], str)
    assert len(data["reasoning"]) > 0


def test_classify_endpoint_invoice():
    payload = {
        "email_id": "api_test_02",
        "subject": "Overdue freight invoice INV-44910",
        "body": "Please find attached payment receipt for invoice INV-44910 regarding ocean freight charges.",
        "sender": "finance@client.com",
        "attachments": [],
    }
    response = client.post("/api/classify", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["category"] == "INVOICE_QUERY"
    assert data["is_comparison_candidate"] is False


def test_cors_headers():
    response = client.options(
        "/api/classify",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") in ["http://localhost:3000", "*"]

