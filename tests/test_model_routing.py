import pytest

from backend.core.inference import ModelRouter, ModelRoutingError
from backend.core.schemas import EmailCategory, ModelExtraction


def valid_result():
    return ModelExtraction(
        category=EmailCategory.GENERAL,
        confidence_score=0.9,
        rationale="General operational message",
    )


def test_primary_success_does_not_call_fallback():
    calls = []

    def generate(model, *_):
        calls.append(model)
        return valid_result()

    router = ModelRouter(
        project="p", location="global", primary_model="p1", fallback_model="p2", generator=generate
    )
    outcome = router.infer("subject", "body", [])
    assert outcome.model_used == "p1"
    assert calls == ["p1"]


def test_primary_failure_calls_fallback_once():
    calls = []

    def generate(model, *_):
        calls.append(model)
        if model == "p1":
            raise ValueError("invalid schema")
        return valid_result()

    router = ModelRouter(
        project="p", location="global", primary_model="p1", fallback_model="p2", generator=generate
    )
    outcome = router.infer("subject", "body", [])
    assert outcome.model_used == "p2"
    assert outcome.fallback_reason == "ValueError"
    assert calls == ["p1", "p2"]


def test_both_fail_without_looping():
    calls = []

    def generate(model, *_):
        calls.append(model)
        raise TimeoutError(model)

    router = ModelRouter(
        project="p", location="global", primary_model="p1", fallback_model="p2", generator=generate
    )
    with pytest.raises(ModelRoutingError):
        router.infer("subject", "body", [])
    assert calls == ["p1", "p2"]


def test_non_retryable_primary_failure_does_not_call_fallback():
    calls = []

    def generate(model, *_):
        calls.append(model)
        raise PermissionError(model)

    router = ModelRouter(
        project="p", location="global", primary_model="p1", fallback_model="p2", generator=generate
    )
    with pytest.raises(ModelRoutingError, match="fallback=not_attempted"):
        router.infer("subject", "body", [])
    assert calls == ["p1"]
