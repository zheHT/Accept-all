#!/usr/bin/env python3
"""Restartable batch evaluator for the shipping inbox."""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Callable, Iterable

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from loader import Inbox
from backend.agents.classifier_flow import classify_email
from backend.extraction import DocumentInput, DocumentPairResult, process_document_pair
from backend.models.schemas import EmailCategory, SubmissionItem
from backend.utils.attachment_sniffer import inspect_attachment


CATEGORY_MAP = {
    EmailCategory.DOCUMENT_COMPARISON: "BL_COMPARISON",
    EmailCategory.NEW_SI_REQUEST: "SI_REQUEST",
    EmailCategory.INVOICE_QUERY: "INVOICE_QUERY",
    EmailCategory.GENERAL: "GENERAL",
    EmailCategory.SPAM: "SPAM",
}
_UNREADABLE_PREVIEW = "[Unreadable or Corrupted File]"


def _neutral_item(category: str) -> dict[str, object]:
    return SubmissionItem(
        category=category,
        status="OK",
        review_reason=None,
        has_defect=False,
        defect_fields=[],
    ).model_dump()


def _comparison_item(category: str, result: DocumentPairResult) -> dict[str, object]:
    validation = result.validation
    return SubmissionItem(
        category=category,
        status=validation.status.value,
        review_reason=(validation.review_reason.value if validation.review_reason else None),
        has_defect=validation.has_defect,
        defect_fields=validation.defect_fields,
    ).model_dump()


def _document_inputs(
    documents: Iterable[tuple[str, bytes]],
) -> tuple[DocumentInput | None, DocumentInput | None]:
    """Return the explicitly named SI and BL documents, without inference."""
    si_input = None
    bl_input = None
    for path, data in documents:
        filename = Path(path).name
        normalized_name = filename.casefold()
        document = DocumentInput(filename=filename, data=data)
        if si_input is None and "_si." in normalized_name:
            si_input = document
        elif bl_input is None and "_bl." in normalized_name:
            bl_input = document
    return si_input, bl_input


def _classify_with_retry(
    classifier: Callable[..., object], *, sleep: Callable[[float], None] = time.sleep, **kwargs: object
) -> object:
    """Retry only transient synchronous classifier failures, up to three attempts."""
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
            sleep(2**attempt)
    raise AssertionError("retry loop exited without a result")


def _write_checkpoint(path: Path, submission: dict[str, dict[str, object]]) -> None:
    """Persist the complete current state without exposing a partial JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
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
    """Classify emails and validate only comparison candidates, sequentially."""
    active_inbox = inbox or Inbox(source)
    output_path = Path(output_file)
    submission = _load_checkpoint(output_path, resume)
    emails = active_inbox.emails()
    selected_emails = emails if max_emails is None else emails[:max_emails]

    for index, email in enumerate(selected_emails, 1):
        email_id = email.get("email_id", f"email_{index:03d}")
        if resume and email_id in submission:
            continue

        attachment_previews: dict[str, str] = {}
        documents: list[tuple[str, bytes]] = []
        for attachment_path in email.get("attachments", []) or []:
            filename = Path(attachment_path).name
            try:
                data = active_inbox.read_bytes(attachment_path)
            except Exception:
                attachment_previews[filename] = _UNREADABLE_PREVIEW
                continue
            documents.append((attachment_path, data))
            try:
                attachment_previews[filename] = inspect_attachment(filename, data)
            except Exception:
                attachment_previews[filename] = _UNREADABLE_PREVIEW

        classification = _classify_with_retry(
            classifier,
            email_id=email_id,
            subject=email.get("subject", ""),
            sender=email.get("from", email.get("sender", "")),
            body=email.get("body", ""),
            attachment_previews=attachment_previews,
        )
        category = CATEGORY_MAP[classification.category]
        if classification.is_comparison_candidate:
            si_input, bl_input = _document_inputs(documents)
            pair_result = await pair_processor(si_input, bl_input)
            item = _comparison_item(category, pair_result)
        else:
            item = _neutral_item(category)

        submission[email_id] = item
        _write_checkpoint(output_path, submission)

    if active_inbox.is_http and auto_submit:
        active_inbox.submit(submission)
    return submission


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Maritime Shipping Email Triage Batch Evaluator"
    )
    parser.add_argument("--source", default="data")
    parser.add_argument("--output", default="submission.json")
    parser.add_argument("--max", dest="max_emails", type=int, default=None)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--no-submit", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    asyncio.run(
        evaluate_inbox(
            source=args.source,
            output_file=Path(args.output),
            max_emails=args.max_emails,
            resume=args.resume,
            auto_submit=not args.no_submit,
        )
    )


if __name__ == "__main__":
    main()
