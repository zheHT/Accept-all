import type { CaseSummary, CaseStatus } from "@/lib/api";

export function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(date);
}

export function statusLabel(item: CaseSummary) {
  if (item.status === "OK") return "Matched";
  if (item.status === "MISMATCH") return "Mismatch";
  if (item.status === "NEEDS_REVIEW") return "Needs review";
  if (item.processing_state === "DEAD_LETTER") return "Failed";
  return item.processing_state.toLowerCase().replace("_", " ");
}

export function statusTone(status: CaseStatus, processing: CaseSummary["processing_state"]) {
  if (status === "OK") return "bg-matched-50 text-matched-700 ring-matched-200";
  if (status === "MISMATCH") return "bg-mismatch-50 text-mismatch-700 ring-mismatch-200";
  if (status === "NEEDS_REVIEW") return "bg-review-50 text-review-700 ring-review-200";
  if (processing === "DEAD_LETTER") return "bg-failed-50 text-failed-700 ring-failed-200";
  return "bg-processing-50 text-processing-700 ring-processing-200";
}

export function sanitizeBranding(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/ClassAll\s+Platform/gi, "ShipVerify Platform")
    .replace(/ClassAll/gi, "ShipVerify");
}

