"""Quick test script to verify Gemini API key and live model response."""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(override=True)

from backend.agents.classifier_flow import classify_email, get_client


def main():
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    print("\n=======================================================")
    print(" Gemini API Key & Classifier Live Connection Test")
    print("=======================================================")

    if not api_key:
        print("[!] GEMINI_API_KEY not found in .env or environment.")
        print("    Please paste your key into .env: GEMINI_API_KEY=AIzaSy...")
        print("    Currently running in deterministic rule-based fallback mode.\n")
    else:
        masked = api_key[:6] + "..." + api_key[-4:] if len(api_key) > 10 else "***"
        print(f"[+] Found API key: {masked}")

    client = get_client()
    if client is not None:
        print("[+] google.genai Client successfully initialized!")
    else:
        print("[-] google.genai Client is None (fallback mode active).")

    print("\n--- Testing Single Email Classification ---")
    result = classify_email(
        email_id="live_test_01",
        subject="TO CONFIRM DOCS _ 5RSG-00133 _ CALLAO_PERU",
        sender="willy@shipping.com",
        body="Hi team, Attached are the SI and draft BL for OC 5RSG-00133. Please check the details and confirm if anything is mismatched.",
        attachment_previews={
            "email_001_SI.txt": "Shipper: Moorim Paper\nConsignee: PaperOne Inc\nWeight: 24000kg",
            "email_001_BL.txt": "Shipper: Moorim Paper\nConsignee: PaperOne Inc\nWeight: 24000kg",
        },
    )

    print(f"Category:                {result.category.value}")
    print(f"Confidence:              {result.confidence:.2f}")
    print(f"Comparison Candidate:    {result.is_comparison_candidate}")
    print(f"Missing Attachments:     {result.missing_attachments_flag}")
    print(f"Reasoning:               {result.reasoning}")
    print(f"Detected Attachments:    {result.detected_attachments}")
    print("=======================================================\n")


if __name__ == "__main__":
    main()
