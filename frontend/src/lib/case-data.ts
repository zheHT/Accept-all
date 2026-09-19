import type { VerificationStatus } from "./status";

/**
 * Verification cases: emails classified as Document Comparison Requests that
 * continued into SI vs BL extraction and validation. Spam and other categories
 * never reach this list.
 */

/** The seven fields the validation engine must agree on. */
export const REQUIRED_FIELDS = [
  "Shipper",
  "Consignee",
  "Notify Party",
  "Port of Loading",
  "Port of Discharge",
  "Container Count",
  "Gross Weight (kg)",
] as const;

export type FieldName = (typeof REQUIRED_FIELDS)[number];

/** Per-field verdict. `pending` means extraction has not finished yet. */
export type FieldResult = "match" | "mismatch" | "uncertain" | "missing" | "pending";

export interface FieldComparison {
  field: FieldName;
  si: string | null;
  bl: string | null;
  result: FieldResult;
  note: string | null;
}

/** Case lifecycle, tracked separately from the verification result. */
export type CaseWorkflow = "open" | "in_review" | "resolved";

export type CaseAction = "view" | "review" | "retry";

export interface VerificationCase {
  /** Numeric part, also used in URLs. */
  id: string;
  caseId: string;
  shipment: string;
  carrierRef: string | null;
  sourceEmailSubject: string;
  sourceEmailSender: string;
  sourceEmailReceived: string;
  documents: {
    si: { name: string; pages: number } | null;
    bl: { name: string; pages: number; scanned?: boolean } | null;
  };
  /** Fields successfully checked, or null when nothing could be read. */
  fieldsChecked: number | null;
  result: VerificationStatus;
  /** Short label for the Issue column. */
  issue: string | null;
  /** Secondary line under the issue, e.g. "SI: 3 → BL: 4". */
  issueDetail: string | null;
  /** Longer explanation shown on hover. */
  issueContext: string | null;
  updated: string;
  updatedOrder: number;
  dateBucket: "today" | "week" | "earlier";
  workflow: CaseWorkflow;
  action: CaseAction;
  confidence: number;
  fields: FieldComparison[];
}

type FieldTuple = [si: string | null, bl: string | null, result: FieldResult, note?: string];

function buildFields(values: FieldTuple[]): FieldComparison[] {
  return REQUIRED_FIELDS.map((field, index) => {
    const [si, bl, result, note] = values[index];
    return { field, si, bl, result, note: note ?? null };
  });
}

export const VERIFICATION_CASES: VerificationCase[] = [
  {
    id: "1028",
    caseId: "#1028",
    shipment: "SHP-1028",
    carrierRef: "MAEU8830217",
    sourceEmailSubject: "Please verify draft Bill of Lading",
    sourceEmailSender: "ABC Logistics",
    sourceEmailReceived: "Today, 10:42 AM",
    documents: {
      si: { name: "SI_MAEU8830217.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_MAEU8830217.pdf", pages: 3 },
    },
    fieldsChecked: 2,
    result: "processing",
    issue: "Extraction in progress",
    issueDetail: "2 of 7 fields extracted",
    issueContext:
      "The case was opened from the inbox a moment ago. Fields appear here as each one is extracted and normalized.",
    updated: "1 min ago",
    updatedOrder: 1,
    dateBucket: "today",
    workflow: "open",
    action: "view",
    confidence: 0,
    fields: buildFields([
      ["ABC Logistics Ltd", "ABC Logistics Ltd", "match"],
      ["Bremen Handelshaus GmbH", "Bremen Handelshaus GmbH", "match"],
      ["Bremen Handelshaus GmbH", null, "pending"],
      ["CNSHA — Shanghai", null, "pending"],
      ["DEBRV — Bremerhaven", null, "pending"],
      ["2", null, "pending"],
      ["22,780", null, "pending"],
    ]),
  },
  {
    id: "1025",
    caseId: "#1025",
    shipment: "SHP-1025",
    carrierRef: "EGLV0937712",
    sourceEmailSubject: "Please check attached draft BL",
    sourceEmailSender: "Shenzhen Brightway Export",
    sourceEmailReceived: "Today, 11:48 AM",
    documents: {
      si: { name: "SI_1025.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1025.pdf", pages: 3 },
    },
    fieldsChecked: 4,
    result: "processing",
    issue: "BL extraction in progress",
    issueDetail: "4 of 7 fields extracted",
    issueContext:
      "The B/L text layer is still being parsed. Results appear as each field is normalized.",
    updated: "Just now",
    updatedOrder: 0,
    dateBucket: "today",
    workflow: "open",
    action: "view",
    confidence: 0,
    fields: buildFields([
      ["Shenzhen Brightway Export Co., Ltd", "Shenzhen Brightway Export Co., Ltd", "match"],
      ["Britannia Housewares Ltd", "Britannia Housewares Ltd", "match"],
      ["Britannia Housewares Ltd", "Britannia Housewares Ltd", "match"],
      ["CNYTN — Yantian", "CNYTN — Yantian", "match"],
      ["GBFXT — Felixstowe", null, "pending"],
      ["3", null, "pending"],
      ["21,340", null, "pending"],
    ]),
  },
  {
    id: "1024",
    caseId: "#1024",
    shipment: "SHP-1024",
    carrierRef: "ONEY4417802",
    sourceEmailSubject: "Draft BL Verification",
    sourceEmailSender: "Ocean Freight Services",
    sourceEmailReceived: "Today, 11:44 AM",
    documents: {
      si: { name: "SI_1024.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1024.pdf", pages: 3 },
    },
    fieldsChecked: 7,
    result: "matched",
    issue: null,
    issueDetail: null,
    issueContext: "All seven required fields agree between the SI and the draft B/L.",
    updated: "2 min ago",
    updatedOrder: 2,
    dateBucket: "today",
    workflow: "resolved",
    action: "view",
    confidence: 0.97,
    fields: buildFields([
      ["Kyushu Metals Trading K.K.", "KYUSHU METALS TRADING K.K.", "match"],
      ["Pacific Alloys Inc.", "Pacific Alloys Inc.", "match"],
      ["Pacific Alloys Inc. — Attn: J. Marsh", "Pacific Alloys Inc.", "match", "Attention line ignored during normalization"],
      ["JPYOK — Yokohama", "JPYOK — Yokohama", "match"],
      ["USOAK — Oakland", "USOAK — Oakland", "match"],
      ["2", "2 x 40HC", "match", "Normalized from container-size notation"],
      ["26,480", "26,480", "match"],
    ]),
  },
  {
    id: "1023",
    caseId: "#1023",
    shipment: "SHP-1023",
    carrierRef: "OOLU2298471",
    sourceEmailSubject: "Please verify draft Bill of Lading",
    sourceEmailSender: "Pacific Rim Sourcing",
    sourceEmailReceived: "Today, 11:38 AM",
    documents: {
      si: { name: "SI_1023.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1023.pdf", pages: 3 },
    },
    fieldsChecked: 7,
    result: "mismatch",
    issue: "Container Count",
    issueDetail: "SI: 3 → BL: 4",
    issueContext:
      "The SI instructs 3 containers; the draft B/L lists 4. Reconcile against the packing list and equipment release before approving the draft.",
    updated: "8 min ago",
    updatedOrder: 8,
    dateBucket: "today",
    workflow: "open",
    action: "view",
    confidence: 0.96,
    fields: buildFields([
      ["Pacific Rim Sourcing Pte Ltd", "Pacific Rim Sourcing Pte Ltd", "match"],
      ["Western States Distribution LLC", "Western States Distribution LLC", "match"],
      ["Western States Distribution LLC", "Western States Distribution LLC", "match"],
      ["VNSGN — Ho Chi Minh", "VNSGN — Ho Chi Minh", "match"],
      ["USLAX — Los Angeles", "USLAX — Los Angeles", "match"],
      ["3", "4", "mismatch", "SI instructs 3 containers, B/L lists 4"],
      ["32,910", "32,910", "match"],
    ]),
  },
  {
    id: "1022",
    caseId: "#1022",
    shipment: "SHP-1022",
    carrierRef: "HLCU-DRAFT-8820",
    sourceEmailSubject: "Shipment document check",
    sourceEmailSender: "Atlas Forwarding Ltd",
    sourceEmailReceived: "Today, 11:34 AM",
    documents: {
      si: { name: "SI_1022.pdf", pages: 2 },
      bl: { name: "BL_1022.pdf", pages: 3, scanned: true },
    },
    fieldsChecked: 6,
    result: "needs_review",
    issue: "Notify Party",
    issueDetail: "Unable to confidently extract BL value",
    issueContext:
      "The notify party block on the scanned B/L returned 62% OCR confidence. The system will not guess — a person must confirm the value.",
    updated: "12 min ago",
    updatedOrder: 12,
    dateBucket: "today",
    workflow: "open",
    action: "review",
    confidence: 0.62,
    fields: buildFields([
      ["Atlas Forwarding Ltd", "Atlas Forwarding Ltd", "match"],
      ["Global Shipping Ltd", "Global Shipping Ltd", "match"],
      ["Global Shipping Ltd", null, "uncertain", "OCR returned unreadable text for the notify block (62% confidence)"],
      ["SGSIN — Singapore", "SGSIN — Singapore", "match"],
      ["NLRTM — Rotterdam", "NLRTM — Rotterdam", "match"],
      ["4", "4", "match"],
      ["28,150", "28,150", "match"],
    ]),
  },
  {
    id: "1021",
    caseId: "#1021",
    shipment: "SHP-1021",
    carrierRef: "MSCU6610284",
    sourceEmailSubject: "BL confirmation",
    sourceEmailSender: "Baltic Trade Partners",
    sourceEmailReceived: "Today, 11:28 AM",
    documents: {
      si: { name: "SI_1021.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1021.pdf", pages: 2 },
    },
    fieldsChecked: 7,
    result: "matched",
    issue: null,
    issueDetail: null,
    issueContext: "All seven required fields agree between the SI and the draft B/L.",
    updated: "18 min ago",
    updatedOrder: 18,
    dateBucket: "today",
    workflow: "resolved",
    action: "view",
    confidence: 0.95,
    fields: buildFields([
      ["Baltic Trade Partners AB", "Baltic Trade Partners AB", "match"],
      ["Antwerp Steel Works NV", "Antwerp Steel Works NV", "match"],
      ["Antwerp Steel Works NV", "Antwerp Steel Works NV", "match"],
      ["CNNGB — Ningbo", "CNNGB — Ningbo", "match"],
      ["BEANR — Antwerp", "BEANR — Antwerp", "match"],
      ["1", "1 x 20GP", "match", "Normalized from container-size notation"],
      ["14,720", "14,720.00", "match", "Equal within rounding tolerance"],
    ]),
  },
  {
    id: "1026",
    caseId: "#1026",
    shipment: "SHP-1026",
    carrierRef: "SI-ATL-55219",
    sourceEmailSubject: "Draft BL verification",
    sourceEmailSender: "Kestrel Logistics BV",
    sourceEmailReceived: "Today, 11:20 AM",
    documents: {
      si: { name: "SI_1026.pdf", pages: 2 },
      bl: { name: "BL_1026_scan.pdf", pages: 3, scanned: true },
    },
    fieldsChecked: null,
    result: "failed",
    issue: "BL could not be read",
    issueDetail: "No text layer and OCR below threshold",
    issueContext:
      "The B/L is an image-only PDF and OCR returned 31% page quality. Nothing was extracted, so no comparison was attempted.",
    updated: "5 min ago",
    updatedOrder: 5,
    dateBucket: "today",
    workflow: "open",
    action: "retry",
    confidence: 0,
    fields: buildFields([
      ["Kestrel Logistics BV", null, "missing", "B/L unreadable"],
      ["Jebel Ali Trading FZE", null, "missing", "B/L unreadable"],
      ["Jebel Ali Trading FZE", null, "missing", "B/L unreadable"],
      ["MYPKG — Port Klang", null, "missing", "B/L unreadable"],
      ["AEJEA — Jebel Ali", null, "missing", "B/L unreadable"],
      ["2", null, "missing", "B/L unreadable"],
      ["19,880", null, "missing", "B/L unreadable"],
    ]),
  },
  {
    id: "1020",
    caseId: "#1020",
    shipment: "SHP-1020",
    carrierRef: "CMDU4410557",
    sourceEmailSubject: "Verify consignee on draft BL",
    sourceEmailSender: "Lusitania Trading SA",
    sourceEmailReceived: "Today, 11:12 AM",
    documents: {
      si: { name: "SI_1020.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1020.pdf", pages: 3 },
    },
    fieldsChecked: 7,
    result: "mismatch",
    issue: "Consignee",
    issueDetail: "SI: Meridian Foods SA → BL: Meridian Produce SA",
    issueContext:
      "A different legal entity appears as consignee on the B/L. Cargo release and title transfer depend on this field — confirm in writing with the shipper before the carrier reissues.",
    updated: "26 min ago",
    updatedOrder: 26,
    dateBucket: "today",
    workflow: "open",
    action: "view",
    confidence: 0.93,
    fields: buildFields([
      ["Lusitania Trading SA", "Lusitania Trading SA", "match"],
      ["Meridian Foods SA", "Meridian Produce SA", "mismatch", "Different legal entity named as consignee"],
      ["Meridian Foods SA", "Meridian Foods SA", "match"],
      ["ESVLC — Valencia", "ESVLC — Valencia", "match"],
      ["BRSSZ — Santos", "BRSSZ — Santos", "match"],
      ["2", "2", "match"],
      ["23,400", "23,400", "match"],
    ]),
  },
  {
    id: "1019",
    caseId: "#1019",
    shipment: "SHP-1019",
    carrierRef: "MAEU7741903",
    sourceEmailSubject: "Check gross weight on BL",
    sourceEmailSender: "Nordwind Handels GmbH",
    sourceEmailReceived: "Today, 11:03 AM",
    documents: {
      si: { name: "SI_1019.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1019.pdf", pages: 3 },
    },
    fieldsChecked: 7,
    result: "mismatch",
    issue: "Gross Weight (kg)",
    issueDetail: "SI: 24,500 kg → BL: 24,050 kg",
    issueContext:
      "A 450 kg (1.8%) difference. Request the VGM certificate and have the carrier correct the B/L — an incorrect verified gross mass is a SOLAS compliance issue.",
    updated: "35 min ago",
    updatedOrder: 35,
    dateBucket: "today",
    workflow: "in_review",
    action: "view",
    confidence: 0.94,
    fields: buildFields([
      ["Nordwind Handels GmbH", "Nordwind Handels GmbH", "match"],
      ["Hamburg Import Handel GmbH", "Hamburg Import Handel GmbH", "match"],
      ["Hamburg Import Handel GmbH", "Hamburg Import Handel GmbH", "match"],
      ["CNSHA — Shanghai", "CNSHA — Shanghai", "match"],
      ["DEHAM — Hamburg", "DEHAM — Hamburg", "match"],
      ["2", "2", "match"],
      ["24,500", "24,050", "mismatch", "Difference of 450 kg (1.8%)"],
    ]),
  },
  {
    id: "1018",
    caseId: "#1018",
    shipment: "SHP-1018",
    carrierRef: "HLCU7719043",
    sourceEmailSubject: "SI vs BL check — Hamburg sailing",
    sourceEmailSender: "Rheinmetall Spedition",
    sourceEmailReceived: "Today, 10:52 AM",
    documents: {
      si: { name: "SI_1018.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1018.pdf", pages: 2 },
    },
    fieldsChecked: 7,
    result: "matched",
    issue: null,
    issueDetail: null,
    issueContext: "All seven required fields agree between the SI and the draft B/L.",
    updated: "42 min ago",
    updatedOrder: 42,
    dateBucket: "today",
    workflow: "resolved",
    action: "view",
    confidence: 0.98,
    fields: buildFields([
      ["Rheinmetall Spedition GmbH", "Rheinmetall Spedition GmbH", "match"],
      ["Qingdao Machinery Import Co.", "Qingdao Machinery Import Co.", "match"],
      ["Qingdao Machinery Import Co.", "Qingdao Machinery Import Co.", "match"],
      ["DEHAM — Hamburg", "DEHAM — Hamburg", "match"],
      ["CNTAO — Qingdao", "CNTAO — Qingdao", "match"],
      ["1", "1", "match"],
      ["12,060", "12,060", "match"],
    ]),
  },
  {
    id: "1017",
    caseId: "#1017",
    shipment: "SHP-1017",
    carrierRef: "ONEY8820134",
    sourceEmailSubject: "Please cross-check documents",
    sourceEmailSender: "Kyushu Metals Trading",
    sourceEmailReceived: "Today, 10:31 AM",
    documents: {
      si: { name: "SI_1017.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1017.pdf", pages: 3 },
    },
    fieldsChecked: 5,
    result: "needs_review",
    issue: "Gross Weight (kg)",
    issueDetail: "BL value missing",
    issueContext:
      "The B/L states no gross weight in the cargo block, and the SI value cannot be assumed. Confirm with the shipper, then reprocess.",
    updated: "1 hr ago",
    updatedOrder: 60,
    dateBucket: "today",
    workflow: "open",
    action: "review",
    confidence: 0.48,
    fields: buildFields([
      ["Kyushu Metals Trading K.K.", "Kyushu Metals Trading K.K.", "match"],
      ["Oakland Alloy Supply Inc.", "Oakland Alloy Supply Inc.", "match"],
      ["Oakland Alloy Supply Inc.", null, "uncertain", "Notify block reads 'SAME AS ABOVE' — needs confirmation"],
      ["JPTYO — Tokyo", "JPTYO — Tokyo", "match"],
      ["USSEA — Seattle", "USSEA — Seattle", "match"],
      ["3", "3", "match"],
      ["31,200", null, "missing", "No gross weight stated on the B/L"],
    ]),
  },
  {
    id: "1016",
    caseId: "#1016",
    shipment: "SHP-1016",
    carrierRef: "MSCU2287740",
    sourceEmailSubject: "Draft BL for approval",
    sourceEmailSender: "Adriatic Export Group",
    sourceEmailReceived: "Today, 9:58 AM",
    documents: {
      si: { name: "SI_1016.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1016.pdf", pages: 2 },
    },
    fieldsChecked: 7,
    result: "matched",
    issue: null,
    issueDetail: null,
    issueContext: "All seven required fields agree between the SI and the draft B/L.",
    updated: "1 hr ago",
    updatedOrder: 74,
    dateBucket: "today",
    workflow: "resolved",
    action: "view",
    confidence: 0.96,
    fields: buildFields([
      ["Adriatic Export Group d.o.o.", "Adriatic Export Group d.o.o.", "match"],
      ["Levant Trading Co. W.L.L.", "Levant Trading Co. W.L.L.", "match"],
      ["Levant Trading Co. W.L.L.", "Levant Trading Co. W.L.L.", "match"],
      ["ITGOA — Genoa", "ITGOA — Genoa", "match"],
      ["AEJEA — Jebel Ali", "AEJEA — Jebel Ali", "match"],
      ["2", "2", "match"],
      ["17,940", "17,940", "match"],
    ]),
  },
  {
    id: "1015",
    caseId: "#1015",
    shipment: "SHP-1015",
    carrierRef: "CMDU9917225",
    sourceEmailSubject: "Verify discharge port on scanned BL",
    sourceEmailSender: "Levant Trading Co.",
    sourceEmailReceived: "Today, 9:21 AM",
    documents: {
      si: { name: "SI_1015.pdf", pages: 2 },
      bl: { name: "BL_1015_scan.pdf", pages: 3, scanned: true },
    },
    fieldsChecked: 6,
    result: "needs_review",
    issue: "Port of Discharge",
    issueDetail: "Document text is unreadable",
    issueContext:
      "The discharge port line on the scanned B/L came back at 55% OCR confidence and could read as either Valencia or Barcelona. A person must confirm it.",
    updated: "2 hr ago",
    updatedOrder: 120,
    dateBucket: "today",
    workflow: "in_review",
    action: "review",
    confidence: 0.55,
    fields: buildFields([
      ["Levant Trading Co. W.L.L.", "Levant Trading Co. W.L.L.", "match"],
      ["Iberia Distribucion SL", "Iberia Distribucion SL", "match"],
      ["Iberia Distribucion SL", "Iberia Distribucion SL", "match"],
      ["AEJEA — Jebel Ali", "AEJEA — Jebel Ali", "match"],
      ["ESVLC — Valencia", null, "uncertain", "OCR unreadable — could read as Valencia or Barcelona (55%)"],
      ["1", "1", "match"],
      ["9,410", "9,410", "match"],
    ]),
  },
  {
    id: "1014",
    caseId: "#1014",
    shipment: "SHP-1014",
    carrierRef: "MAEU5518870",
    sourceEmailSubject: "Loading port correction request",
    sourceEmailSender: "Ningbo Prime Export",
    sourceEmailReceived: "Yesterday, 4:44 PM",
    documents: {
      si: { name: "SI_1014.pdf", pages: 2 },
      bl: { name: "DRAFT_BL_1014.pdf", pages: 3 },
    },
    fieldsChecked: 7,
    result: "mismatch",
    issue: "Port of Loading",
    issueDetail: "SI: CNNGB → BL: CNSHA",
    issueContext:
      "Loading port differs. Carrier confirmed the vessel loads at Ningbo; corrected draft was reissued and the case was closed.",
    updated: "Yesterday",
    updatedOrder: 1200,
    dateBucket: "week",
    workflow: "resolved",
    action: "view",
    confidence: 0.97,
    fields: buildFields([
      ["Ningbo Prime Export Co., Ltd", "Ningbo Prime Export Co., Ltd", "match"],
      ["Rotterdam Bulk Traders BV", "Rotterdam Bulk Traders BV", "match"],
      ["Rotterdam Bulk Traders BV", "Rotterdam Bulk Traders BV", "match"],
      ["CNNGB — Ningbo", "CNSHA — Shanghai", "mismatch", "Loading port differs from the shipping instruction"],
      ["NLRTM — Rotterdam", "NLRTM — Rotterdam", "match"],
      ["4", "4", "match"],
      ["38,650", "38,650", "match"],
    ]),
  },
];

/** Totals across all cases in the system, not just the page shown. */
export const CASE_TOTALS = {
  all: 128,
  matched: 92,
  mismatch: 21,
  needsReview: 15,
} as const;

export function findCase(id: string): VerificationCase | undefined {
  return VERIFICATION_CASES.find((item) => item.id === id);
}
