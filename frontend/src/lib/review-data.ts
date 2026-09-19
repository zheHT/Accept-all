/**
 * Human review queue: cases the automated pipeline refused to decide.
 *
 * A case lands here when a value is missing, a document is unreadable, OCR is
 * uncertain, the SI and BL are ambiguous, or extraction confidence sits below
 * the verification threshold.
 */

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
    hint: "A human confirmed or corrected the value",
  },
};

/** Confidence below which the engine refuses to decide on its own. */
export const VERIFICATION_THRESHOLD = 0.85;

export interface DocumentEvidence {
  name: string;
  pages: number;
  scanned?: boolean;
  /** Excerpt from the document around the problem field. */
  snippet: string[];
  /** Index in `snippet` of the line that caused the uncertainty. */
  highlightIndex: number;
  /** Label the extractor matched, e.g. "Notify Party". */
  extractedLabel: string;
  /** Value the extractor read, or null when nothing usable was found. */
  extractedValue: string | null;
}

export interface ReviewDecision {
  type: "confirm" | "correct" | "unreadable";
  /** Final value after the human decision. */
  value: string | null;
  notes: string;
  reviewer: string;
  at: string;
}

export interface ReviewCase {
  id: string;
  caseId: string;
  shipment: string;
  problemField: string;
  /** One-line reason shown in the queue. */
  reason: string;
  reasonCode: ReviewReasonCode;
  /** Full explanation shown on the detail screen. */
  reasonDetail: string;
  confidence: number;
  status: ReviewStatus;
  created: string;
  createdOrder: number;
  si: DocumentEvidence;
  bl: DocumentEvidence;
  decision?: ReviewDecision;
}

export const REVIEW_SUMMARY = {
  pending: 15,
  unreadableOrMissing: 8,
  ambiguous: 7,
} as const;

export const REVIEW_CASES: ReviewCase[] = [
  {
    id: "1022",
    caseId: "#1022",
    shipment: "SHP-1022",
    problemField: "Notify Party",
    reason: "Unable to confidently extract BL value",
    reasonCode: "low_confidence",
    reasonDetail:
      "The system could not confidently determine the Notify Party from the Bill of Lading. The notify block on the scanned B/L returned 62% OCR confidence, below the 85% verification threshold.",
    confidence: 0.62,
    status: "pending",
    created: "12 min ago",
    createdOrder: 12,
    si: {
      name: "SI_1022.pdf",
      pages: 2,
      snippet: [
        "Consignee: Global Shipping Ltd",
        "12 Harbour Road, Singapore 099253",
        "Notify Party: Global Shipping Ltd",
        "Port of Loading: Singapore (SGSIN)",
      ],
      highlightIndex: 2,
      extractedLabel: "Notify Party",
      extractedValue: "Global Shipping Ltd",
    },
    bl: {
      name: "BL_1022.pdf",
      pages: 3,
      scanned: true,
      snippet: [
        "CONSIGNEE: GLOBAL SHIPPING LTD",
        "12 HARBOUR ROAD, SINGAPORE",
        "NOTIFY: [unreadable]",
        "PORT OF LOADING: SINGAPORE",
      ],
      highlightIndex: 2,
      extractedLabel: "Notify",
      extractedValue: null,
    },
  },
  {
    id: "1031",
    caseId: "#1031",
    shipment: "SHP-1031",
    problemField: "Gross Weight (kg)",
    reason: "BL value missing",
    reasonCode: "missing_information",
    reasonDetail:
      "The Bill of Lading states no gross weight in the cargo particulars block. The SI value cannot be assumed onto the B/L, so the field is left for a person to confirm.",
    confidence: 0.48,
    status: "pending",
    created: "18 min ago",
    createdOrder: 18,
    si: {
      name: "SI_1031.pdf",
      pages: 2,
      snippet: [
        "Container Count: 2 x 40HC",
        "Gross Weight: 26,480 KGS",
        "Measurement: 58.400 CBM",
      ],
      highlightIndex: 1,
      extractedLabel: "Gross Weight",
      extractedValue: "26,480",
    },
    bl: {
      name: "BL_1031.pdf",
      pages: 3,
      snippet: [
        "PARTICULARS FURNISHED BY SHIPPER",
        "2 X 40' HIGH CUBE CONTAINERS",
        "GROSS WEIGHT: ____________",
        "MEASUREMENT: 58.400 CBM",
      ],
      highlightIndex: 2,
      extractedLabel: "Gross Weight",
      extractedValue: null,
    },
  },
  {
    id: "1034",
    caseId: "#1034",
    shipment: "SHP-1034",
    problemField: "Port of Discharge",
    reason: "Document text is unreadable",
    reasonCode: "unreadable_document",
    reasonDetail:
      "The discharge port line on the scanned Bill of Lading came back at 55% OCR page quality. The characters could not be resolved reliably, so no value was recorded.",
    confidence: 0.55,
    status: "pending",
    created: "24 min ago",
    createdOrder: 24,
    si: {
      name: "SI_1034.pdf",
      pages: 2,
      snippet: [
        "Port of Loading: Jebel Ali (AEJEA)",
        "Port of Discharge: Valencia (ESVLC)",
        "Final Destination: Madrid",
      ],
      highlightIndex: 1,
      extractedLabel: "Port of Discharge",
      extractedValue: "ESVLC — Valencia",
    },
    bl: {
      name: "BL_1034_scan.pdf",
      pages: 3,
      scanned: true,
      snippet: [
        "PORT OF LOADING: JEBEL ALI",
        "PORT OF DISCHARGE: V▒L▒NC▒A / B▒RC▒L▒NA?",
        "PLACE OF DELIVERY: MADRID",
      ],
      highlightIndex: 1,
      extractedLabel: "Port of Discharge",
      extractedValue: null,
    },
  },
  {
    id: "1017",
    caseId: "#1017",
    shipment: "SHP-1017",
    problemField: "Gross Weight (kg)",
    reason: "No gross weight stated on the BL",
    reasonCode: "missing_information",
    reasonDetail:
      "The cargo block on the Bill of Lading has no weight line at all. Confirm the figure with the shipper before the draft is approved.",
    confidence: 0.48,
    status: "pending",
    created: "1 hr ago",
    createdOrder: 60,
    si: {
      name: "SI_1017.pdf",
      pages: 2,
      snippet: ["Container Count: 3", "Gross Weight: 31,200 KGS", "Commodity: Aluminium billets"],
      highlightIndex: 1,
      extractedLabel: "Gross Weight",
      extractedValue: "31,200",
    },
    bl: {
      name: "DRAFT_BL_1017.pdf",
      pages: 3,
      snippet: [
        "3 X 40' CONTAINERS",
        "ALUMINIUM BILLETS",
        "SHIPPER'S LOAD, STOW AND COUNT",
      ],
      highlightIndex: 2,
      extractedLabel: "Gross Weight",
      extractedValue: null,
    },
  },
  {
    id: "1015",
    caseId: "#1015",
    shipment: "SHP-1015",
    problemField: "Port of Discharge",
    reason: "OCR could read Valencia or Barcelona",
    reasonCode: "ambiguous_value",
    reasonDetail:
      "Two plausible readings were produced for the same line, and the engine will not pick between them. A reviewer must confirm which port appears on the document.",
    confidence: 0.55,
    status: "in_review",
    created: "2 hr ago",
    createdOrder: 120,
    si: {
      name: "SI_1015.pdf",
      pages: 2,
      snippet: ["Port of Loading: Jebel Ali (AEJEA)", "Port of Discharge: Valencia (ESVLC)"],
      highlightIndex: 1,
      extractedLabel: "Port of Discharge",
      extractedValue: "ESVLC — Valencia",
    },
    bl: {
      name: "BL_1015_scan.pdf",
      pages: 3,
      scanned: true,
      snippet: ["PORT OF LOADING: JEBEL ALI", "DISCHARGE: VAL▒NCIA (or BARC▒LONA)"],
      highlightIndex: 1,
      extractedLabel: "Discharge",
      extractedValue: null,
    },
  },
  {
    id: "1029",
    caseId: "#1029",
    shipment: "SHP-1029",
    problemField: "Shipper",
    reason: "SI and BL name related but different entities",
    reasonCode: "ambiguous_value",
    reasonDetail:
      "The two names are 71% similar and may be the same group trading under different legal entities. Because export declaration and L/C compliance depend on the shipper of record, the engine defers to a human.",
    confidence: 0.71,
    status: "pending",
    created: "3 hr ago",
    createdOrder: 180,
    si: {
      name: "SI_1029.pdf",
      pages: 2,
      snippet: ["Shipper: Meridian Foods SA", "Consignee: Santos Distribuidora Ltda"],
      highlightIndex: 0,
      extractedLabel: "Shipper",
      extractedValue: "Meridian Foods SA",
    },
    bl: {
      name: "DRAFT_BL_1029.pdf",
      pages: 3,
      snippet: ["SHIPPER: MERIDIAN FOODS GROUP SA", "CONSIGNEE: SANTOS DISTRIBUIDORA LTDA"],
      highlightIndex: 0,
      extractedLabel: "Shipper",
      extractedValue: "Meridian Foods Group SA",
    },
  },
  {
    id: "1027",
    caseId: "#1027",
    shipment: "SHP-1027",
    problemField: "Container Count",
    reason: "Two different counts found in the BL",
    reasonCode: "processing_issue",
    reasonDetail:
      "The container count appears twice on the Bill of Lading with conflicting values (3 in the particulars block, 4 in the container list). Conflicting information is never resolved automatically.",
    confidence: 0.57,
    status: "pending",
    created: "4 hr ago",
    createdOrder: 240,
    si: {
      name: "SI_1027.pdf",
      pages: 2,
      snippet: ["Container Count: 3", "Gross Weight: 29,700 KGS"],
      highlightIndex: 0,
      extractedLabel: "Container Count",
      extractedValue: "3",
    },
    bl: {
      name: "DRAFT_BL_1027.pdf",
      pages: 4,
      snippet: [
        "NO. OF CONTAINERS: 3",
        "CONTAINER LIST: MSKU1122334, MSKU5566778,",
        "MSKU9900112, TLLU4455667  (4 UNITS)",
      ],
      highlightIndex: 2,
      extractedLabel: "No. of Containers",
      extractedValue: "3 / 4",
    },
  },
  {
    id: "1012",
    caseId: "#1012",
    shipment: "SHP-1012",
    problemField: "Consignee",
    reason: "Low-confidence extraction",
    reasonCode: "low_confidence",
    reasonDetail:
      "The consignee block was extracted at 64% confidence from a faxed Bill of Lading.",
    confidence: 0.64,
    status: "resolved",
    created: "Yesterday",
    createdOrder: 1200,
    si: {
      name: "SI_1012.pdf",
      pages: 2,
      snippet: ["Consignee: Rotterdam Bulk Traders BV", "Notify Party: Same as consignee"],
      highlightIndex: 0,
      extractedLabel: "Consignee",
      extractedValue: "Rotterdam Bulk Traders BV",
    },
    bl: {
      name: "BL_1012_fax.pdf",
      pages: 3,
      scanned: true,
      snippet: ["CONSIGNEE: ROTTERD▒M BULK TR▒DERS BV", "NOTIFY: SAME AS CONSIGNEE"],
      highlightIndex: 0,
      extractedLabel: "Consignee",
      extractedValue: "Rotterdam Bulk Traders BV",
    },
    decision: {
      type: "confirm",
      value: "Rotterdam Bulk Traders BV",
      notes: "Cross-checked against the booking confirmation and the L/C.",
      reviewer: "Amara Chen",
      at: "18 Sep 2026, 11:05 AM",
    },
  },
];

export function findReviewCase(id: string): ReviewCase | undefined {
  return REVIEW_CASES.find((item) => item.id === id);
}
