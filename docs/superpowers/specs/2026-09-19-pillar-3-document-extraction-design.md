# Pillar 3 Document Extraction MVP Design

## Purpose

Complete Pillar 3 and connect it to the existing Pillar 2 classifier through the batch evaluator. The resulting command processes the 520-email organizer bundle, classifies every email, extracts and compares SI/BL documents for `BL_COMPARISON` cases, checkpoints progress, and writes a scorer-compatible submission.

The implementation must preserve the central trust boundary:

- Gemini classifies emails and extracts facts from one document at a time.
- Python alone decides `OK`, `MISMATCH`, `NEEDS_REVIEW`, `has_defect`, and `defect_fields`.
- Missing document values are never reconstructed from the email, filename, paired document, or external knowledge.

## Scope

This branch will:

- preserve and minimally adapt the existing Pillar 2 classifier;
- complete an independent `backend.extraction` package;
- use Pillar 3 document preparation to provide safe attachment previews to Pillar 2;
- invoke structured Pillar 3 extraction only for emails classified as `BL_COMPARISON`;
- integrate the result into `scripts/eval_inbox.py`;
- support sequential checkpointed execution and resume;
- add offline automated tests, an optional live bundle smoke runner, and an operator guide.

This branch will not add a document FastAPI endpoint, frontend integration, Firestore, Telegram, Cloud Run, deployment configuration, OCR dependencies, or generalized attachment-role inference.

## Organizer Contract

Submission categories are exactly:

- `BL_COMPARISON`
- `SI_REQUEST`
- `INVOICE_QUERY`
- `GENERAL`
- `SPAM`

Comparison statuses are exactly `OK`, `MISMATCH`, and `NEEDS_REVIEW`. Review reasons are exactly `missing_attachment`, `unreadable`, `wrong_doc_type`, and `missing_value`.

All submission records include `category`, `status`, `review_reason`, `defect_fields`, and `has_defect`. `NEEDS_REVIEW` uses `has_defect: false` and an empty `defect_fields` list.

## Package Structure

```text
backend/
├── extraction/
│   ├── __init__.py
│   ├── schemas.py
│   ├── document_reader.py
│   ├── extractor_flow.py
│   ├── service.py
│   └── validator.py
├── skills/
│   └── extractor.md
└── requirements.txt

tests/
├── test_extraction_schemas.py
├── test_document_reader.py
├── test_extractor_flow.py
├── test_extraction_service.py
├── test_extraction_validator.py
└── test_eval_inbox.py

scripts/
├── eval_inbox.py
└── smoke_extraction.py

docs/
└── pillar-3-mvp.md
```

The unfinished alternate `backend/app/api.py`, `backend/services/checker.py`, and invalid `backend/services/gemini.py` scaffolding will be removed. They are outside Pillar 3, import nonexistent modules, and conflict with the required seven-field result contract.

## Typed Contracts

`ExtractedDocument` contains exactly seven required but nullable fields and forbids extra keys:

```python
class ExtractedDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shipper: str | None
    consignee: str | None
    notify_party: str | None
    port_of_loading: str | None
    port_of_discharge: str | None
    container_count: int | None
    gross_weight_kg: int | None
```

`DocumentInput` contains a filename, original bytes, and optional MIME type. `PreparedDocument` contains either text or original PDF bytes. `DocumentPairResult` contains the independently extracted SI and BL documents when available plus the deterministic `ValidationResult`.

The public Pillar 3 interface remains:

```python
from backend.extraction import DocumentInput, process_document_pair
```

## Document Preparation

Pillar 3 prepares each attachment before classification:

- TXT: decode with a small ordered encoding fallback and provide text.
- DOCX/XLSX: convert to Markdown with `markitdown[docx,xlsx]` and provide text.
- PDF: validate structural readability with `pypdf`, retain the original PDF bytes, and do not convert it through MarkItDown.
- Unsupported formats: raise a declared unsupported-document error.

A structurally valid image-only PDF is not unreadable. It produces a neutral PDF preview for classification and is later sent to Gemini as original bytes.

Prepared text is used only as optional classification context. Classification must still work when attachments are missing, corrupt, or image-only.

## Classification Integration

The existing Pillar 2 classifier remains responsible for email intent. It receives subject, body, sender, filenames, and available text previews. A wrong attachment does not change the requested workflow: an email asking to compare SI and BL remains `BL_COMPARISON`, even when the supposed BL is a commercial invoice.

Pillar 2's internal category names may remain for compatibility, but `scripts/eval_inbox.py` always maps them to the organizer's exact category values. Pillar 2's `missing_attachments_flag` is not authoritative for document review and must not prevent Pillar 3 execution. In particular, scanned PDFs are not treated as missing.

For non-`BL_COMPARISON` categories, the evaluator emits the organizer's neutral comparison fields without calling the structured document extractor.

## Attachment Role Resolution

The MVP targets the supplied bundle contract. `_SI` and `_BL` filename markers assign each attachment's intended role. Filenames are routing metadata only and are never evidence for extracted field values or actual document type.

If an expected role cannot be identified, Pillar 3 returns `NEEDS_REVIEW / missing_attachment`. General production-grade role inference is explicitly deferred.

## Document-Type Preflight

Readable text is checked for clear leading document headings. Recognized expected headings include shipping-instruction and bill-of-lading variants. Clear commercial-invoice, packing-list, and certificate-of-origin headings yield `wrong_doc_type` before missing-field validation.

The preflight uses document titles/headings rather than arbitrary keyword occurrences, so an SI that merely references an accompanying commercial invoice is not rejected. Unknown or ambiguous readable content proceeds to extraction rather than being guessed wrong.

## Independent Gemini Extraction

`extractor_flow.py` reads `backend/skills/extractor.md` explicitly and passes it as the system instruction. Each Gemini request contains one prepared document only.

The request never includes:

- email subject or body;
- the paired SI or BL;
- values extracted from another document;
- filename content as field evidence;
- external shipment knowledge.

Text documents are sent as text. PDFs use `types.Part.from_bytes(data=..., mime_type="application/pdf")`. Structured output uses `ExtractedDocument`, JSON response format, and temperature zero. The model comes from one shared `GEMINI_MODEL` setting used by both pillars, defaulting to `gemini-2.5-flash` for the MVP.

The prompt defines party-name extraction, label aliases, container and weight normalization, textual-port precedence over parenthetical codes, and explicit null placeholders such as blank values, `N/A`, `TBA`, `???`, and underscores.

## Deterministic Review Precedence

`service.py` applies this order:

1. Missing expected attachment → `missing_attachment`
2. File cannot be opened or processed → `unreadable`
3. Readable file clearly has the wrong document type → `wrong_doc_type`
4. Any of the seven extracted values is null → `missing_value`
5. Compare all seven fields → `OK` or `MISMATCH`

Wrong-document detection precedes missing-value detection because invoices and packing lists naturally omit BL fields.

Infrastructure failures are not document findings. Authentication, invalid configuration, unsupported schema, and exhausted API retries abort the batch and preserve its checkpoint. They are never converted to `unreadable`.

## Validation

`validator.py` contains no AI. It compares exactly the seven fields in their declared order. String comparison collapses repeated whitespace and case-folds. It does not use fuzzy matching, aggressively strip punctuation, apply numeric tolerance, or trust port codes over printed port names.

A mismatch sets `has_defect: true` and returns every differing field in schema order. Review results and successful matches use `has_defect: false` and an empty defect list.

## Batch Execution, Retry, and Resume

The evaluator processes emails sequentially to reduce quota pressure. It may make one classifier call per email and up to two independent extraction calls for each comparison candidate.

Transient timeouts, HTTP 429 responses, and server-side failures receive at most three attempts with bounded backoff. Authentication, schema, and configuration failures stop immediately.

After each completed email, the evaluator atomically replaces its checkpoint/output JSON. `--resume` loads existing completed records and skips them. If a terminal API failure occurs, the command exits nonzero without fabricating results; a later resume continues after the last completed email.

The output must contain all 520 email IDs before it is considered submission-ready.

## Testing Strategy

Ordinary tests are fully offline and never call Gemini. They use fake extraction responses at the extractor boundary and generated temporary document fixtures.

Tests cover:

- exact schema shape, required nullable keys, and forbidden extras;
- matching documents, every individual mismatch, multiple mismatches, stable field ordering, and whitespace/case normalization;
- every review reason and deterministic precedence;
- TXT decoding, MarkItDown DOCX/XLSX conversion, valid PDF byte preservation, corrupt PDFs, and image-only PDF acceptance;
- one-document-only request construction and absence of email/paired-document context;
- document-title preflight behavior;
- category mapping and neutral non-comparison outputs;
- checkpoint creation, atomic replacement, resume, and terminal failure preservation;
- transient retry limits and immediate non-transient failure behavior.

An optional live smoke command accepts `--bundle <path-to-zip>` and exercises organizer cases `001`, `004`, `013`, `501`, `507`, `511`, `512`, `516`, and `517`. It is never part of normal `pytest` execution.

## Documentation

`docs/pillar-3-mvp.md` will explain:

- the architecture and trust boundary;
- Python and dependency setup;
- required environment variables;
- offline test commands;
- the optional live smoke command;
- full 520-email execution and `--resume`;
- expected submission output;
- troubleshooting for credentials, quota, corrupt documents, and unavailable models;
- deferred MVP limitations, including arbitrary attachment-role inference.

Organizer bundle files, credentials, generated submissions, checkpoints, and API responses are not committed.

