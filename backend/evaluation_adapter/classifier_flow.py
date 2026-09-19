"""Triage classifier agent for maritime shipping correspondence using Gemini 1.5 Flash."""
import logging
import os
import re

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import ValidationError

from backend.evaluation_adapter.schemas import EmailCategory, EmailClassification

load_dotenv()
logger = logging.getLogger(__name__)

client: genai.Client | None = None


def get_client() -> genai.Client | None:
    """Retrieve or dynamically initialize the GenAI Client using Vertex AI and GCP."""
    global client
    load_dotenv(override=True)
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "gen-lang-client-0866395749")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
    try:
        c = genai.Client(vertexai=True, project=project, location=location)
        client = c
        return c
    except Exception as e:
        logger.debug(f"Vertex AI initialization with location {location} deferred: {e}")
        try:
            c = genai.Client(vertexai=True, project=project, location="us-central1")
            client = c
            return c
        except Exception as e2:
            logger.warning(f"Could not initialize Vertex AI Client: {e2}. Fallback enabled.")
            client = None
            return None


# Initial check at import time
get_client()


SYSTEM_INSTRUCTION = """You are an expert Maritime Shipping Operations Triage Agent.
Your job is to analyze incoming customer service correspondence and classify each email into exactly one of five operational categories:

1. DOCUMENT_COMPARISON:
   - The email asks to review, verify, approve, cross-check, or validate a carrier draft Bill of Lading (BL / B/L) against a Shipping Instruction (SI), OR provides both documents across the email body and attachments.
   - ONLY emails in this category proceed to downstream 7-field discrepancy extraction and validation.
   - Set is_comparison_candidate = True strictly for this category.

2. NEW_SI_REQUEST:
   - The sender submits initial or updated/amended Shipping Instructions (SI) for filing or booking creation WITHOUT any carrier draft BL to cross-check.
   - Common triggers: "Please find attached SI for booking #...", "New shipping instruction submitted", "Kindly file the attached SI with the carrier".
   - Set is_comparison_candidate = False.

3. INVOICE_QUERY:
   - Questions, disputes, detention/demurrage fees, payment receipts, wire transfer confirmations, or statements regarding freight billing and charges.
   - Common triggers: "Invoice #...", "demurrage charges dispute", "payment receipt", "statement of account", "overcharge".
   - Set is_comparison_candidate = False.

4. GENERAL:
   - Operational schedule advisories, vessel delays, cut-off notices, equipment availability, blank sailings, terminal advisories, holiday hours, or general customer inquiries.
   - Set is_comparison_candidate = False.

5. SPAM:
   - Unsolicited commercial marketing, sales solicitations, SEO services, conferences, or irrelevant promotional spam.
   - Set is_comparison_candidate = False.

CRITICAL RULES:
- BODY INTENT OVERRIDES DECEPTIVE SUBJECT LINES: If an email has a subject line like "General Inquiry" or "Quick question" but the body asks "Please check draft BL against our SI", it MUST be classified as DOCUMENT_COMPARISON.
- ATTACHMENT CONTEXT: If attachments contain both draft BL and SI text, or the user requests verification of the draft B/L, classify as DOCUMENT_COMPARISON.
- CONFIDENCE: Assign a realistic confidence score between 0.0 and 1.0.
- REASONING: Provide a concise, clear 1-sentence operational rationale.

FEW-SHOT EXAMPLES:

Example 1 (DOCUMENT_COMPARISON):
Subject: "TO CONFIRM DOCS _ 5RSG-00133 _ CALLAO_PERU _ MOORIM SP CO., LTD"
Body: "Hi team, Attached are the SI and draft BL for OC 5RSG-00133. Please check the details and confirm if anything is mismatched."
Attachments: ["email_001_SI.txt", "email_001_BL.txt"]
Classification: {
  "category": "DOCUMENT_COMPARISON",
  "confidence": 0.98,
  "reasoning": "Email contains both SI and carrier draft BL and explicitly requests cross-checking and confirmation of documents.",
  "is_comparison_candidate": true,
  "missing_attachments_flag": false,
  "detected_attachments": ["email_001_SI.txt", "email_001_BL.txt"]
}

Example 2 (DOCUMENT_COMPARISON - Deceptive Subject):
Subject: "General Inquiry regarding shipment #77291"
Body: "Dear Ops, We received the draft bill of lading from the carrier. Please compare it against our shipping instruction attached to make sure port and weights match."
Attachments: ["draft_bl_77291.pdf", "si_77291.docx"]
Classification: {
  "category": "DOCUMENT_COMPARISON",
  "confidence": 0.95,
  "reasoning": "Despite a general subject line, the body clearly requests cross-checking a carrier draft BL against the customer SI.",
  "is_comparison_candidate": true,
  "missing_attachments_flag": false,
  "detected_attachments": ["draft_bl_77291.pdf", "si_77291.docx"]
}

Example 3 (NEW_SI_REQUEST):
Subject: "Shipping Instruction - Booking BKG-992100"
Body: "Dear Carrier Documentation, Please find attached our initial Shipping Instruction for container BKG-992100. Kindly file with customs and generate draft BL when ready."
Attachments: ["SI_BKG992100.xlsx"]
Classification: {
  "category": "NEW_SI_REQUEST",
  "confidence": 0.96,
  "reasoning": "Sender is submitting initial Shipping Instructions for filing without requesting a cross-check against an existing draft BL.",
  "is_comparison_candidate": false,
  "missing_attachments_flag": false,
  "detected_attachments": ["SI_BKG992100.xlsx"]
}

Example 4 (INVOICE_QUERY):
Subject: "Dispute - Detention Charges for Container MSCU1234567"
Body: "Hello Accounts, We were invoiced $450 for detention on container MSCU1234567, but empty was returned on Monday within free time. Please issue a credit note."
Attachments: ["Invoice_INV-8821.pdf"]
Classification: {
  "category": "INVOICE_QUERY",
  "confidence": 0.97,
  "reasoning": "Email disputes detention billing charges and requests a credit note from the freight accounts team.",
  "is_comparison_candidate": false,
  "missing_attachments_flag": false,
  "detected_attachments": ["Invoice_INV-8821.pdf"]
}

Example 5 (GENERAL):
Subject: "Vessel Schedule Update - MV PACIFIC PHOENIX V.2405W"
Body: "Notice to trade: Please be advised that MV PACIFIC PHOENIX V.2405W is delayed by 24 hours at Singapore due to port congestion. Revised ETA is 22-Sep-2026."
Attachments: []
Classification: {
  "category": "GENERAL",
  "confidence": 0.98,
  "reasoning": "Operational advisory regarding vessel delay and revised schedule ETA.",
  "is_comparison_candidate": false,
  "missing_attachments_flag": false,
  "detected_attachments": []
}

Example 6 (SPAM):
Subject: "Boost your website traffic with #1 Google Ranking!"
Body: "Dear Manager, We offer premier SEO optimization and email marketing campaigns with 50% discount this month. Reply to book a demo."
Attachments: []
Classification: {
  "category": "SPAM",
  "confidence": 0.99,
  "reasoning": "Unsolicited commercial marketing and SEO service promotion unrelated to maritime shipping operations.",
  "is_comparison_candidate": false,
  "missing_attachments_flag": false,
  "detected_attachments": []
}
"""


def _check_missing_attachments(
    category: EmailCategory,
    attachment_previews: dict[str, str] | None,
) -> bool:
    """Guardrail to flag missing, corrupted, or unreadable attachments for DOCUMENT_COMPARISON."""
    if category != EmailCategory.DOCUMENT_COMPARISON:
        return False

    if not attachment_previews:
        return True

    # Check if there are valid readable attachments
    unreadable_tags = [
        "[Unreadable or Corrupted File]",
        "[Scanned or Image-only PDF]",
    ]

    readable_count = 0
    for _name, content in attachment_previews.items():
        if not content:
            continue
        trimmed = content.strip()
        if trimmed and trimmed not in unreadable_tags and len(trimmed) > 10:
            readable_count += 1

    # In maritime BL vs SI comparison, we expect at least 1 readable attachment (or 2)
    return readable_count < 1


def _classify_with_heuristics(
    email_id: str,
    subject: str,
    sender: str,
    body: str,
    attachment_previews: dict[str, str] | None = None,
) -> EmailClassification:
    """High-accuracy deterministic fallback classifier based on maritime shipping operational rules."""
    text = f"{subject}\n{body}".lower()
    att_names = list(attachment_previews.keys()) if attachment_previews else []
    att_text = " ".join([f"{k} {v}" for k, v in (attachment_previews or {}).items()]).lower()
    all_content = f"{text}\n{att_text}"

    # 1. SPAM check
    spam_keywords = [
        "seo services", "google ranking", "boost your traffic", "marketing campaign",
        "special discount", "unsolicited", "click here to claim", "crypto",
        "casino", "partnership opportunity", "unsubscribe", "weird trick",
        "storage limit", "verify your account", "mailbox has exceeded",
        "account deactivation", "claim your prize", "lottery"
    ]
    if any(k in all_content for k in spam_keywords) and not any(k in all_content for k in ["bill of lading", "shipping instruction", "container", "booking"]):
        return EmailClassification(
            category=EmailCategory.SPAM,
            confidence=0.95,
            reasoning="Email contains promotional marketing, solicitation, or phishing indicators unrelated to shipping operations.",
            is_comparison_candidate=False,
            missing_attachments_flag=False,
            detected_attachments=att_names,
        )

    # 2. INVOICE_QUERY check
    invoice_keywords = [
        "invoice", "demurrage", "detention", "freight charges", "billing",
        "payment receipt", "credit note", "statement of account", "overcharge",
        "wire transfer", "remittance", "paid", "dispute charge"
    ]
    if any(re.search(rf"\b{k}\b", all_content) for k in invoice_keywords) and not any(k in text for k in ["compare", "cross-check", "draft bl", "confirm docs"]):
        return EmailClassification(
            category=EmailCategory.INVOICE_QUERY,
            confidence=0.94,
            reasoning="Email concerns freight billing, invoice disputes, detention/demurrage fees, or payment confirmation.",
            is_comparison_candidate=False,
            missing_attachments_flag=False,
            detected_attachments=att_names,
        )

    # 3. DOCUMENT_COMPARISON check
    # Check indicators that both documents exist or comparison is requested
    has_bl_keyword = bool(re.search(r"\b(draft\s*b/?l|draft\s*bill\s*of\s*lading|b/?l\s*draft|amend\s*b/?l|amended\s*b/?l)\b", all_content))
    has_si_keyword = bool(re.search(r"\b(shipping\s*instruction[s]?|\bsi\b)\b", all_content))
    has_compare_action = bool(re.search(r"\b(compare|cross-?check|review|verify|confirm docs|check details|check draft|checking|amend|mismatch|discrepancy)\b", text))

    # Check attachment filenames
    bl_att = any(re.search(r"(_bl\b|bl_|\bdraft_bl|bill_of_lading)", a.lower()) for a in att_names)
    si_att = any(re.search(r"(_si\b|si_|\bshipping_instruction)", a.lower()) for a in att_names)

    is_comparison = False
    if (bl_att and si_att) or (has_bl_keyword and (has_si_keyword or si_att) and has_compare_action) or (has_bl_keyword and has_compare_action) or "confirm docs" in text and (bl_att or si_att or has_bl_keyword) or ("for checking" in text or "amend bl" in text or "draft bl" in text) and (has_bl_keyword and has_compare_action) or bl_att and has_compare_action:
        is_comparison = True

    if is_comparison:
        missing_flag = _check_missing_attachments(EmailCategory.DOCUMENT_COMPARISON, attachment_previews)
        return EmailClassification(
            category=EmailCategory.DOCUMENT_COMPARISON,
            confidence=0.96,
            reasoning="Email requests verification, cross-checking, or confirmation between carrier draft BL and Shipping Instruction.",
            is_comparison_candidate=True,
            missing_attachments_flag=missing_flag,
            detected_attachments=att_names,
        )

    # 4. NEW_SI_REQUEST check
    si_request_keywords = [
        "shipping instruction", "si submission", "new si", "revised si",
        "amended si", "please file si", "booking creation", "find attached si"
    ]
    if (si_att or has_si_keyword) and any(re.search(rf"\b{k}\b", text) for k in si_request_keywords):
        return EmailClassification(
            category=EmailCategory.NEW_SI_REQUEST,
            confidence=0.93,
            reasoning="Sender is submitting initial or amended Shipping Instructions for filing without draft BL cross-checking.",
            is_comparison_candidate=False,
            missing_attachments_flag=False,
            detected_attachments=att_names,
        )

    # 5. GENERAL check
    general_keywords = [
        "schedule", "delay", "vessel", "cut-off", "eta", "etd", "voyage",
        "terminal", "advisory", "blank sailing", "congestion", "holiday", "inquiry"
    ]
    if any(re.search(rf"\b{k}\b", all_content) for k in general_keywords):
        return EmailClassification(
            category=EmailCategory.GENERAL,
            confidence=0.91,
            reasoning="Correspondence relates to operational vessel schedules, cut-offs, delay advisories, or general inquiries.",
            is_comparison_candidate=False,
            missing_attachments_flag=False,
            detected_attachments=att_names,
        )

    # Default fallback
    return EmailClassification(
        category=EmailCategory.GENERAL,
        confidence=0.80,
        reasoning="General maritime operational correspondence.",
        is_comparison_candidate=False,
        missing_attachments_flag=False,
        detected_attachments=att_names,
    )


def classify_email(
    email_id: str,
    subject: str,
    sender: str,
    body: str,
    attachment_previews: dict[str, str] | None = None,
) -> EmailClassification:
    """Classify an email using Gemini 1.5 Flash structured output with deterministic fallback.

    Args:
        email_id: Unique identifier of the email.
        subject: Subject line.
        sender: Sender address or name.
        body: Email body text.
        attachment_previews: Dict mapping attachment filename to text snippet (up to 1,000 chars).

    Returns:
        EmailClassification Pydantic model.
    """
    global client
    att_dict = attachment_previews or {}
    detected_att_names = list(att_dict.keys())

    # Build prompt content
    att_summary_parts = []
    for att_name, preview in att_dict.items():
        att_summary_parts.append(f"--- Attachment: {att_name} ---\n{preview}\n")
    att_summary = "\n".join(att_summary_parts) if att_summary_parts else "None"

    user_prompt = f"""Evaluate and triage the following incoming maritime shipping email:

Email ID: {email_id}
Sender: {sender}
Subject: {subject}
Body:
{body}

Attached Document Previews:
{att_summary}

Respond with the exact JSON matching EmailClassification schema."""

    # Vertex AI Live Inference on GCP (with graceful deterministic fallback)
    live_client = get_client()
    if live_client is not None:
        try:
            model_name = os.environ.get("PRIMARY_MODEL", "gemini-2.5-flash")
            response = live_client.models.generate_content(
                model=model_name,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema=EmailClassification,
                ),
            )

            result_text = (response.text or "").strip()
            if result_text.startswith("```"):
                lines = result_text.splitlines()
                if lines and lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip().startswith("```"):
                    lines = lines[:-1]
                result_text = "\n".join(lines).strip()

            classification = EmailClassification.model_validate_json(result_text)

            if not classification.detected_attachments and detected_att_names:
                classification.detected_attachments = detected_att_names

            classification.is_comparison_candidate = (
                classification.category == EmailCategory.DOCUMENT_COMPARISON
            )

            if (
                classification.category == EmailCategory.DOCUMENT_COMPARISON
                and _check_missing_attachments(classification.category, att_dict)
            ):
                classification.missing_attachments_flag = True

            return classification

        except ValidationError:
            raise
        except Exception as e:
            err_str = str(e).lower()
            if "429" in err_str or "resourceexhausted" in err_str or "rate limit" in err_str or "too many requests" in err_str:
                raise
            logger.warning(
                f"Vertex AI inference failed for {email_id}: {e}. Executing heuristic fallback."
            )

    # Deterministic rule-based heuristic classification fallback
    return _classify_with_heuristics(email_id, subject, sender, body, att_dict)

