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

/**
 * Builds complete document text for display on the review queue and dual comparison modal.
 * Uses raw_text when available, or formats all 7 verified contract fields.
 */
export function buildDocumentLines(
  role: "SI" | "BL",
  doc?: { raw_text?: string | null; filename?: string } | null,
  comparisons?: Array<{
    field: string;
    label: string;
    si: { value?: string | number | null; unit?: string | null; evidence?: string | null };
    bl: { value?: string | number | null; unit?: string | null; evidence?: string | null };
    matches?: boolean;
    low_confidence?: boolean;
  }> | null,
  problemField?: string | null,
): DocumentBody {
  if (doc?.raw_text && doc.raw_text.trim().length > 0) {
    const lines = doc.raw_text.trim().split(/\r?\n/);
    const problemLines: number[] = [];

    if (problemField) {
      const normalizedProblem = problemField.toLowerCase().replace(/[^a-z0-9]/g, "");
      lines.forEach((line, idx) => {
        const normalizedLine = line.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
          normalizedLine.includes(normalizedProblem) ||
          (normalizedProblem.includes("shipper") && normalizedLine.includes("shipper")) ||
          (normalizedProblem.includes("consignee") &&
            (normalizedLine.includes("consignee") || normalizedLine.includes("totheorder"))) ||
          (normalizedProblem.includes("notify") && normalizedLine.includes("notify")) ||
          (normalizedProblem.includes("portofloading") &&
            (normalizedLine.includes("portofloading") ||
              normalizedLine.includes("loadport") ||
              normalizedLine.includes("pol"))) ||
          (normalizedProblem.includes("portofdischarge") &&
            (normalizedLine.includes("portofdischarge") ||
              normalizedLine.includes("dischargeport") ||
              normalizedLine.includes("pod"))) ||
          (normalizedProblem.includes("container") && normalizedLine.includes("container")) ||
          (normalizedProblem.includes("grossweight") &&
            (normalizedLine.includes("grossweight") ||
              normalizedLine.includes("grosswt") ||
              normalizedLine.includes("weight")))
        ) {
          problemLines.push(idx);
        }
      });
    }

    if (comparisons) {
      comparisons.forEach((comp) => {
        if (!comp.matches || comp.low_confidence) {
          const compField = comp.label.toLowerCase().replace(/[^a-z0-9]/g, "");
          lines.forEach((line, idx) => {
            if (
              line.toLowerCase().replace(/[^a-z0-9]/g, "").includes(compField) &&
              !problemLines.includes(idx)
            ) {
              problemLines.push(idx);
            }
          });
        }
      });
    }

    return { lines, problemLines };
  }

  const title = role === "SI" ? "SHIPPING INSTRUCTION" : "BILL OF LADING (DRAFT)";
  const lines: string[] = [
    title,
    "========================================",
    "",
  ];
  const problemLines: number[] = [];

  for (const fieldName of REQUIRED_FIELDS) {
    const comp = comparisons?.find(
      (c) =>
        c.label.toLowerCase() === fieldName.toLowerCase() ||
        c.field.toLowerCase() === fieldName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
    );

    const valObj = role === "SI" ? comp?.si : comp?.bl;
    const rawVal = valObj?.value;
    const unit = valObj?.unit;
    const valText =
      rawVal !== null && rawVal !== undefined
        ? `${rawVal}${unit ? ` ${unit}` : ""}`
        : role === "BL" && comp?.matches === false
          ? "[mismatch / unreadable]"
          : "[not specified]";

    lines.push(`${fieldName}: ${valText}`);

    const isProblem =
      (problemField && fieldName.toLowerCase() === problemField.toLowerCase()) ||
      (role === "BL" && (comp?.matches === false || comp?.low_confidence));

    if (isProblem) {
      problemLines.push(lines.length - 1);
    }
  }

  lines.push("");
  lines.push(
    role === "SI"
      ? "Shipper's declaration: particulars furnished by shipper."
      : "Carrier's receipt: particulars furnished by shipper, weight and count unknown.",
  );

  return { lines, problemLines };
}
