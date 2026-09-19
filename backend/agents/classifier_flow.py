"""Triage classifier agent for maritime shipping correspondence using Gemini 1.5 Flash."""
import json
import logging
import os
import re
from typing import Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types

from backend.models.schemas import EmailCategory, EmailClassification

load_dotenv()
logger = logging.getLogger(__name__)

client: Optional[genai.Client] = None


def get_client() -> Optional[genai.Client]:
    """Retrieve or dynamically initialize the GenAI Client when API key is available."""
    global client
    if client is not None:
        return client
    load_dotenv(override=True)
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            logger.info("Successfully initialized google.genai Client with API key.")
        except Exception as e:
            logger.warning(f"Could not initialize google.genai Client: {e}. Fallback enabled.")
            client = None
    return client


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
    attachment_previews: Optional[dict[str, str]],
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
    for name, content in attachment_previews.items():
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
    attachment_previews: Optional[dict[str, str]] = None,
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
    if (bl_att and si_att) or (has_bl_keyword and (has_si_keyword or si_att) and has_compare_action) or (has_bl_keyword and has_compare_action):
        is_comparison = True
    elif "confirm docs" in text and (bl_att or si_att or has_bl_keyword):
        is_comparison = True
    elif ("for checking" in text or "amend bl" in text or "draft bl" in text) and (has_bl_keyword and has_compare_action):
        is_comparison = True
    elif bl_att and has_compare_action:
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
    attachment_previews: Optional[dict[str, str]] = None,
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

    # FORCE LIVE GEMINI 1.5 FLASH CALL (Fallback disabled per Task 3)
    load_dotenv(override=True)
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        err_msg = (
            "GEMINI_API_KEY is not set in environment or .env file! "
            "Offline heuristic fallback is currently disabled to test real Gemini API calls. "
            "Please add GEMINI_API_KEY to your .env file or environment."
        )
        logger.error(err_msg)
        raise RuntimeError(err_msg)

    import traceback

    try:
        live_client = genai.Client(api_key=api_key)
        response = live_client.models.generate_content(
            model="gemini-1.5-flash",
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.0,
                response_mime_type="application/json",
                response_schema=EmailClassification,
            ),
        )

        result_text = response.text
        classification = EmailClassification.model_validate_json(result_text)

        # Ensure detected_attachments includes input attachments if LLM left it empty
        if not classification.detected_attachments and detected_att_names:
            classification.detected_attachments = detected_att_names

        # Enforce strict candidate rule: strictly True for DOCUMENT_COMPARISON
        classification.is_comparison_candidate = (
            classification.category == EmailCategory.DOCUMENT_COMPARISON
        )

        # Post-processing guardrail: check missing/unreadable attachments
        if classification.category == EmailCategory.DOCUMENT_COMPARISON:
            if _check_missing_attachments(classification.category, att_dict):
                classification.missing_attachments_flag = True

        return classification

    except Exception as e:
        stack_trace = traceback.format_exc()
        logger.error(f"Live Gemini API call failed for email {email_id}:\n{stack_trace}")
        print(f"\n[ERROR] Live Gemini API call failed for {email_id}: {e}\n{stack_trace}")
        raise

