from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import quote

logger = logging.getLogger(__name__)


def build_compose_url(to: str, subject: str, body: str) -> str:
    """Build a prefilled Gmail compose URL for browser fallback mode."""
    encoded_to = quote(to, safe="")
    encoded_su = quote(subject, safe="")
    encoded_body = quote(body, safe="")
    return f"https://mail.google.com/mail/?view=cm&fs=1&to={encoded_to}&su={encoded_su}&body={encoded_body}"


def build_saved_draft_url(draft_id: str, mailbox_address: str = "") -> str:
    """Build a link to a saved draft in Gmail."""
    if mailbox_address and mailbox_address != "me":
        return f"https://mail.google.com/mail?authuser={quote(mailbox_address, safe='')}#drafts/{draft_id}"
    return f"https://mail.google.com/mail/u/0/#drafts/{draft_id}"


def deterministic_correction_draft(
    case: dict[str, Any],
    unresolved_fields: list[str] | None = None,
    comparisons: list[dict[str, Any]] | None = None,
) -> tuple[str, str]:
    """Generate a high-quality deterministic correction email."""
    original_subject = case.get("subject") or "Shipping Documents Verification"
    subject = (
        original_subject
        if original_subject.lower().startswith("re:")
        else f"Re: {original_subject}"
    )

    result = case.get("result") or {}
    fields = unresolved_fields or result.get("defect_fields") or case.get("low_confidence_fields") or []

    discrepancy_lines: list[str] = []
    comp_map = {c.get("field"): c for c in (comparisons or [])}

    for f in fields:
        label = f.replace("_", " ").title()
        comp = comp_map.get(f)
        if comp:
            si_val = (comp.get("si") or {}).get("value") or "Missing / Not specified"
            bl_val = (comp.get("bl") or {}).get("value") or "Missing / Not specified"
            discrepancy_lines.append(f"  • {label}:\n    - Shipping Instruction (SI): {si_val}\n    - Draft Bill of Lading (BL): {bl_val}")
        else:
            discrepancy_lines.append(f"  • {label}: Discrepancy or missing information identified")

    items_text = "\n".join(discrepancy_lines) if discrepancy_lines else f"  • {result.get('review_reason') or 'Discrepancies identified during automated document verification'}"

    body = (
        "Dear Shipping Partner,\n\n"
        "Thank you for submitting your shipping documentation. During our verification process, "
        "the following discrepancy items require your review and clarification:\n\n"
        f"{items_text}\n\n"
        "Please review the discrepancies noted above and provide an updated Shipping Instruction (SI) "
        "or revised draft Bill of Lading (BL) to ensure timely release and compliance.\n\n"
        "Thank you for your prompt attention to this matter.\n\n"
        "Best regards,\n"
        "Documentation Verification Team\n"
        "ShipVerify Platform"
    )
    return subject, body


def generate_correction_draft(
    case: dict[str, Any],
    comparisons: list[dict[str, Any]] | None = None,
    field_reviews: dict[str, Any] | None = None,
    unresolved_fields: list[str] | None = None,
    explainer: Any | None = None,
) -> tuple[str, str, str]:
    """Generate an AI-powered correction draft with deterministic template fallback.

    Returns:
        tuple[subject, body, origin] where origin is "ai" or "template".
    """
    fields = unresolved_fields or (case.get("result") or {}).get("defect_fields") or case.get("low_confidence_fields") or []

    if not explainer or not getattr(explainer, "enabled", False):
        subject, body = deterministic_correction_draft(case, fields, comparisons)
        return subject, body, "template"

    evidence: dict[str, Any] = {
        "case_id": case.get("case_id"),
        "original_subject": case.get("subject"),
        "sender": case.get("sender"),
        "unresolved_fields": fields,
        "comparisons": [
            {
                "field": c.get("field"),
                "label": c.get("label"),
                "si_value": (c.get("si") or {}).get("value"),
                "bl_value": (c.get("bl") or {}).get("value"),
                "matches": c.get("matches"),
            }
            for c in (comparisons or [])
            if not fields or c.get("field") in fields
        ],
        "field_reviews": field_reviews or {},
        "review_reason": (case.get("result") or {}).get("review_reason") or case.get("review_reason"),
    }

    prompt = (
        "You are an assistant for maritime logistics. Write a polite, clear, and professional "
        "carrier correction request email to resolve document discrepancies between the Shipping Instruction (SI) "
        "and Bill of Lading (BL).\n\n"
        "Requirements:\n"
        "1. Subject line must start with 'Re: ' and reference the original subject.\n"
        "2. Detail the exact fields that need clarification or correction with the SI and BL values.\n"
        "3. Ask the recipient to reply with corrected documents.\n"
        "4. Respond STRICTLY in JSON format with exactly two keys: 'subject' (string) and 'body' (string).\n\n"
        f"Case Evidence:\n{json.dumps(evidence, default=str)}"
    )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(vertexai=True, project=explainer.project, location=explainer.location)
        response = client.models.generate_content(
            model=explainer.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )
        text = (response.text or "").strip()
        data = json.loads(text)
        sub = data.get("subject", "").strip()
        msg_body = data.get("body", "").strip()
        if sub and msg_body:
            return sub, msg_body, "ai"
    except Exception as exc:
        logger.warning("Gemini correction draft generation failed; falling back to template: %s", exc)

    subject, body = deterministic_correction_draft(case, fields, comparisons)
    return subject, body, "template"


def generate_si_return_draft(
    case: dict[str, Any],
    si_filename: str = "Shipping_Instruction.txt",
) -> tuple[str, str]:
    """Generate a polite email returning the generated and approved SI document."""
    original_subject = case.get("subject") or "Shipping Instruction Request"
    subject = (
        original_subject
        if original_subject.lower().startswith("re:")
        else f"Re: {original_subject}"
    )
    body = (
        "Dear Shipping Partner,\n\n"
        "Thank you for your inquiry. Please find attached the verified and approved "
        f"Shipping Instruction document ({si_filename}) prepared for your consignment.\n\n"
        "Please review the attached details and notify us immediately if any corrections "
        "or amendments are required prior to final vessel cutoff.\n\n"
        "Best regards,\n"
        "Documentation Verification Team\n"
        "ShipVerify Platform"
    )
    return subject, body


def generate_invoice_response_draft(
    case: dict[str, Any],
    custom_instructions: str = "",
) -> tuple[str, str]:
    """Generate a response acknowledging and routing an invoice query to Finance."""
    original_subject = case.get("subject") or "Invoice Query"
    subject = (
        original_subject
        if original_subject.lower().startswith("re:")
        else f"Re: {original_subject}"
    )
    extra_text = f"\n\nNote: {custom_instructions}" if custom_instructions else ""
    body = (
        "Dear Customer,\n\n"
        "Thank you for contacting us regarding your invoice inquiry.\n\n"
        "Your request has been routed to our Finance & Accounts Department for expedited "
        "review. Our accounts specialist is currently verifying the charges against the agreed "
        "tariff schedule and will provide a full breakdown within 1 business day."
        f"{extra_text}\n\n"
        "Thank you for your patience.\n\n"
        "Best regards,\n"
        "Finance & Accounts Team\n"
        "ShipVerify Platform"
    )
    return subject, body


def generate_general_response_draft(
    case: dict[str, Any],
    custom_instructions: str = "",
) -> tuple[str, str]:
    """Generate a response acknowledging and handling a general correspondence inquiry."""
    original_subject = case.get("subject") or "General Inquiry"
    subject = (
        original_subject
        if original_subject.lower().startswith("re:")
        else f"Re: {original_subject}"
    )
    extra_text = f"\n\nNote: {custom_instructions}" if custom_instructions else ""
    body = (
        "Dear Customer,\n\n"
        "Thank you for reaching out to us.\n\n"
        "We have received your message and forwarded it to our Customer Service team. "
        "A representative will review the details and get back to you shortly."
        f"{extra_text}\n\n"
        "Best regards,\n"
        "Customer Service Team\n"
        "ShipVerify Platform"
    )
    return subject, body
