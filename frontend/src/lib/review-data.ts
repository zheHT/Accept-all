export type ReviewReasonCode =
  | "missing_information"
  | "unreadable_document"
  | "low_confidence"
  | "ambiguous_value"
  | "processing_issue";

export type ReviewStatus = "pending" | "in_review" | "resolved";

export const REVIEW_REASON_LABELS: Record<ReviewReasonCode, string> = {
  missing_information: "Missing Information",
  unreadable_document: "Unreadable Document",
  low_confidence: "Low Confidence",
  ambiguous_value: "Ambiguous Value",
  processing_issue: "Processing Issue",
};

export const REVIEW_STATUS_META: Record<
  ReviewStatus,
  { label: string; chip: string; dot: string; hint: string }
> = {
  pending: {
    label: "Pending Review",
    chip: "bg-review-50/85 text-review-700 ring-1 ring-inset ring-review-200",
    dot: "bg-review-500",
    hint: "Human action is required",
  },
  in_review: {
    label: "In Review",
    chip: "bg-processing-50/85 text-processing-700 ring-1 ring-inset ring-processing-200",
    dot: "bg-processing-500",
    hint: "A reviewer has opened this case",
  },
  resolved: {
    label: "Resolved",
    chip: "bg-matched-50/85 text-matched-700 ring-1 ring-inset ring-matched-200",
    dot: "bg-matched-500",
    hint: "A human approved or declined this case",
  },
};

export const VERIFICATION_THRESHOLD = 0.85;

export interface DocumentEvidence {
  name: string;
  pages: number;
  scanned?: boolean;
  snippet: string[];
  highlightIndex: number;
  extractedLabel: string;
  extractedValue: string | null;
}

export interface ReviewDecision {
  type: "confirm" | "correct" | "unreadable";
  value: string | null;
  notes: string;
  reviewer: string;
  at: string;
}

/** Visual model used by the restored main-branch review queue and detail view. */
export interface ReviewCase {
  id: string;
  caseId: string;
  shipment: string;
  problemField: string;
  reason: string;
  reasonCode: ReviewReasonCode;
  reasonDetail: string;
  confidence: number;
  status: ReviewStatus;
  created: string;
  createdOrder: number;
  si: DocumentEvidence;
  bl: DocumentEvidence;
  decision?: ReviewDecision;
}
