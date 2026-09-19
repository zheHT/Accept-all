# Pillar 3 Document Extraction MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the independent Pillar 3 extraction/comparison package and connect it to Pillar 2 through a restartable scorer-compatible batch evaluator.

**Architecture:** Pillar 3 prepares attachment previews before Pillar 2 classifies email intent. Only comparison candidates proceed to two isolated Gemini extraction calls followed by deterministic Python validation; the evaluator checkpoints every completed email and never converts infrastructure failures into document findings.

**Tech Stack:** Python 3.11+, Pydantic 2, Google Gen AI SDK, MarkItDown with DOCX/XLSX extras, pypdf, pytest, pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-09-19-pillar-3-document-extraction-design.md`

## Global Constraints

- Preserve Pillar 2 behavior except for shared model configuration, preview preparation, and scanned/missing attachment semantics required by the integration.
- `ExtractedDocument` has exactly seven required nullable fields and `ConfigDict(extra="forbid")`.
- SI and BL are extracted in separate Gemini requests; neither request receives email content, filename evidence, nor the paired document.
- Python alone assigns comparison status, review reason, defect flag, and defect fields.
- Review precedence is `missing_attachment`, `unreadable`, `wrong_doc_type`, `missing_value`, then comparison.
- TXT uses Python decoding; DOCX/XLSX use `markitdown[docx,xlsx]`; PDF uses pypdf validation and original bytes.
- Structurally valid scanned PDFs reach Gemini and are never rejected for lacking a text layer.
- Use one `GEMINI_MODEL` setting with `gemini-2.5-flash` as the MVP default.
- Automated tests never call the real Gemini API.
- Batch execution is sequential, retries transient API failures at most three times, checkpoints after every email, and supports `--resume`.
- Do not add FastAPI document routes, frontend work, persistence, deployment code, OCR, arbitrary attachment-role inference, LangChain, LangGraph, or vector storage.
- Do not commit organizer data, credentials, submissions, checkpoints, or live API responses.

## Review Focus

- A port name mismatch with the same parenthetical code must remain a mismatch; Task 3 pins prompt isolation/normalization and Task 1 pins deterministic comparison.
- A structurally valid image-only PDF must reach the extractor; Task 2 tests byte preservation and Task 4 tests extractor invocation.
- A file named `_BL` whose heading says `COMMERCIAL INVOICE` must produce `wrong_doc_type`, not `missing_value`; Tasks 2 and 4 test this precedence.
- A crash after N emails must leave valid JSON containing exactly those N completed records; Task 6 tests atomic checkpoint recovery and resume.
- An HTTP 429 followed by success must retry, while authentication/schema failure must stop immediately without a fabricated review result; Tasks 3 and 6 test both paths.

---

### Task 1: Lock the Extraction Schemas and Deterministic Validator

**Files:**
- Create: `backend/extraction/__init__.py`
- Modify: `backend/extraction/schemas.py`
- Modify: `backend/extraction/validator.py`
- Create: `tests/test_extraction_schemas.py`
- Create: `tests/test_extraction_validator.py`
- Delete: `backend/tests/test_validator.py`

**Interfaces:**
- Consumes: Pydantic 2 and Python 3.11 `StrEnum`.
- Produces: `DocumentInput`, `PreparedDocument`, `DocumentKind`, `ExtractedDocument`, `ComparisonStatus`, `ReviewReason`, `ValidationResult`, `DocumentPairResult`, `needs_review(reason)`, and `validate_documents(si, bl)`.

- [ ] **Step 1: Write schema tests that enforce the exact contract**

```python
from pydantic import ValidationError
import pytest

from backend.extraction.schemas import ExtractedDocument


VALID = {
    "shipper": "APRIL FAR EAST (M) SDN BHD",
    "consignee": "MOORIM SP CO., LTD",
    "notify_party": "UAB NOVAKOPA",
    "port_of_loading": "PORT KLANG (WESTPORT), MALAYSIA",
    "port_of_discharge": "CALLAO, PERU",
    "container_count": 1,
    "gross_weight_kg": 21577,
}


def test_extracted_document_has_exact_required_nullable_fields():
    assert set(ExtractedDocument.model_fields) == set(VALID)
    assert ExtractedDocument(**{**VALID, "shipper": None}).shipper is None


def test_extracted_document_rejects_missing_and_extra_keys():
    with pytest.raises(ValidationError):
        ExtractedDocument(**{key: value for key, value in VALID.items() if key != "shipper"})
    with pytest.raises(ValidationError):
        ExtractedDocument(**VALID, booking_number="BKG-1")
```

- [ ] **Step 2: Run the schema tests and confirm they fail against the incomplete package**

Run: `python -m pytest tests/test_extraction_schemas.py -q`

Expected: collection or import failure because `backend.extraction` is not yet an importable public package.

- [ ] **Step 3: Implement the final schema module and public exports**

Keep `ExtractedDocument` exactly as shown above. Define these remaining contracts:

```python
from dataclasses import dataclass
from enum import StrEnum
from pydantic import BaseModel, ConfigDict


class ComparisonStatus(StrEnum):
    OK = "OK"
    MISMATCH = "MISMATCH"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class ReviewReason(StrEnum):
    WRONG_DOC_TYPE = "wrong_doc_type"
    MISSING_ATTACHMENT = "missing_attachment"
    UNREADABLE = "unreadable"
    MISSING_VALUE = "missing_value"


class DocumentKind(StrEnum):
    SI = "SI"
    BL = "BL"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class ValidationResult(BaseModel):
    status: ComparisonStatus
    has_defect: bool
    defect_fields: list[str]
    review_reason: ReviewReason | None = None


class DocumentPairResult(BaseModel):
    si: ExtractedDocument | None = None
    bl: ExtractedDocument | None = None
    validation: ValidationResult


@dataclass(frozen=True)
class DocumentInput:
    filename: str
    data: bytes
    mime_type: str | None = None


@dataclass(frozen=True)
class PreparedDocument:
    filename: str
    mime_type: str
    text: str | None = None
    data: bytes | None = None
```

Make `backend/extraction/__init__.py` importable before the service exists:

```python
from backend.extraction.schemas import DocumentInput, DocumentPairResult

__all__ = ["DocumentInput", "DocumentPairResult"]
```

Task 4 adds `process_document_pair` to this public surface after the service module exists.

- [ ] **Step 4: Write validator tests for all seven fields, stable ordering, missing values, and conservative normalization**

```python
BASE = {
    "shipper": "APRIL FAR EAST (M) SDN BHD",
    "consignee": "MOORIM SP CO., LTD",
    "notify_party": "UAB NOVAKOPA",
    "port_of_loading": "PORT KLANG (WESTPORT), MALAYSIA",
    "port_of_discharge": "CALLAO, PERU",
    "container_count": 1,
    "gross_weight_kg": 21577,
}


def document(**overrides) -> ExtractedDocument:
    return ExtractedDocument(**{**BASE, **overrides})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("shipper", "OTHER SHIPPER"),
        ("consignee", "OTHER CONSIGNEE"),
        ("notify_party", "OTHER NOTIFY"),
        ("port_of_loading", "SINGAPORE"),
        ("port_of_discharge", "TUTICORIN, INDIA"),
        ("container_count", 2),
        ("gross_weight_kg", 21578),
    ],
)
def test_each_field_is_reported_as_a_mismatch(field, value):
    si = document()
    bl = document(**{field: value})
    result = validate_documents(si, bl)
    assert result.status == ComparisonStatus.MISMATCH
    assert result.has_defect is True
    assert result.defect_fields == [field]


def test_same_port_code_does_not_hide_different_port_names():
    result = validate_documents(
        document(port_of_discharge="MOMBASA, KENYA"),
        document(port_of_discharge="TUTICORIN, INDIA"),
    )
    assert result.defect_fields == ["port_of_discharge"]


def test_any_null_field_requires_review_before_comparison():
    result = validate_documents(document(port_of_discharge=None), document())
    assert result == ValidationResult(
        status=ComparisonStatus.NEEDS_REVIEW,
        has_defect=False,
        defect_fields=[],
        review_reason=ReviewReason.MISSING_VALUE,
    )
```

Also retain tests for an exact match, multiple differences in `FIELDS` order, and case/repeated-whitespace equivalence.

- [ ] **Step 5: Run validator tests and confirm the existing implementation's imports fail from the repository root**

Run: `python -m pytest tests/test_extraction_validator.py -q`

Expected: FAIL until imports change from `extraction.*` to `backend.extraction.*`.

- [ ] **Step 6: Implement the minimal deterministic validator**

```python
FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)


def needs_review(reason: ReviewReason) -> ValidationResult:
    return ValidationResult(
        status=ComparisonStatus.NEEDS_REVIEW,
        has_defect=False,
        defect_fields=[],
        review_reason=reason,
    )


def _normalize(value: object) -> object:
    return " ".join(value.split()).casefold() if isinstance(value, str) else value


def validate_documents(si: ExtractedDocument, bl: ExtractedDocument) -> ValidationResult:
    if any(getattr(document, field) is None for document in (si, bl) for field in FIELDS):
        return needs_review(ReviewReason.MISSING_VALUE)

    defects = [
        field
        for field in FIELDS
        if _normalize(getattr(si, field)) != _normalize(getattr(bl, field))
    ]
    if defects:
        return ValidationResult(
            status=ComparisonStatus.MISMATCH,
            has_defect=True,
            defect_fields=defects,
        )
    return ValidationResult(
        status=ComparisonStatus.OK,
        has_defect=False,
        defect_fields=[],
    )
```

- [ ] **Step 7: Run the focused tests**

Run: `python -m pytest tests/test_extraction_schemas.py tests/test_extraction_validator.py -q`

Expected: PASS.

- [ ] **Step 8: Commit the schema and validator slice**

```bash
git add backend/extraction/__init__.py backend/extraction/schemas.py backend/extraction/validator.py tests/test_extraction_schemas.py tests/test_extraction_validator.py
git commit -m "feat: define extraction contracts and validator"
```

### Task 2: Replace Custom Office Parsing with MarkItDown and Add Safe Preflight

**Files:**
- Modify: `backend/extraction/document_reader.py`
- Modify: `backend/requirements.txt`
- Modify: `.env.example`
- Create: `tests/test_document_reader.py`

**Interfaces:**
- Consumes: `DocumentInput`, `PreparedDocument`, and `DocumentKind` from Task 1.
- Produces: `prepare_document(document)`, `detect_document_kind(document)`, `DocumentReadError`, `UnsupportedDocumentError`, and `UnreadableDocumentError`.

- [ ] **Step 1: Normalize the backend dependency file**

Replace the duplicated file with this single set:

```text
fastapi
uvicorn[standard]
python-multipart
google-genai
pydantic>=2,<3
python-dotenv
markitdown[docx,xlsx]>=0.1.6,<0.2
pypdf
pytest
pytest-asyncio
httpx
```

Add the shared model setting to `.env.example`:

```text
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

- [ ] **Step 2: Write reader tests using temporary TXT, DOCX, XLSX, and PDF bytes**

```python
def test_txt_is_decoded_to_text():
    prepared = prepare_document(DocumentInput("si.txt", b"SHIPPING INSTRUCTION\nShipper: A"))
    assert prepared.text.startswith("SHIPPING INSTRUCTION")
    assert prepared.data is None


def test_valid_pdf_keeps_original_bytes(valid_pdf_bytes):
    prepared = prepare_document(DocumentInput("si.pdf", valid_pdf_bytes))
    assert prepared.mime_type == "application/pdf"
    assert prepared.data == valid_pdf_bytes
    assert prepared.text is None


def test_image_only_pdf_is_not_rejected(image_only_pdf_bytes):
    prepared = prepare_document(DocumentInput("scan.pdf", image_only_pdf_bytes))
    assert prepared.data == image_only_pdf_bytes


def test_corrupt_pdf_is_unreadable():
    with pytest.raises(UnreadableDocumentError):
        prepare_document(DocumentInput("broken.pdf", b"%PDF corrupt"))
```

Generate DOCX and XLSX fixtures in memory with `python-docx` and `openpyxl`, which are installed by the selected MarkItDown extras. Assert that the resulting Markdown contains the document heading and all seven field labels.

```python
def docx_bytes() -> bytes:
    stream = BytesIO()
    document = Document()
    document.add_heading("BILL OF LADING (DRAFT)", level=1)
    document.add_paragraph("Shipper: APRIL FAR EAST")
    document.save(stream)
    return stream.getvalue()


def xlsx_bytes() -> bytes:
    stream = BytesIO()
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["SHIPPING INSTRUCTION"])
    sheet.append(["Shipper", "APRIL FAR EAST"])
    workbook.save(stream)
    return stream.getvalue()


def blank_pdf_bytes() -> bytes:
    stream = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(stream)
    return stream.getvalue()
```

- [ ] **Step 3: Run the reader tests and confirm direct-parser behavior or missing MarkItDown support fails**

Run: `python -m pytest tests/test_document_reader.py -q`

Expected: FAIL because the existing reader uses custom `python-docx`/`openpyxl` parsing and incomplete exception normalization.

- [ ] **Step 4: Implement extension-specific preparation**

```python
from io import BytesIO
from pathlib import Path

from markitdown import MarkItDown, StreamInfo
from pypdf import PdfReader
from pypdf.errors import PdfReadError


def prepare_document(document: DocumentInput) -> PreparedDocument:
    extension = Path(document.filename).suffix.casefold()
    if extension == ".txt":
        return PreparedDocument(document.filename, "text/plain", text=_decode_text(document.data))
    if extension in {".docx", ".xlsx"}:
        return PreparedDocument(
            document.filename,
            "text/plain",
            text=_convert_office(document.data, document.filename, extension),
        )
    if extension == ".pdf":
        _validate_pdf(document.data)
        return PreparedDocument(document.filename, "application/pdf", data=document.data)
    raise UnsupportedDocumentError(f"Unsupported document type: {extension or '<none>'}")


def _convert_office(data: bytes, filename: str, extension: str) -> str:
    try:
        result = MarkItDown(enable_plugins=False).convert_stream(
            BytesIO(data),
            stream_info=StreamInfo(extension=extension, filename=filename),
        )
        text = result.markdown.strip()
    except Exception as exc:
        raise UnreadableDocumentError(f"Unable to read {extension[1:].upper()} document.") from exc
    if not text:
        raise UnreadableDocumentError(f"Empty {extension[1:].upper()} document.")
    return text
```

`_validate_pdf` must instantiate `PdfReader(BytesIO(data), strict=False)`, reject encryption and zero pages, and normalize `PdfReadError`, `EOFError`, `ValueError`, and `OSError` into `UnreadableDocumentError`. It must not call `extract_text()`.

- [ ] **Step 5: Add heading-based document-kind tests and implementation**

```python
def test_wrong_document_title_is_detected():
    prepared = PreparedDocument("claimed_bl.txt", "text/plain", text="COMMERCIAL INVOICE\nInvoice No: 1")
    assert detect_document_kind(prepared) == DocumentKind.OTHER


def test_incidental_invoice_reference_does_not_reject_si():
    prepared = PreparedDocument(
        "si.txt",
        "text/plain",
        text="SHIPPING INSTRUCTION\nDocuments required: COMMERCIAL INVOICE",
    )
    assert detect_document_kind(prepared) == DocumentKind.SI
```

Implement title detection from the first non-empty Markdown line. Match exact normalized title prefixes for SI, BL, and known wrong documents; return `UNKNOWN` for PDFs and ambiguous headings.

- [ ] **Step 6: Run reader tests**

Run: `python -m pytest tests/test_document_reader.py -q`

Expected: PASS.

- [ ] **Step 7: Commit the reader slice**

```bash
git add backend/extraction/document_reader.py backend/requirements.txt .env.example tests/test_document_reader.py
git commit -m "feat: prepare shipping documents safely"
```

### Task 3: Implement the Isolated Gemini Extractor and Runtime Prompt

**Files:**
- Create: `backend/skills/extractor.md`
- Create: `backend/extraction/extractor_flow.py`
- Create: `tests/test_extractor_flow.py`

**Interfaces:**
- Consumes: `PreparedDocument` and `ExtractedDocument` from Task 1.
- Produces: `extract_document(document, *, client=None, sleep=asyncio.sleep)`, `DocumentExtractionError`, and `GeminiServiceError`.

- [ ] **Step 1: Write the runtime extraction instruction**

The complete prompt must state:

```text
You extract exactly seven normalized fields from ONE shipping document.

SOURCE ISOLATION
Use only information visibly present in this document. Never use an email,
filename, paired document, booking context, or external knowledge. Never infer
a missing value. Return null for blank, N/A, TBA, ???, placeholder underscores,
illegible text, or conflicting ambiguous values.

PARTIES
Return only the company name for shipper, consignee, and notify_party. Treat
"To the Order of" as consignee. Do not include postal addresses.

PORTS
Return the printed textual port name without a trailing parenthetical location
code. Never correct the printed name from the code.

NUMBERS
Return total container count as an integer. Convert MT/MTS to kilograms and
remove thousands separators from kilogram values.

Return all seven required keys and no additional keys.
```

Include the observed label aliases from the approved design under their canonical fields.

- [ ] **Step 2: Write fake-client tests for text, PDF, schema parsing, isolation, and retry behavior**

Define the SDK error and response fakes in the test file so no real client is created:

```python
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
```

Inspect `fake_client.aio.models.requests` directly. For PDF assertions, inspect the one `types.Part` passed in `contents` and assert its inline byte data equals the fixture bytes.

```python
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
```

Also test that a 401 is not retried and raises `GeminiServiceError`, and that three consecutive 500 responses raise `GeminiServiceError` after exactly three calls.

- [ ] **Step 3: Run the extractor tests and confirm the module is absent**

Run: `python -m pytest tests/test_extractor_flow.py -q`

Expected: FAIL with an import error for `backend.extraction.extractor_flow`.

- [ ] **Step 4: Implement request construction and structured parsing**

```python
MODEL_ENV = "GEMINI_MODEL"
DEFAULT_MODEL = "gemini-2.5-flash"


async def extract_document(
    document: PreparedDocument,
    *,
    client=None,
    sleep=asyncio.sleep,
) -> ExtractedDocument:
    owned_client = client is None
    active_client = client or genai.Client()
    try:
        for attempt in range(3):
            try:
                response = await active_client.aio.models.generate_content(
                    model=os.getenv(MODEL_ENV, DEFAULT_MODEL),
                    contents=_contents(document),
                    config=types.GenerateContentConfig(
                        system_instruction=_load_system_instruction(),
                        temperature=0.0,
                        response_mime_type="application/json",
                        response_schema=ExtractedDocument,
                    ),
                )
                parsed = response.parsed
                if isinstance(parsed, ExtractedDocument):
                    return parsed
                return ExtractedDocument.model_validate_json(response.text)
            except Exception as exc:
                if _is_transient(exc) and attempt < 2:
                    await sleep(2 ** attempt)
                    continue
                if _is_sdk_failure(exc):
                    raise GeminiServiceError(str(exc)) from exc
                raise DocumentExtractionError("Gemini returned invalid document data.") from exc
    finally:
        if owned_client:
            await active_client.aio.aclose()
            active_client.close()
```

`_contents` returns the prepared text for text documents or a single `types.Part.from_bytes` for PDFs. It never inserts `document.filename`. `_load_system_instruction` resolves `backend/skills/extractor.md` relative to the module, not the current working directory.

`_is_transient` recognizes `TimeoutError`, status/code 429, and status/code 500–599. `_is_sdk_failure` recognizes SDK/API exceptions and connection failures so they propagate as infrastructure errors rather than `unreadable`.

- [ ] **Step 5: Run extractor tests**

Run: `python -m pytest tests/test_extractor_flow.py -q`

Expected: PASS with no network calls.

- [ ] **Step 6: Commit the extractor slice**

```bash
git add backend/skills/extractor.md backend/extraction/extractor_flow.py tests/test_extractor_flow.py
git commit -m "feat: extract one shipping document with Gemini"
```

### Task 4: Implement Pair Orchestration and Review Precedence

**Files:**
- Create: `backend/extraction/service.py`
- Modify: `backend/extraction/__init__.py`
- Create: `tests/test_extraction_service.py`

**Interfaces:**
- Consumes: `prepare_document`, `detect_document_kind`, `extract_document`, `needs_review`, and `validate_documents`.
- Produces: `process_document_pair(si_input, bl_input)` and internal `process_prepared_document_pair(si, bl, *, extractor=extract_document)`.

- [ ] **Step 1: Write service tests for every precedence branch**

```python
SI_TEXT = "SHIPPING INSTRUCTION\nShipper: APRIL FAR EAST"
BL_TEXT = "BILL OF LADING (DRAFT)\nShipper: APRIL FAR EAST"


def text_input(filename: str, text: str) -> DocumentInput:
    return DocumentInput(filename=filename, data=text.encode("utf-8"))


def document(**overrides) -> ExtractedDocument:
    values = {
        "shipper": "APRIL FAR EAST (M) SDN BHD",
        "consignee": "MOORIM SP CO., LTD",
        "notify_party": "UAB NOVAKOPA",
        "port_of_loading": "PORT KLANG (WESTPORT), MALAYSIA",
        "port_of_discharge": "CALLAO, PERU",
        "container_count": 1,
        "gross_weight_kg": 21577,
    }
    return ExtractedDocument(**{**values, **overrides})


@pytest.mark.asyncio
async def test_missing_attachment_wins_without_calling_extractor():
    extractor = AsyncMock()
    result = await process_document_pair(text_input("si.txt", SI_TEXT), None, extractor=extractor)
    assert result.validation.review_reason == ReviewReason.MISSING_ATTACHMENT
    extractor.assert_not_awaited()


@pytest.mark.asyncio
async def test_wrong_document_wins_before_missing_values():
    extractor = AsyncMock()
    result = await process_document_pair(
        text_input("si.txt", SI_TEXT),
        text_input("bl.txt", "COMMERCIAL INVOICE\nInvoice No: 1"),
        extractor=extractor,
    )
    assert result.validation.review_reason == ReviewReason.WRONG_DOC_TYPE
    extractor.assert_not_awaited()


@pytest.mark.asyncio
async def test_si_and_bl_are_extracted_in_separate_calls():
    extractor = AsyncMock(side_effect=[document(), document()])
    result = await process_document_pair(
        text_input("si.txt", SI_TEXT),
        text_input("bl.txt", BL_TEXT),
        extractor=extractor,
    )
    assert result.validation.status == ComparisonStatus.OK
    assert extractor.await_count == 2
    assert extractor.await_args_list[0].args[0].text.startswith("SHIPPING INSTRUCTION")
    assert extractor.await_args_list[1].args[0].text.startswith("BILL OF LADING")
```

Add tests for corrupt input → `unreadable`, null extraction → `missing_value`, mismatches → exact fields, scanned PDF → extractor called twice, and `GeminiServiceError` → propagated unchanged.

- [ ] **Step 2: Run service tests and confirm the service module is absent**

Run: `python -m pytest tests/test_extraction_service.py -q`

Expected: FAIL with an import error for `backend.extraction.service`.

- [ ] **Step 3: Implement ordered orchestration**

```python
async def process_document_pair(
    si_input: DocumentInput | None,
    bl_input: DocumentInput | None,
    *,
    extractor=extract_document,
) -> DocumentPairResult:
    if si_input is None or bl_input is None:
        return DocumentPairResult(validation=needs_review(ReviewReason.MISSING_ATTACHMENT))
    try:
        si = prepare_document(si_input)
        bl = prepare_document(bl_input)
    except (DocumentReadError, UnsupportedDocumentError):
        return DocumentPairResult(validation=needs_review(ReviewReason.UNREADABLE))
    return await process_prepared_document_pair(si, bl, extractor=extractor)


async def process_prepared_document_pair(
    si: PreparedDocument,
    bl: PreparedDocument,
    *,
    extractor=extract_document,
) -> DocumentPairResult:
    if _wrong_kind(si, DocumentKind.SI) or _wrong_kind(bl, DocumentKind.BL):
        return DocumentPairResult(validation=needs_review(ReviewReason.WRONG_DOC_TYPE))
    try:
        extracted_si = await extractor(si)
        extracted_bl = await extractor(bl)
    except DocumentExtractionError:
        return DocumentPairResult(validation=needs_review(ReviewReason.UNREADABLE))
    return DocumentPairResult(
        si=extracted_si,
        bl=extracted_bl,
        validation=validate_documents(extracted_si, extracted_bl),
    )
```

`_wrong_kind` rejects `OTHER` and the opposite known role, but lets `UNKNOWN` continue to Gemini. Do not catch `GeminiServiceError`.

Update the package public surface only after `service.py` exists:

```python
from backend.extraction.schemas import DocumentInput, DocumentPairResult
from backend.extraction.service import process_document_pair

__all__ = ["DocumentInput", "DocumentPairResult", "process_document_pair"]
```

- [ ] **Step 4: Run all Pillar 3 package tests**

Run: `python -m pytest tests/test_extraction_schemas.py tests/test_extraction_validator.py tests/test_document_reader.py tests/test_extractor_flow.py tests/test_extraction_service.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the service slice**

```bash
git add backend/extraction/__init__.py backend/extraction/service.py tests/test_extraction_service.py
git commit -m "feat: orchestrate independent document comparison"
```

### Task 5: Adapt Pillar 2 to Shared Model and Pillar 3 Previews

**Files:**
- Modify: `backend/agents/classifier_flow.py`
- Modify: `backend/utils/attachment_sniffer.py`
- Modify: `tests/test_classifier.py`
- Modify: `tests/test_classifier_flow.py`
- Modify: `tests/test_classifier_edge_cases.py`
- Modify: `tests/test_attachment_sniffer.py`

**Interfaces:**
- Consumes: `prepare_document(DocumentInput)` and `GEMINI_MODEL`.
- Produces: existing `classify_email(...)` behavior with missing-only attachment flags and an `inspect_attachment(...)` compatibility wrapper backed by Pillar 3.

- [ ] **Step 1: Change tests to express the integrated semantics**

```python
def test_scanned_pdf_marker_is_not_missing_attachment():
    assert _check_missing_attachments(
        EmailCategory.DOCUMENT_COMPARISON,
        {
            "si.pdf": "[PDF document: original bytes retained]",
            "bl.pdf": "[PDF document: original bytes retained]",
        },
    ) is False


def test_one_expected_attachment_is_missing():
    assert _check_missing_attachments(
        EmailCategory.DOCUMENT_COMPARISON,
        {"si.txt": "SHIPPING INSTRUCTION"},
    ) is True
```

Update the model-selection test to set `GEMINI_MODEL=gemini-test-flash` and assert the mocked SDK receives that value. Add an assertion that the per-call SDK client is closed after success or failure. Keep existing classification-category and body-over-subject tests.

- [ ] **Step 2: Run the focused Pillar 2 tests and confirm old scanned semantics fail**

Run: `python -m pytest tests/test_classifier.py tests/test_classifier_flow.py tests/test_classifier_edge_cases.py tests/test_attachment_sniffer.py -q`

Expected: at least the scanned/missing semantics and model environment test FAIL.

- [ ] **Step 3: Make the smallest classifier changes**

```python
def _check_missing_attachments(category, attachment_previews):
    if category != EmailCategory.DOCUMENT_COMPARISON:
        return False
    return len(attachment_previews or {}) < 2
```

Replace the hardcoded model argument with:

```python
model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
```

Remove the unused import-time cached client and `get_client()` path. Create the live client only inside `classify_email`, and close it in `finally` after the synchronous request. This retains the current injectable/mockable call boundary while avoiding one leaked connection pool per email.

Update stale Gemini 1.5 wording in the module docstring and messages. Do not rewrite classification rules or schemas.

- [ ] **Step 4: Replace the duplicate attachment parser with a compatibility wrapper**

```python
from backend.extraction.document_reader import DocumentReadError, prepare_document
from backend.extraction.schemas import DocumentInput

MAX_CHARS = 1000


def inspect_attachment(filename: str, content: bytes | str) -> str:
    data = content.encode() if isinstance(content, str) else content
    try:
        prepared = prepare_document(DocumentInput(filename=filename, data=data))
    except DocumentReadError:
        return "[Unreadable or Corrupted File]"
    if prepared.text is not None:
        return prepared.text[:MAX_CHARS].strip()
    return "[PDF document: original bytes retained]"
```

Catch `UnsupportedDocumentError` as a declared reader error if it is not already a subclass of `DocumentReadError`.

- [ ] **Step 5: Run Pillar 2 tests**

Run: `python -m pytest tests/test_classifier.py tests/test_classifier_flow.py tests/test_classifier_edge_cases.py tests/test_attachment_sniffer.py tests/test_schemas.py -q`

Expected: PASS without a live API call because existing classifier tests inject the fake client.

- [ ] **Step 6: Commit the integration-compatible classifier slice**

```bash
git add backend/agents/classifier_flow.py backend/utils/attachment_sniffer.py tests/test_classifier.py tests/test_classifier_flow.py tests/test_classifier_edge_cases.py tests/test_attachment_sniffer.py
git commit -m "fix: align classifier with extraction pipeline"
```

### Task 6: Replace Placeholder Evaluation with the Restartable End-to-End Pipeline

**Files:**
- Modify: `scripts/eval_inbox.py`
- Create: `tests/test_eval_inbox.py`

**Interfaces:**
- Consumes: `Inbox`, `classify_email`, `DocumentInput`, `prepare_document`, `process_document_pair`, `EmailCategory`, and `SubmissionItem`.
- Produces: async `evaluate_inbox(...)`, atomic `_write_checkpoint(...)`, role resolver `_document_inputs(...)`, and CLI flags `--source`, `--output`, `--max`, `--resume`, and `--no-submit`.

- [ ] **Step 1: Write evaluator tests with fake inbox, classifier, and pair processor**

Define small call-recording fakes in the test file:

```python
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

    def __call__(self, *, email_id, **kwargs):
        self.ids.append(email_id)
        return self.result


class FakePairProcessor:
    def __init__(self, result):
        self.result = result
        self.calls = []

    async def __call__(self, si, bl):
        self.calls.append((si, bl))
        return self.result
```

```python
@pytest.mark.asyncio
async def test_comparison_candidate_uses_real_validation_result(tmp_path):
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
        EmailClassification(
            category=EmailCategory.DOCUMENT_COMPARISON,
            confidence=0.99,
            reasoning="The email asks for an SI and BL comparison.",
            is_comparison_candidate=True,
            missing_attachments_flag=False,
            detected_attachments=list(files),
        )
    )
    processor = FakePairProcessor(
        DocumentPairResult(
            validation=ValidationResult(
                status=ComparisonStatus.MISMATCH,
                has_defect=True,
                defect_fields=["consignee", "notify_party"],
            )
        )
    )
    result = await evaluate_inbox(
        inbox=FakeInbox([email], files),
        output_file=output,
        classifier=classifier,
        pair_processor=processor,
    )
    assert result["email_004"] == {
        "category": "BL_COMPARISON",
        "status": "MISMATCH",
        "review_reason": None,
        "has_defect": True,
        "defect_fields": ["consignee", "notify_party"],
    }


@pytest.mark.asyncio
async def test_non_comparison_skips_pair_processor(tmp_path):
    email = {
        "email_id": "email_200",
        "from": "ops@example.com",
        "subject": "Vessel schedule",
        "body": "The vessel is delayed.",
        "attachments": [],
    }
    classification = EmailClassification(
        category=EmailCategory.GENERAL,
        confidence=0.98,
        reasoning="This is a vessel schedule advisory.",
        is_comparison_candidate=False,
    )
    processor = FakePairProcessor(
        DocumentPairResult(
            validation=ValidationResult(
                status=ComparisonStatus.OK,
                has_defect=False,
                defect_fields=[],
            )
        )
    )
    result = await evaluate_inbox(
        inbox=FakeInbox([email], {}),
        output_file=tmp_path / "submission.json",
        classifier=FakeClassifier(classification),
        pair_processor=processor,
    )
    assert result["email_200"]["status"] == "OK"
    assert processor.calls == []


@pytest.mark.asyncio
async def test_resume_skips_completed_records(tmp_path):
    output = tmp_path / "submission.json"
    neutral_general = {
        "category": "GENERAL",
        "status": "OK",
        "review_reason": None,
        "has_defect": False,
        "defect_fields": [],
    }
    emails = [
        {
            "email_id": email_id,
            "from": "ops@example.com",
            "subject": "Update",
            "body": "Update",
            "attachments": [],
        }
        for email_id in ("email_001", "email_002")
    ]
    classification = EmailClassification(
        category=EmailCategory.GENERAL,
        confidence=0.9,
        reasoning="General operational correspondence.",
        is_comparison_candidate=False,
    )
    output.write_text(json.dumps({"email_001": neutral_general}))
    classifier = FakeClassifier(classification)
    await evaluate_inbox(
        inbox=FakeInbox(emails, {}),
        output_file=output,
        resume=True,
        classifier=classifier,
        pair_processor=FakePairProcessor(
            DocumentPairResult(
                validation=ValidationResult(
                    status=ComparisonStatus.OK,
                    has_defect=False,
                    defect_fields=[],
                )
            )
        ),
    )
    assert classifier.ids == ["email_002"]
```

Add tests that a checkpoint is valid after each email, `_SI`/`_BL` routing is case-insensitive, a missing role passes `None`, a terminal classifier error preserves completed output and propagates, and all categories map to organizer values without a flag.

- [ ] **Step 2: Run evaluator tests and confirm placeholder logic fails**

Run: `python -m pytest tests/test_eval_inbox.py -q`

Expected: FAIL because the current evaluator is synchronous, builds placeholder `OK` values, and has no resume interface.

- [ ] **Step 3: Implement scorer-compatible record construction**

```python
CATEGORY_MAP = {
    EmailCategory.DOCUMENT_COMPARISON: "BL_COMPARISON",
    EmailCategory.NEW_SI_REQUEST: "SI_REQUEST",
    EmailCategory.INVOICE_QUERY: "INVOICE_QUERY",
    EmailCategory.GENERAL: "GENERAL",
    EmailCategory.SPAM: "SPAM",
}


def _neutral_item(category: str) -> dict[str, object]:
    return {
        "category": category,
        "status": "OK",
        "review_reason": None,
        "has_defect": False,
        "defect_fields": [],
    }


def _comparison_item(category: str, result: DocumentPairResult) -> dict[str, object]:
    validation = result.validation
    return {
        "category": category,
        "status": validation.status.value,
        "review_reason": validation.review_reason.value if validation.review_reason else None,
        "has_defect": validation.has_defect,
        "defect_fields": validation.defect_fields,
    }
```

- [ ] **Step 4: Implement preparation, classification, role routing, and pair processing**

For each email, read raw attachment bytes into `DocumentInput` objects. Call `inspect_attachment` for classifier previews; errors become preview markers but do not decide comparison status. Resolve intended roles from basename patterns `_SI.` and `_BL.`. Call Pillar 2, then call `process_document_pair(si_input, bl_input)` only when `is_comparison_candidate` is true.

Use a three-attempt synchronous wrapper for transient classifier exceptions. It must inspect status/code 429 and 500–599 plus timeouts, sleep for 1 then 2 seconds, and re-raise the last exception. It must not retry 400/401/403 errors.

```python
def _classify_with_retry(classifier, *, sleep=time.sleep, **kwargs):
    for attempt in range(3):
        try:
            return classifier(**kwargs)
        except Exception as exc:
            code = getattr(exc, "code", getattr(exc, "status_code", None))
            transient = isinstance(exc, TimeoutError) or code == 429 or (
                isinstance(code, int) and 500 <= code < 600
            )
            if not transient or attempt == 2:
                raise
            sleep(2 ** attempt)
    raise AssertionError("retry loop exited without a result")
```

Use this injectable evaluator signature:

```python
async def evaluate_inbox(
    source: str = "data",
    *,
    inbox=None,
    output_file: Path = Path("submission.json"),
    max_emails: int | None = None,
    resume: bool = False,
    auto_submit: bool = True,
    classifier=classify_email,
    pair_processor=process_document_pair,
) -> dict[str, dict[str, object]]:
    active_inbox = inbox or Inbox(source)
```

- [ ] **Step 5: Implement atomic checkpoint and resume**

```python
def _write_checkpoint(path: Path, submission: dict[str, dict[str, object]]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(submission, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _load_checkpoint(path: Path, resume: bool) -> dict[str, dict[str, object]]:
    if not resume or not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Checkpoint must contain a JSON object keyed by email ID.")
    return value
```

Call `_write_checkpoint` immediately after each completed record. Skip existing IDs only when `resume=True`. Keep `--max` deterministic by applying it before resume filtering.

- [ ] **Step 6: Convert the CLI entry point to one event loop**

```python
def main() -> None:
    args = build_parser().parse_args()
    asyncio.run(
        evaluate_inbox(
            source=args.source,
            output_file=Path(args.output),
            max_emails=args.max,
            resume=args.resume,
            auto_submit=not args.no_submit,
        )
    )
```

`evaluate_inbox` accepts either a source string or an injected inbox object for tests. Do not call `asyncio.run` per email.

- [ ] **Step 7: Run evaluator and existing API tests**

Run: `python -m pytest tests/test_eval_inbox.py tests/test_api.py -q`

Expected: PASS.

- [ ] **Step 8: Commit the end-to-end evaluator slice**

```bash
git add scripts/eval_inbox.py tests/test_eval_inbox.py
git commit -m "feat: evaluate classified document pairs end to end"
```

### Task 7: Add the Optional Organizer-Bundle Smoke Runner

**Files:**
- Create: `scripts/smoke_extraction.py`
- Create: `tests/test_smoke_extraction.py`

**Interfaces:**
- Consumes: a ZIP path, selected organizer IDs, the integrated classifier, and Pillar 3 service.
- Produces: a nonzero exit for unexpected deterministic outcomes and a clear statement that scanned case 512 reached extraction.

- [ ] **Step 1: Write offline tests for ZIP access and expected-case assertions**

```python
def make_bundle_zip(tmp_path, *, email_id: str) -> Path:
    bundle = tmp_path / "bundle.zip"
    email = {
        "email_id": email_id,
        "from": "docs@example.com",
        "subject": "Compare SI and draft BL",
        "body": "Please compare the attached documents.",
        "attachments": [
            f"attachments/{email_id}_SI.txt",
            f"attachments/{email_id}_BL.txt",
        ],
    }
    with ZipFile(bundle, "w") as archive:
        archive.writestr(f"inbox/{email_id}.json", json.dumps(email))
        archive.writestr(
            f"attachments/{email_id}_SI.txt",
            "SHIPPING INSTRUCTION\nShipper: APRIL FAR EAST",
        )
        archive.writestr(
            f"attachments/{email_id}_BL.txt",
            "BILL OF LADING (DRAFT)\nShipper: APRIL FAR EAST",
        )
    return bundle


def test_zip_inbox_reads_email_and_attachment(tmp_path):
    bundle = make_bundle_zip(tmp_path, email_id="email_001")
    inbox = ZipInbox(bundle)
    assert inbox.get("email_001")["email_id"] == "email_001"
    assert inbox.read_bytes("attachments/email_001_SI.txt").startswith(b"SHIPPING INSTRUCTION")


def test_expected_result_table_includes_high_value_cases():
    assert EXPECTED["email_004"]["defect_fields"] == ["consignee", "notify_party"]
    assert EXPECTED["email_501"]["review_reason"] == "wrong_doc_type"
    assert EXPECTED["email_507"]["review_reason"] == "missing_attachment"
    assert EXPECTED["email_511"]["review_reason"] == "unreadable"
    assert EXPECTED["email_516"]["review_reason"] == "missing_value"
```

- [ ] **Step 2: Run smoke-runner unit tests and confirm the module is absent**

Run: `python -m pytest tests/test_smoke_extraction.py -q`

Expected: FAIL with an import error for `scripts.smoke_extraction`.

- [ ] **Step 3: Implement the ZIP adapter and selected live run**

Use `zipfile.ZipFile` directly. Never extract the archive or execute `loader.py` from inside it. Read JSON with `json.loads` and attachment bytes with `ZipFile.read`.

The default selected IDs are:

```python
CASES = (
    "email_001",
    "email_004",
    "email_013",
    "email_501",
    "email_507",
    "email_511",
    "email_512",
    "email_516",
    "email_517",
)
```

Run the same integrated evaluation path against only these records. Assert exact deterministic expectations for all cases except `email_512`; for `email_512`, assert the pair processor attempted two extractions and did not short-circuit to `unreadable` before the Gemini calls.

- [ ] **Step 4: Run smoke-runner unit tests**

Run: `python -m pytest tests/test_smoke_extraction.py -q`

Expected: PASS without a Gemini key.

- [ ] **Step 5: Commit the smoke runner**

```bash
git add scripts/smoke_extraction.py tests/test_smoke_extraction.py
git commit -m "test: add organizer bundle smoke runner"
```

### Task 8: Remove Conflicting Scaffolding, Document Operation, and Verify the Branch

**Files:**
- Delete: `backend/app/api.py`
- Delete: `backend/services/checker.py`
- Delete: `backend/services/gemini.py`
- Delete: `backend/.env.example`
- Modify: `.gitignore`
- Create: `docs/pillar-3-mvp.md`

**Interfaces:**
- Consumes: every implemented command and environment variable from Tasks 1–7.
- Produces: a clean repository layout and an operator-readable setup, test, smoke, full-run, and resume guide.

- [ ] **Step 1: Remove only the known conflicting untracked scaffolding**

Delete the four listed files after verifying they are still untracked and contain the reviewed incomplete alternate implementation. Do not remove `.codex/`, `AGENTS.md`, or any teammate-owned tracked files.

- [ ] **Step 2: Ignore generated evaluator outputs without hiding source fixtures**

Add these entries:

```gitignore
submission*.json
*.json.tmp
```

Keep `sample_submission.json` trackable if it is ever added intentionally by using the narrow `submission*.json` pattern rather than `*.json`.

- [ ] **Step 3: Write the operator guide with exact commands**

The guide must include these commands:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m pytest -q
```

For the optional live smoke:

```powershell
$env:GEMINI_API_KEY = "your-key"
$env:GEMINI_MODEL = "gemini-2.5-flash"
python scripts\smoke_extraction.py --bundle D:\downloads\sdoc-hackathon-bundle.zip
```

For a full extracted-folder run and recovery:

```powershell
Expand-Archive -LiteralPath D:\downloads\sdoc-hackathon-bundle.zip -DestinationPath data -Force
python scripts\eval_inbox.py --source data --output submission.json
python scripts\eval_inbox.py --source data --output submission.json --resume
```

Explain that ordinary tests are offline, the smoke/full commands use live Gemini, errors leave a valid checkpoint, and `--resume` skips completed IDs.

- [ ] **Step 4: Run the complete offline test suite**

Run: `python -m pytest -q`

Expected: all tests PASS, zero live Gemini calls, and no generated submission file.

- [ ] **Step 5: Run syntax and repository checks**

Run: `python -m compileall -q backend scripts tests`

Expected: exit code 0.

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only the intended Pillar 3, integration, tests, dependency, ignore, and documentation changes are present; `.codex/` and `AGENTS.md` remain untouched unless the user separately asks to commit them.

- [ ] **Step 6: Run the optional live smoke only when credentials are available**

Run: `python scripts/smoke_extraction.py --bundle D:\downloads\sdoc-hackathon-bundle.zip`

Expected: deterministic cases match the table and `email_512` reports that both scanned PDFs reached Gemini. If credentials are unavailable, record the smoke as not run rather than claiming success.

- [ ] **Step 7: Commit the cleanup and guide**

```bash
git add .gitignore docs/pillar-3-mvp.md
git commit -m "docs: add pillar 3 operation guide"
```

### Task 9: Final Independent Review and Handoff

**Files:**
- Review: all changes from `main...feat/document-extraction`

**Interfaces:**
- Consumes: the complete branch and passing verification evidence.
- Produces: resolved material findings, final test evidence, and a user-ready summary.

- [ ] **Step 1: Review the complete branch against the design specification**

Inspect:

```bash
git diff --stat main...HEAD
git diff main...HEAD
```

Review specifically for source isolation, review precedence, scanned-PDF handling, scorer values, checkpoint correctness, and accidental edits outside the approved scope.

- [ ] **Step 2: Run the final offline verification after review fixes**

Run: `python -m pytest -q`

Expected: PASS.

Run: `python -m compileall -q backend scripts tests`

Expected: exit code 0.

Run: `git diff --check main...HEAD`

Expected: no output.

- [ ] **Step 3: Report final evidence**

Report the branch name, commits created, files changed, offline test count, live smoke status, exact commands for the user, and any remaining operational limitation. Do not claim the 520-email live run passed unless it was actually executed successfully with credentials.
