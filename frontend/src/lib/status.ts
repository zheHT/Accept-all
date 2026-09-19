import {
  AlertOctagon,
  CheckCircle2,
  Loader,
  TriangleAlert,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";

/**
 * The five verification outcomes. Colour is reserved for these states only, so
 * green/red/amber/blue always carry the same meaning across the product.
 */
export type VerificationStatus =
  | "matched"
  | "mismatch"
  | "needs_review"
  | "processing"
  | "failed";

export interface StatusMeta {
  label: string;
  /** Short description used in tooltips and legends. */
  hint: string;
  icon: LucideIcon;
  /** Solid indicator dot. */
  dot: string;
  /** Translucent pill: background + text + inset ring. */
  chip: string;
  /** Tinted icon tile. */
  tile: string;
  /** Meter / progress fill. */
  bar: string;
  /** Donut gradient stops. */
  gradient: [string, string];
}

export const STATUS_META: Record<VerificationStatus, StatusMeta> = {
  matched: {
    label: "Matched",
    hint: "SI and BL agree on all seven verified fields",
    icon: CheckCircle2,
    dot: "bg-matched-500",
    chip: "bg-matched-50/85 text-matched-700 ring-1 ring-inset ring-matched-200",
    tile: "bg-gradient-to-br from-matched-50 to-surface text-matched-700 ring-1 ring-inset ring-matched-200",
    bar: "bg-matched-500",
    // Chart ramps are tuned as a set: same chroma and lightness family so the
    // three outcomes sit together harmoniously instead of fighting each other.
    gradient: ["#3fb98a", "#1c8a67"],
  },
  mismatch: {
    label: "Mismatch",
    hint: "At least one field differs between SI and BL",
    icon: AlertOctagon,
    dot: "bg-mismatch-500",
    chip: "bg-mismatch-50/85 text-mismatch-700 ring-1 ring-inset ring-mismatch-200",
    tile: "bg-gradient-to-br from-mismatch-50 to-surface text-mismatch-700 ring-1 ring-inset ring-mismatch-200",
    bar: "bg-mismatch-500",
    gradient: ["#e8697c", "#c2455c"],
  },
  needs_review: {
    label: "Needs Review",
    hint: "Extraction was incomplete or uncertain — a human must confirm",
    icon: UserRoundSearch,
    dot: "bg-review-500",
    chip: "bg-review-50/85 text-review-700 ring-1 ring-inset ring-review-200",
    tile: "bg-gradient-to-br from-review-50 to-surface text-review-700 ring-1 ring-inset ring-review-200",
    bar: "bg-review-500",
    gradient: ["#e9b055", "#c78a2a"],
  },
  processing: {
    label: "Processing",
    hint: "Classification and extraction agents are still running",
    icon: Loader,
    dot: "bg-processing-500",
    chip: "bg-processing-50/85 text-processing-700 ring-1 ring-inset ring-processing-200",
    tile: "bg-gradient-to-br from-processing-50 to-surface text-processing-700 ring-1 ring-inset ring-processing-200",
    bar: "bg-processing-500",
    gradient: ["#4a92e0", "#1f63b4"],
  },
  failed: {
    label: "Failed",
    hint: "The document could not be processed at all",
    icon: TriangleAlert,
    dot: "bg-failed-500",
    chip: "bg-failed-50/85 text-failed-700 ring-1 ring-inset ring-failed-200",
    tile: "bg-gradient-to-br from-failed-50 to-surface text-failed-700 ring-1 ring-inset ring-failed-200",
    bar: "bg-failed-500",
    gradient: ["#d4772f", "#9c4712"],
  },
};
