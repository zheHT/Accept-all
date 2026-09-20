from types import SimpleNamespace
from pathlib import Path

import httpx
import pytest

import backend.extraction.extractor_flow as extractor_flow
from backend.extraction.extractor_flow import (
    DocumentExtractionError,
    GeminiServiceError,
    extract_document,
)
from backend.extraction.schemas import ExtractedDocument, PreparedDocument


class FakeApiError(Exception):
    def __init__(self, code: int):
        super().__init__(f"HTTP {code}")
        self.code = code


class FakeResponse:
    def __init__(self, *, parsed=None, text=""):
        self.parsed = parsed
        self.text = text


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.requests = []

    async def generate_content(self, **request):
        self.requests.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, outcomes):
        self.aio = SimpleNamespace(models=FakeModels(outcomes))


class OwnedFakeClient(FakeClient):
    def __init__(self, outcomes, *, async_close_error=None):
        super().__init__(outcomes)
        self.async_close_error = async_close_error
        self.async_close_calls = 0
        self.close_calls = 0
        self.aio.aclose = self.aclose

    async def aclose(self):
        self.async_close_calls += 1
        if self.async_close_error:
            raise self.async_close_error

    def close(self):
        self.close_calls += 1


@pytest.fixture
def valid_document() -> ExtractedDocument:
    return ExtractedDocument(
        shipper="APRIL FAR EAST (M) SDN BHD",
        consignee="MOORIM SP CO., LTD",
        notify_party="UAB NOVAKOPA",
        port_of_loading="PORT KLANG (WESTPORT), MALAYSIA",
        port_of_discharge="CALLAO, PERU",
        container_count=1,
        gross_weight_kg=21577,
    )


def text_document() -> PreparedDocument:
    return PreparedDocument(
        "email_001_SI.txt",
        "text/plain",
        text="SHIPPING INSTRUCTION\nShipper: APRIL FAR EAST",
    )


async def no_sleep(_delay: float) -> None:
    return None


@pytest.mark.asyncio
async def test_text_uses_only_prepared_text_and_parses_structured_json(valid_document):
    fake_client = FakeClient([FakeResponse(text=valid_document.model_dump_json())])

    result = await extract_document(
        text_document(), client=fake_client, sleep=no_sleep
    )

    request = fake_client.aio.models.requests[0]
    assert result == valid_document
    assert request["contents"] == ["SHIPPING INSTRUCTION\nShipper: APRIL FAR EAST"]
    assert "email_001" not in str(request["contents"])


@pytest.mark.asyncio
async def test_pdf_uses_original_bytes_and_no_email_context(valid_document):
    pdf = PreparedDocument("email_517_SI.pdf", "application/pdf", data=b"%PDF-valid")
    fake_client = FakeClient([FakeResponse(parsed=valid_document)])

    result = await extract_document(pdf, client=fake_client, sleep=no_sleep)

    request = fake_client.aio.models.requests[0]
    assert result == valid_document
    part = request["contents"][0]
    assert part.inline_data.data == b"%PDF-valid"
    assert "CALLAO_PERU" not in str(request["contents"])
    assert "email_517" not in str(request["contents"])


@pytest.mark.asyncio
async def test_transient_429_is_retried_at_most_three_times(valid_document):
    fake_client = FakeClient([FakeApiError(429), FakeResponse(parsed=valid_document)])

    result = await extract_document(text_document(), client=fake_client, sleep=no_sleep)

    assert result == valid_document
    assert len(fake_client.aio.models.requests) == 2


@pytest.mark.asyncio
async def test_invalid_structured_response_is_a_document_extraction_error():
    fake_client = FakeClient([FakeResponse(text='{"shipper": "A"}')])

    with pytest.raises(DocumentExtractionError):
        await extract_document(text_document(), client=fake_client, sleep=no_sleep)


@pytest.mark.asyncio
async def test_401_is_not_retried_and_is_a_service_error():
    fake_client = FakeClient([FakeApiError(401)])

    with pytest.raises(GeminiServiceError):
        await extract_document(text_document(), client=fake_client, sleep=no_sleep)

    assert len(fake_client.aio.models.requests) == 1


@pytest.mark.asyncio
async def test_three_consecutive_500_responses_raise_service_error():
    fake_client = FakeClient([FakeApiError(500), FakeApiError(500), FakeApiError(500)])

    with pytest.raises(GeminiServiceError):
        await extract_document(text_document(), client=fake_client, sleep=no_sleep)

    assert len(fake_client.aio.models.requests) == 3


@pytest.mark.asyncio
async def test_sdk_timeout_is_retried_before_a_successful_response(valid_document):
    fake_client = FakeClient(
        [httpx.ReadTimeout("timed out"), FakeResponse(parsed=valid_document)]
    )

    result = await extract_document(text_document(), client=fake_client, sleep=no_sleep)

    assert result == valid_document
    assert len(fake_client.aio.models.requests) == 2


@pytest.mark.asyncio
async def test_connection_failure_is_a_service_error():
    fake_client = FakeClient([httpx.ConnectError("connection failed")])

    with pytest.raises(GeminiServiceError):
        await extract_document(text_document(), client=fake_client, sleep=no_sleep)


@pytest.mark.asyncio
async def test_owned_client_is_closed_and_request_uses_runtime_contract(
    monkeypatch, valid_document
):
    owned_client = OwnedFakeClient([FakeResponse(parsed=valid_document)])
    monkeypatch.setattr(extractor_flow.genai, "Client", lambda: owned_client)

    result = await extract_document(text_document(), sleep=no_sleep)

    request = owned_client.aio.models.requests[0]
    config = request["config"]
    instruction = (
        Path(__file__).resolve().parents[1] / "backend" / "skills" / "extractor.md"
    ).read_text(encoding="utf-8")
    assert result == valid_document
    assert owned_client.async_close_calls == 1
    assert owned_client.close_calls == 1
    assert request["model"] == "gemini-2.5-flash"
    assert config.temperature == 0.0
    assert config.response_mime_type == "application/json"
    assert config.response_schema is ExtractedDocument
    assert config.system_instruction == instruction


@pytest.mark.asyncio
async def test_owned_client_sync_close_runs_after_async_close_failure(
    monkeypatch, valid_document
):
    owned_client = OwnedFakeClient(
        [FakeResponse(parsed=valid_document)],
        async_close_error=RuntimeError("async close failed"),
    )
    monkeypatch.setattr(extractor_flow.genai, "Client", lambda: owned_client)

    with pytest.raises(RuntimeError, match="async close failed"):
        await extract_document(text_document(), sleep=no_sleep)

    assert owned_client.async_close_calls == 1
    assert owned_client.close_calls == 1


@pytest.mark.asyncio
async def test_injected_client_is_not_closed_by_extractor(valid_document):
    client = OwnedFakeClient([FakeResponse(parsed=valid_document)])

    result = await extract_document(text_document(), client=client, sleep=no_sleep)

    assert result == valid_document
    assert client.async_close_calls == 0
    assert client.close_calls == 0
