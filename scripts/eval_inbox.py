#!/usr/bin/env python3
"""
Batch Evaluation Runner for Maritime Shipping Email Classifier & Triage Agent.

Integrates with loader.py to evaluate against the shipping inbox dataset
(either local 'data' folder or docker HTTP server 'http://localhost:8080')
and outputs a submission dictionary matching sample_submission.json.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.agents.classifier_flow import classify_email
from backend.models.schemas import SubmissionItem
from backend.utils.attachment_sniffer import inspect_attachment
from loader import Inbox

# Category mapping for server scoring compatibility
SERVER_CATEGORY_MAP = {
    "DOCUMENT_COMPARISON": "BL_COMPARISON",
    "NEW_SI_REQUEST": "SI_REQUEST",
    "INVOICE_QUERY": "INVOICE_QUERY",
    "GENERAL": "GENERAL",
    "SPAM": "SPAM",
}


def print_table_header():
    header = f"| {'Email ID':<12} | {'Category':<22} | {'Confidence':<10} | {'Candidate?':<11} | {'Missing Att?':<12} |"
    sep = f"|{'-'*14}|{'-'*24}|{'-'*12}|{'-'*13}|{'-'*14}|"
    print(sep)
    print(header)
    print(sep)


def print_table_row(email_id: str, category: str, confidence: float, is_candidate: bool, missing_flag: bool):
    cand_str = "YES (Doc)" if is_candidate else "No"
    miss_str = "FLAGGED" if missing_flag else "OK"
    row = f"| {email_id:<12} | {category:<22} | {confidence:<10.2f} | {cand_str:<11} | {miss_str:<12} |"
    print(row)


def evaluate_inbox(
    source: str = "data",
    max_emails: int = None,
    output_file: str = "submission.json",
    server_compat: bool = False,
    auto_submit: bool = True,
) -> dict[str, Any]:
    """Run batch triage classification over inbox emails and produce submission dict."""
    print("\n=======================================================")
    print(" Maritime Shipping Email Triage Evaluator")
    print(f" Source: {source}")
    print(f" Server Compatibility Mapping: {server_compat}")
    print("=======================================================\n")

    inbox = Inbox(source)
    all_emails = inbox.emails()
    total_available = len(all_emails)
    print(f"Discovered {total_available} emails from source.")

    if max_emails and max_emails > 0:
        eval_emails = all_emails[:max_emails]
        print(f"Evaluating subset of {len(eval_emails)} emails (max_emails={max_emails}).")
    else:
        eval_emails = all_emails

    submission: dict[str, dict[str, Any]] = {}
    stats = {
        "DOCUMENT_COMPARISON": 0,
        "NEW_SI_REQUEST": 0,
        "INVOICE_QUERY": 0,
        "GENERAL": 0,
        "SPAM": 0,
        "CANDIDATES": 0,
        "MISSING_ATTACHMENTS": 0,
    }

    print_table_header()

    for idx, email_record in enumerate(eval_emails, 1):
        email_id = email_record.get("email_id", f"email_{idx:03d}")
        subject = email_record.get("subject", "")
        sender = email_record.get("from", email_record.get("sender", ""))
        body = email_record.get("body", "")
        attachment_paths = email_record.get("attachments", []) or []

        # Extract attachment previews
        attachment_previews: dict[str, str] = {}
        for att_path in attachment_paths:
            filename = os.path.basename(att_path)
            try:
                # Attempt to read raw bytes from inbox
                raw_bytes = inbox.read_bytes(att_path)
                preview = inspect_attachment(filename, raw_bytes)
                attachment_previews[filename] = preview
            except Exception:
                try:
                    # Fallback to reading text
                    text = inbox.read_text(att_path)
                    preview = inspect_attachment(filename, text)
                    attachment_previews[filename] = preview
                except Exception:
                    attachment_previews[filename] = "[Unreadable or Corrupted File]"

        # Call classifier agent
        result = classify_email(
            email_id=email_id,
            subject=subject,
            sender=sender,
            body=body,
            attachment_previews=attachment_previews,
        )

        category_key = result.category.value
        stats[category_key] = stats.get(category_key, 0) + 1
        if result.is_comparison_candidate:
            stats["CANDIDATES"] += 1
        if result.missing_attachments_flag:
            stats["MISSING_ATTACHMENTS"] += 1

        print_table_row(
            email_id=email_id,
            category=category_key,
            confidence=result.confidence,
            is_candidate=result.is_comparison_candidate,
            missing_flag=result.missing_attachments_flag,
        )

        # Determine submission category name
        sub_category = category_key
        if server_compat or inbox.is_http:
            sub_category = SERVER_CATEGORY_MAP.get(category_key, category_key)

        # Build submission item matching sample_submission.json
        if result.is_comparison_candidate:
            if result.missing_attachments_flag:
                item = SubmissionItem(
                    category=sub_category,
                    status="NEEDS_REVIEW",
                    review_reason="Missing or unreadable attachment files",
                    has_defect=None,
                    defect_fields=[],
                )
            else:
                item = SubmissionItem(
                    category=sub_category,
                    status="OK",
                    review_reason=None,
                    has_defect=False,
                    defect_fields=[],
                )
        else:
            item = SubmissionItem(
                category=sub_category,
                status="OK",
                review_reason=None,
                has_defect=False,
                defect_fields=[],
            )

        submission[email_id] = item.model_dump()

    sep = f"|{'-'*14}|{'-'*24}|{'-'*12}|{'-'*13}|{'-'*14}|"
    print(sep)

    # Summary statistics
    print("\n--- Operational Triage Summary ---")
    print(f"Total Evaluated:         {len(eval_emails)}")
    print(f"DOCUMENT_COMPARISON:    {stats['DOCUMENT_COMPARISON']} (Candidates for discrepancy check)")
    print(f"NEW_SI_REQUEST:         {stats['NEW_SI_REQUEST']}")
    print(f"INVOICE_QUERY:          {stats['INVOICE_QUERY']}")
    print(f"GENERAL:                {stats['GENERAL']}")
    print(f"SPAM:                   {stats['SPAM']}")
    print(f"Comparison Candidates:  {stats['CANDIDATES']}")
    print(f"Missing Attachments:    {stats['MISSING_ATTACHMENTS']}")
    print("-----------------------------------\n")

    # Save to output file
    out_path = Path(output_file)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(submission, f, indent=2)
    print(f"Saved submission output to: {out_path.resolve()}")

    # Submit to HTTP server if targeting server and auto_submit is True
    if inbox.is_http and auto_submit:
        try:
            print(f"\nSubmitting results to server at {source}/submit...")
            scoreboard = inbox.submit(submission)
            print("\n=======================================================")
            print(" Server Evaluation Scoreboard")
            print("=======================================================")
            print(json.dumps(scoreboard, indent=2))
        except Exception as e:
            print(f"Server submission failed: {e}")

    return submission


def main():
    parser = argparse.ArgumentParser(
        description="Maritime Shipping Email Classifier & Triage Batch Evaluator"
    )
    parser.add_argument(
        "--source",
        default="data",
        help="Path to local data folder (with inbox/) or server URL (default: 'data')",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=None,
        help="Maximum number of emails to evaluate (default: all)",
    )
    parser.add_argument(
        "--output",
        default="submission.json",
        help="Output path for submission JSON (default: 'submission.json')",
    )
    parser.add_argument(
        "--server-compat",
        action="store_true",
        help="Map categories to server format (DOCUMENT_COMPARISON -> BL_COMPARISON, NEW_SI_REQUEST -> SI_REQUEST)",
    )
    parser.add_argument(
        "--no-submit",
        action="store_true",
        help="Do not submit to HTTP server even if source is HTTP URL",
    )

    args = parser.parse_args()
    evaluate_inbox(
        source=args.source,
        max_emails=args.max,
        output_file=args.output,
        server_compat=args.server_compat,
        auto_submit=not args.no_submit,
    )


if __name__ == "__main__":
    main()
