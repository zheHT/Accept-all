import { REQUIRED_FIELDS, type VerificationCase } from "./case-data";

/**
 * Builds the text shown in the document preview.
 *
 * SI and BL previews are rendered from the values the extraction agent recorded
 * on the verification case, so what the reviewer reads is exactly what the
 * comparison used. Lines that could not be read, or that disagree with the SI,
 * are flagged so the preview highlights them.
 */

export interface DocumentBody {
  lines: string[];
  /** Indexes in `lines` that caused a problem, highlighted in the preview. */
  problemLines: number[];
}

function header(title: string, reference: string | null): string[] {
  return [
    title,
    reference ? `Booking / B/L No.: ${reference}` : "Reference: not stated",
    "Date of issue: 19 Sep 2026",
    "",
  ];
}

export function caseDocumentBody(
  verificationCase: VerificationCase,
  role: "SI" | "BL",
): DocumentBody {
  const title = role === "SI" ? "SHIPPING INSTRUCTION" : "BILL OF LADING (DRAFT)";
  const lines = header(title, verificationCase.carrierRef);
  const problemLines: number[] = [];

  for (const key of REQUIRED_FIELDS) {
    const field = verificationCase.fields.find((entry) => entry.field === key);
    const value = role === "SI" ? field?.si : field?.bl;
    const unreadable =
      role === "BL" && (field?.result === "missing" || field?.result === "uncertain");
    const pending = role === "BL" && field?.result === "pending";

    const printed = value ?? (pending ? "[not yet extracted]" : "[unreadable]");
    lines.push(`${key}: ${printed}`);

    if (unreadable || (role === "BL" && field?.result === "mismatch")) {
      problemLines.push(lines.length - 1);
    }
  }

  lines.push("");
  lines.push(
    role === "SI"
      ? "Shipper's declaration: particulars furnished by the shipper."
      : "Carrier's receipt: particulars furnished by the shipper, weight and contents unknown.",
  );

  return { lines, problemLines };
}

/** Fallback preview when nothing has been extracted for the attachment yet. */
export function pendingDocumentBody(filename: string, sender: string): DocumentBody {
  return {
    lines: [
      "EXTRACTION NOT COMPLETE",
      "",
      `${filename} was received from ${sender} but no verification case has`,
      "been opened for it yet, so no field values have been extracted.",
      "",
      "Open the verification case to run extraction and see the",
      "field-by-field comparison.",
    ],
    problemLines: [0],
  };
}
