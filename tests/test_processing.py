from backend.core.inference import ModelRouter
from backend.core.processing import CaseProcessor
from backend.core.schemas import (
    DocumentExtraction,
    DocumentType,
    EmailCategory,
    ExtractedField,
    ExtractedNumericField,
    ModelExtraction,
    ShippingDocument,
)


def fields(consignee="Example Co"):
    return ShippingDocument(
        shipper=ExtractedField(value="Shipper"),
        consignee=ExtractedField(value=consignee),
        notify_party=ExtractedField(value="Notify"),
        port_of_loading=ExtractedField(value="Singapore"),
        port_of_discharge=ExtractedField(value="Callao"),
        container_count=ExtractedNumericField(value=2, unit="containers"),
        gross_weight_kg=ExtractedNumericField(value=50000, unit="kg"),
    )


def test_processing_is_idempotent_and_completes_run(runtime):
    runtime.repository.create_run("run-1", 1)
    case, created = runtime.ingestor.ingest(
        {
            "source_type": "grader",
            "source_message_id": "email_001",
            "sender": "sender@example.com",
            "subject": "TO CONFIRM DOCS",
            "body": "Please compare.",
            "run_id": "run-1",
        },
        [
            ("email_001_SI.txt", "text/plain", b"SI content"),
            ("email_001_BL.txt", "text/plain", b"BL content"),
        ],
    )
    assert created

    extraction = ModelExtraction(
        category=EmailCategory.BL_COMPARISON,
        confidence_score=0.99,
        rationale="Both documents extracted",
        documents=[
            DocumentExtraction(
                filename="email_001_SI.txt", document_type=DocumentType.SI, fields=fields()
            ),
            DocumentExtraction(
                filename="email_001_BL.txt",
                document_type=DocumentType.BL,
                fields=fields("Different Co"),
            ),
        ],
    )
    runtime.router = ModelRouter(
        project="test",
        location="global",
        primary_model="p1",
        fallback_model="p2",
        generator=lambda *_: extraction,
    )
    processor = CaseProcessor(
        runtime.repository, runtime.blobs, runtime.router, notifier=runtime.notifier
    )
    first = processor.process(case["case_id"])
    second = processor.process(case["case_id"])
    assert first["result"]["status"] == "MISMATCH"
    assert second["version"] == first["version"]
    run = runtime.repository.get_run("run-1")
    assert run["terminal"] == 1
    assert run["results"]["email_001"]["has_defect"] is True


def test_missing_attachment_escalates(runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "grader",
            "source_message_id": "email_506",
            "subject": "COMPARE BL",
            "body": "",
            "run_id": None,
        },
        [],
    )
    extraction = ModelExtraction(
        category=EmailCategory.BL_COMPARISON, confidence_score=0.8, rationale="Comparison request"
    )
    runtime.router = ModelRouter(
        project="test",
        location="global",
        primary_model="p1",
        fallback_model="p2",
        generator=lambda *_: extraction,
    )
    result = CaseProcessor(runtime.repository, runtime.blobs, runtime.router).process(
        case["case_id"]
    )
    assert result["result"]["review_reason"] == "missing_attachment"
