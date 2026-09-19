from types import SimpleNamespace

import httpx
import pytest

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
