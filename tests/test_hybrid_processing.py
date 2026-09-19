from backend.core.inference import ModelRouter
from backend.core.processing import CaseProcessor
from backend.core.schemas import (
    DocumentRoute,
    EmailCategory,
    EmailClassification,
)
from backend.extraction.schemas import (
    ComparisonStatus,
    DocumentPairResult,
    ExtractedDocument,
    ValidationResult,
)


VALID = {
    "shipper": "Shipper",
    "consignee": "Consignee",
    "notify_party": "Notify",
    "port_of_loading": "Singapore",
    "port_of_discharge": "Callao",
    "container_count": 2,
    "gross_weight_kg": 50000,
}


def _classification(category: EmailCategory) -> EmailClassification:
    return EmailClassification(
        category=category,
        confidence_score=0.99,
        rationale="Classification complete",
        documents=[
            DocumentRoute(filename="email_001_SI.txt", document_type="SI"),
            DocumentRoute(filename="email_001_BL.txt", document_type="BL"),
        ],
    )


def test_hybrid_processor_previews_then_extracts_only_comparison_pairs(runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "grader",
            "source_message_id": "email_001",
            "subject": "Compare documents",
            "body": "Please verify the SI and BL.",
        },
        [
            ("email_001_SI.txt", "text/plain", b"SHIPPING INSTRUCTION\nShipper: A"),
            ("email_001_BL.txt", "text/plain", b"BILL OF LADING\nShipper: A"),
        ],
    )
    seen_attachments = []
    seen_pair = []

    def classifier(model, subject, body, attachments):
        del model, subject, body
        seen_attachments.extend(attachments)
        return _classification(EmailCategory.BL_COMPARISON)

    def pair_processor(si, bl):
        seen_pair.extend([si, bl])
        return DocumentPairResult(
            si=ExtractedDocument(**VALID),
            bl=ExtractedDocument(**{**VALID, "consignee": "Other"}),
            validation=ValidationResult(
                status=ComparisonStatus.MISMATCH,
                has_defect=True,
                defect_fields=["consignee"],
            ),
        )

    router = ModelRouter(
        project="test",
        location="global",
        primary_model="primary",
        fallback_model="fallback",
        classifier=classifier,
    )
    result = CaseProcessor(
        runtime.repository,
        runtime.blobs,
        router,
        pair_processor=pair_processor,
    ).process(case["case_id"])

    assert seen_attachments[0]["text"].startswith("SHIPPING INSTRUCTION")
    assert [document.filename for document in seen_pair] == [
        "email_001_SI.txt",
        "email_001_BL.txt",
    ]
    assert result["result"]["status"] == "MISMATCH"
    assert result["result"]["defect_fields"] == ["consignee"]


def test_hybrid_processor_skips_pair_extraction_for_non_comparison(runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "grader",
            "source_message_id": "email_002",
            "subject": "Schedule update",
            "body": "The vessel is delayed.",
        },
        [("notice.txt", "text/plain", b"Schedule notice")],
    )

    def classifier(model, subject, body, attachments):
        del model, subject, body, attachments
        return _classification(EmailCategory.GENERAL)

    def pair_processor(*_):
        raise AssertionError("pair extraction must not run")

    router = ModelRouter(
        project="test",
        location="global",
        primary_model="primary",
        fallback_model="fallback",
        classifier=classifier,
    )
    result = CaseProcessor(
        runtime.repository,
        runtime.blobs,
        router,
        pair_processor=pair_processor,
    ).process(case["case_id"])

    assert result["result"]["status"] == "OK"
