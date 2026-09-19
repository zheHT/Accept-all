import type { VerificationStatus } from "./status";

/** Presentation types shared by the live dashboard components. */
export type Period = "day" | "week" | "month";

export interface PeriodBucket {
  label: string;
  value: number;
}

export interface PeriodData {
  id: Period;
  label: string;
  rangeLabel: string;
  caption: string;
  total: number;
  matched: number;
  mismatch: number;
  needsReview: number;
  deltaPct: number;
  volume: PeriodBucket[];
  avgTurnaround: string;
  autoCleared: number;
}

export const PERIOD_ORDER: Period[] = ["day", "week", "month"];

export interface OutcomeSlice {
  status: Extract<VerificationStatus, "matched" | "mismatch" | "needs_review">;
  label: string;
  support: string;
  value: number;
}

export function outcomeSlices(period: PeriodData): OutcomeSlice[] {
  return [
    { status: "matched", label: "Matched", support: "No discrepancies detected", value: period.matched },
    { status: "mismatch", label: "Mismatches", support: "Require attention", value: period.mismatch },
    { status: "needs_review", label: "Needs Review", support: "Human verification required", value: period.needsReview },
  ];
}

export interface CaseRow {
  id: string;
  reference: string;
  counterparty: string;
  /** Email subject. Kept under the original view-model key for visual compatibility. */
  vessel: string;
  pol: string;
  pod: string;
  status: VerificationStatus;
  flaggedFields: string[];
  confidence: number;
  received: string;
}
