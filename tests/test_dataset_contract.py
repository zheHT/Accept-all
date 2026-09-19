import json
from pathlib import Path

from backend.core.schemas import GraderResult


def test_dataset_has_520_valid_grader_records():
    truth = json.loads(Path("data/ground_truth.json").read_text())
    assert len(truth) == 520
    for value in truth.values():
        GraderResult.model_validate(value)


def test_dataset_has_all_twenty_review_fixtures():
    truth = json.loads(Path("data/ground_truth.json").read_text())
    reasons = [
        value["review_reason"] for value in truth.values() if value["status"] == "NEEDS_REVIEW"
    ]
    assert len(reasons) == 20
    assert {reason: reasons.count(reason) for reason in set(reasons)} == {
        "wrong_doc_type": 5,
        "missing_attachment": 5,
        "unreadable": 5,
        "missing_value": 5,
    }
