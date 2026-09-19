import type { VerificationStatus } from "./status";

/**
 * Presentation fixtures for the dashboard. Every figure is shaped like the API
 * response it will eventually be fed from.
 */

export type Period = "day" | "week" | "month";

export interface PeriodBucket {
  label: string;
  value: number;
}

export interface PeriodData {
  id: Period;
  /** Label shown on the period switcher. */
  label: string;
  rangeLabel: string;
  /** Supporting copy for the total figure. */
  caption: string;
  total: number;
  matched: number;
  mismatch: number;
  needsReview: number;
  /** Percentage change in case volume against the previous period. */
  deltaPct: number;
  /** Case volume split into buckets for the trend chart. */
  volume: PeriodBucket[];
  avgTurnaround: string;
  /** Share of cases closed with no human touch. */
  autoCleared: number;
}

export const PERIODS: Record<Period, PeriodData> = {
  day: {
    id: "day",
    label: "Today",
    rangeLabel: "Sat 19 Sep 2026",
    caption: "Processed today",
    total: 24,
    matched: 16,
    mismatch: 5,
    needsReview: 3,
    deltaPct: 9,
    volume: [
      { label: "06", value: 1 },
      { label: "08", value: 3 },
      { label: "10", value: 5 },
      { label: "12", value: 4 },
      { label: "14", value: 6 },
      { label: "16", value: 3 },
      { label: "18", value: 2 },
      { label: "20", value: 0 },
    ],
    avgTurnaround: "5m 48s",
    autoCleared: 67,
  },
  week: {
    id: "week",
    label: "This week",
    rangeLabel: "15 – 21 Sep 2026",
    caption: "Processed this week",
    total: 128,
    matched: 92,
    mismatch: 21,
    needsReview: 15,
    deltaPct: 12,
    volume: [
      { label: "Mon", value: 14 },
      { label: "Tue", value: 22 },
      { label: "Wed", value: 19 },
      { label: "Thu", value: 26 },
      { label: "Fri", value: 24 },
      { label: "Sat", value: 15 },
      { label: "Sun", value: 8 },
    ],
    avgTurnaround: "6m 12s",
    autoCleared: 72,
  },
  month: {
    id: "month",
    label: "This month",
    rangeLabel: "September 2026",
    caption: "Processed this month",
    total: 512,
    matched: 371,
    mismatch: 84,
    needsReview: 57,
    deltaPct: -4,
    volume: [
      { label: "Wk 1", value: 96 },
      { label: "Wk 2", value: 118 },
      { label: "Wk 3", value: 141 },
      { label: "Wk 4", value: 157 },
    ],
    avgTurnaround: "6m 40s",
    autoCleared: 70,
  },
};

export const PERIOD_ORDER: Period[] = ["day", "week", "month"];

/** The three outcome slices shown in the donut, in drawing order. */
export interface OutcomeSlice {
  status: Extract<VerificationStatus, "matched" | "mismatch" | "needs_review">;
  label: string;
  support: string;
  value: number;
}

export function outcomeSlices(period: PeriodData): OutcomeSlice[] {
  return [
    {
      status: "matched",
      label: "Matched",
      support: "No discrepancies detected",
      value: period.matched,
    },
    {
      status: "mismatch",
      label: "Mismatches",
      support: "Require attention",
      value: period.mismatch,
    },
    {
      status: "needs_review",
      label: "Needs Review",
      support: "Human verification required",
      value: period.needsReview,
    },
  ];
}

export interface CaseRow {
  /** Matches the id in case-data.ts so rows can open the real case. */
  id: string;
  reference: string;
  counterparty: string;
  vessel: string;
  pol: string;
  pod: string;
  status: VerificationStatus;
  /** Fields that differ, or that could not be verified. */
  flaggedFields: string[];
  confidence: number;
  received: string;
}

export const ATTENTION_CASES: CaseRow[] = [
  {
    id: "1022",
    reference: "HLCU-DRAFT-8820",
    counterparty: "Atlas Forwarding Ltd",
    vessel: "Hapag Kobe / 117W",
    pol: "SGSIN",
    pod: "NLRTM",
    status: "needs_review",
    flaggedFields: ["Notify Party"],
    confidence: 0.62,
    received: "12 min ago",
  },
  {
    id: "1023",
    reference: "OOLU2298471",
    counterparty: "Pacific Rim Sourcing",
    vessel: "OOCL Utah / 021E",
    pol: "VNSGN",
    pod: "USLAX",
    status: "mismatch",
    flaggedFields: ["Container Count"],
    confidence: 0.96,
    received: "8 min ago",
  },
  {
    id: "1019",
    reference: "MAEU7741903",
    counterparty: "Nordwind Handels GmbH",
    vessel: "MSC Aurora / 438W",
    pol: "CNSHA",
    pod: "DEHAM",
    status: "mismatch",
    flaggedFields: ["Gross Weight"],
    confidence: 0.94,
    received: "35 min ago",
  },
  {
    id: "1020",
    reference: "CMDU4410557",
    counterparty: "Lusitania Trading SA",
    vessel: "CMA CGM Tage / 302E",
    pol: "ESVLC",
    pod: "BRSSZ",
    status: "mismatch",
    flaggedFields: ["Consignee"],
    confidence: 0.93,
    received: "26 min ago",
  },
  {
    id: "1017",
    reference: "ONEY8820134",
    counterparty: "Kyushu Metals Trading",
    vessel: "ONE Harbour / 044W",
    pol: "JPTYO",
    pod: "USSEA",
    status: "needs_review",
    flaggedFields: ["Gross Weight", "Notify Party"],
    confidence: 0.48,
    received: "1 hr ago",
  },
  {
    id: "1015",
    reference: "CMDU9917225",
    counterparty: "Levant Trading Co.",
    vessel: "CMA CGM Aden / 118W",
    pol: "AEJEA",
    pod: "ESVLC",
    status: "needs_review",
    flaggedFields: ["Port of Discharge"],
    confidence: 0.55,
    received: "2 hr ago",
  },
  {
    id: "1026",
    reference: "SI-ATL-55219",
    counterparty: "Kestrel Logistics BV",
    vessel: "Maersk Kotka / 519N",
    pol: "MYPKG",
    pod: "AEJEA",
    status: "failed",
    flaggedFields: ["Scanned BL unreadable"],
    confidence: 0,
    received: "5 min ago",
  },
  {
    id: "1025",
    reference: "EGLV0937712",
    counterparty: "Shenzhen Brightway Export",
    vessel: "Ever Given / 0812-051W",
    pol: "CNYTN",
    pod: "GBFXT",
    status: "processing",
    flaggedFields: [],
    confidence: 0,
    received: "Just now",
  },
];

export const TOTAL_OPEN_CASES = 36;
