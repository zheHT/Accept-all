import json

import pytest

from backend.extraction.schemas import (
    ComparisonStatus,
    DocumentPairResult,
    ValidationResult,
)
from backend.models.schemas import EmailCategory, EmailClassification
from scripts.eval_inbox import (
    _classify_with_retry,
    _document_inputs,
    evaluate_inbox,
)


class FakeInbox:
    def __init__(self, emails, files):
        self._emails = emails
        self._files = files
        self.is_http = False

    def emails(self):
        return self._emails

    def read_bytes(self, path):
        return self._files[path]


class FakeClassifier:
    def __init__(self, result):
        self.result = result
        self.ids = []
        self.calls = []

    def __call__(self, *, email_id, **kwargs):
        self.ids.append(email_id)
        self.calls.append(kwargs)
        return self.result


class FakePairProcessor:
    def __init__(self, result):
        self.result = result
        self.calls = []

    async def __call__(self, si, bl):
        self.calls.append((si, bl))
        return self.result


def classification(category, *, candidate=False, missing=False):
    return EmailClassification(
        category=category,
        confidence=0.99,
        reasoning="Test classification.",
        is_comparison_candidate=candidate,
        missing_attachments_flag=missing,
    )


def pair_result(status=ComparisonStatus.OK, *, fields=None):
    return DocumentPairResult(
        validation=ValidationResult(
            status=status,
            has_defect=status == ComparisonStatus.MISMATCH,
            defect_fields=fields or [],
        )
    )


@pytest.mark.asyncio
async def test_comparison_candidate_uses_pair_validation_and_original_bytes(tmp_path):
    """Replacing the pair result with a placeholder must change this record."""
    output = tmp_path / "submission.json"
    email = {
        "email_id": "email_004",
        "from": "docs@example.com",
        "subject": "Please compare SI and draft BL",
        "body": "Attached for checking.",
        "attachments": ["attachments/email_004_SI.txt", "attachments/email_004_BL.txt"],
    }
    files = {
        "attachments/email_004_SI.txt": b"SHIPPING INSTRUCTION\nShipper: A",
        "attachments/email_004_BL.txt": b"BILL OF LADING (DRAFT)\nShipper: A",
    }
    classifier = FakeClassifier(
        classification(
            EmailCategory.DOCUMENT_COMPARISON, candidate=True, missing=True
        )
    )
    processor = FakePairProcessor(
        pair_result(
            ComparisonStatus.MISMATCH, fields=["consignee", "notify_party"]
        )
    )

    result = await evaluate_inbox(
        inbox=FakeInbox([email], files),
        output_file=output,
        classifier=classifier,
        pair_processor=processor,
        auto_submit=False,
    )

    assert result["email_004"] == {
        "category": "BL_COMPARISON",
        "status": "MISMATCH",
        "review_reason": None,
        "has_defect": True,
        "defect_fields": ["consignee", "notify_party"],
    }
    si, bl = processor.calls[0]
    assert si.data == files["attachments/email_004_SI.txt"]
    assert bl.data == files["attachments/email_004_BL.txt"]
    assert set(classifier.calls[0]["attachment_previews"]) == {
        "email_004_SI.txt",
        "email_004_BL.txt",
    }


@pytest.mark.asyncio
async def test_non_comparison_skips_pair_processor(tmp_path):
    """Routing a general message into extraction would be a wasted Gemini call."""
    email = {
        "email_id": "email_200",
        "from": "ops@example.com",
        "subject": "Vessel schedule",
        "body": "The vessel is delayed.",
        "attachments": [],
    }
    processor = FakePairProcessor(pair_result())

    result = await evaluate_inbox(
        inbox=FakeInbox([email], {}),
        output_file=tmp_path / "submission.json",
        classifier=FakeClassifier(classification(EmailCategory.GENERAL)),
        pair_processor=processor,
        auto_submit=False,
    )

    assert result["email_200"] == {
        "category": "GENERAL",
        "status": "OK",
        "review_reason": None,
        "has_defect": False,
        "defect_fields": [],
    }
    assert processor.calls == []


def test_document_inputs_route_case_insensitive_suffixes_and_allow_missing_role():
    """A role resolver that relies on exact case or invents a BL must fail here."""
    documents = [
        ("attachments/booking_Si.TxT", b"si"),
        ("attachments/draft_bL.PDF", b"bl"),
        ("attachments/other.txt", b"other"),
    ]

    si, bl = _document_inputs(documents)
    missing_si, missing_bl = _document_inputs([(documents[1][0], documents[1][1])])

    assert (si.filename, si.data) == ("booking_Si.TxT", b"si")
    assert (bl.filename, bl.data) == ("draft_bL.PDF", b"bl")
    assert missing_si is None
    assert missing_bl.data == b"bl"


@pytest.mark.asyncio
async def test_candidate_with_a_missing_role_passes_none_to_pair_processor(tmp_path):
    """Paired-document data must not be substituted for an absent role."""
    email = {
        "email_id": "email_201",
        "from": "docs@example.com",
        "subject": "Compare",
        "body": "Compare attached SI.",
        "attachments": ["attachments/email_201_SI.txt"],
    }
    processor = FakePairProcessor(pair_result(ComparisonStatus.NEEDS_REVIEW))

    await evaluate_inbox(
        inbox=FakeInbox([email], {"attachments/email_201_SI.txt": b"si"}),
        output_file=tmp_path / "submission.json",
        classifier=FakeClassifier(
            classification(EmailCategory.DOCUMENT_COMPARISON, candidate=True)
        ),
        pair_processor=processor,
        auto_submit=False,
    )

    assert processor.calls[0][0].data == b"si"
    assert processor.calls[0][1] is None


@pytest.mark.asyncio
async def test_checkpoint_is_valid_after_each_completed_email(tmp_path):
    """Writing only after the whole batch would lose progress when interrupted."""
    output = tmp_path / "submission.json"
    emails = [
        {"email_id": "email_001", "from": "ops", "subject": "One", "body": "One"},
        {"email_id": "email_002", "from": "ops", "subject": "Two", "body": "Two"},
    ]

    class CheckpointClassifier(FakeClassifier):
        def __call__(self, *, email_id, **kwargs):
            if self.ids:
                assert json.loads(output.read_text(encoding="utf-8")) == {
                    "email_001": {
                        "category": "GENERAL",
                        "status": "OK",
                        "review_reason": None,
                        "has_defect": False,
                        "defect_fields": [],
                    }
                }
            return super().__call__(email_id=email_id, **kwargs)

    await evaluate_inbox(
        inbox=FakeInbox(emails, {}),
        output_file=output,
        classifier=CheckpointClassifier(classification(EmailCategory.GENERAL)),
        pair_processor=FakePairProcessor(pair_result()),
        auto_submit=False,
    )

    assert set(json.loads(output.read_text(encoding="utf-8"))) == {"email_001", "email_002"}


@pytest.mark.asyncio
async def test_resume_skips_completed_records_after_max_selection(tmp_path):
    """Applying max after resume would accidentally include a later email."""
    output = tmp_path / "submission.json"
    neutral_general = {
        "category": "GENERAL",
        "status": "OK",
        "review_reason": None,
        "has_defect": False,
        "defect_fields": [],
    }
    emails = [
        {"email_id": email_id, "from": "ops", "subject": "Update", "body": "Update"}
        for email_id in ("email_001", "email_002", "email_003")
    ]
    output.write_text(json.dumps({"email_001": neutral_general}), encoding="utf-8")
    classifier = FakeClassifier(classification(EmailCategory.GENERAL))

    result = await evaluate_inbox(
        inbox=FakeInbox(emails, {}),
        output_file=output,
        max_emails=2,
        resume=True,
        classifier=classifier,
        pair_processor=FakePairProcessor(pair_result()),
        auto_submit=False,
    )

    assert classifier.ids == ["email_002"]
    assert set(result) == {"email_001", "email_002"}


@pytest.mark.asyncio
async def test_terminal_classifier_error_preserves_completed_checkpoint(tmp_path):
    """Converting an auth error into an OK record would hide an incomplete batch."""
    output = tmp_path / "submission.json"
    emails = [
        {"email_id": "email_001", "from": "ops", "subject": "One", "body": "One"},
        {"email_id": "email_002", "from": "ops", "subject": "Two", "body": "Two"},
    ]

    class FailingClassifier:
        def __init__(self):
            self.calls = 0

        def __call__(self, **kwargs):
            self.calls += 1
            if self.calls == 2:
                error = RuntimeError("unauthorized")
                error.status_code = 401
                raise error
            return classification(EmailCategory.GENERAL)

    with pytest.raises(RuntimeError, match="unauthorized"):
        await evaluate_inbox(
            inbox=FakeInbox(emails, {}),
            output_file=output,
            classifier=FailingClassifier(),
            pair_processor=FakePairProcessor(pair_result()),
            auto_submit=False,
        )

    assert json.loads(output.read_text(encoding="utf-8")) == {
        "email_001": {
            "category": "GENERAL",
            "status": "OK",
            "review_reason": None,
            "has_defect": False,
            "defect_fields": [],
        }
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("category", "expected"),
    [
        (EmailCategory.DOCUMENT_COMPARISON, "BL_COMPARISON"),
        (EmailCategory.NEW_SI_REQUEST, "SI_REQUEST"),
        (EmailCategory.INVOICE_QUERY, "INVOICE_QUERY"),
        (EmailCategory.GENERAL, "GENERAL"),
        (EmailCategory.SPAM, "SPAM"),
    ],
)
async def test_categories_always_use_organizer_values(tmp_path, category, expected):
    """HTTP mode must not be required to emit scorer category names."""
    result = await evaluate_inbox(
        inbox=FakeInbox(
            [{"email_id": "email_300", "from": "ops", "subject": "x", "body": "x"}],
            {},
        ),
        output_file=tmp_path / "submission.json",
        classifier=FakeClassifier(classification(category)),
        pair_processor=FakePairProcessor(pair_result()),
        auto_submit=False,
    )

    assert result["email_300"]["category"] == expected


def test_retry_retries_only_transient_classifier_errors():
    """A 429 should retry, while auth errors must reach the caller immediately."""
    sleeps = []
    attempts = 0

    def transient(**kwargs):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            error = RuntimeError("busy")
            error.code = 429
            raise error
        return "classified"

    assert _classify_with_retry(transient, sleep=sleeps.append) == "classified"
    assert attempts == 3
    assert sleeps == [1, 2]

    auth_attempts = 0

    def unauthorized(**kwargs):
        nonlocal auth_attempts
        auth_attempts += 1
        error = RuntimeError("unauthorized")
        error.status_code = 401
        raise error

    with pytest.raises(RuntimeError, match="unauthorized"):
        _classify_with_retry(unauthorized, sleep=sleeps.append)
    assert auth_attempts == 1
