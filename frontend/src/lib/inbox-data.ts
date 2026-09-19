import {
  Ban,
  CircleCheck,
  FileStack,
  Loader,
  MessageSquare,
  Receipt,
  ScanSearch,
  ShieldCheck,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";

/** How the classification agent labelled an incoming email. */
export type EmailClassification =
  | "document_comparison"
  | "new_si"
  | "invoice_query"
  | "general"
  | "spam";

/** Where the email currently sits in the processing workflow. */
export type EmailStatus =
  | "ready_for_verification"
  | "processing"
  | "classified"
  | "needs_review"
  | "completed"
  | "filtered";

export interface ClassificationMeta {
  label: string;
  icon: LucideIcon;
  dot: string;
  /** Badge styling. Document comparison is filled so it stands out at a glance. */
  chip: string;
  /** Explains why this class matters in the workflow. */
  hint: string;
  /** Document-comparison emails continue into the verification workflow. */
  verifiable: boolean;
}

export const CLASSIFICATION_META: Record<EmailClassification, ClassificationMeta> = {
  document_comparison: {
    label: "Document Comparison Request",
    icon: ScanSearch,
    // Sits on the filled teal badge, so it stays white in both themes.
    dot: "bg-white",
    chip: "bg-gradient-to-r from-brand-500 to-brand-700 text-white ring-1 ring-inset ring-brand-700/40 shadow-brand",
    hint: "Continues into SI vs BL verification",
    verifiable: true,
  },
  new_si: {
    label: "New SI Request",
    icon: FileStack,
    dot: "bg-tide-500",
    chip: "bg-surface/75 text-ink-700 ring-1 ring-inset ring-line",
    hint: "A new shipping instruction was submitted",
    verifiable: false,
  },
  invoice_query: {
    label: "Invoice Query",
    icon: Receipt,
    dot: "bg-plum-500",
    chip: "bg-surface/75 text-ink-700 ring-1 ring-inset ring-line",
    hint: "Billing question — routed to accounts",
    verifiable: false,
  },
  general: {
    label: "General Message",
    icon: MessageSquare,
    dot: "bg-ink-300",
    chip: "bg-surface/75 text-ink-700 ring-1 ring-inset ring-line",
    hint: "No action required beyond classification",
    verifiable: false,
  },
  spam: {
    label: "Spam",
    icon: Ban,
    dot: "bg-ink-400",
    chip: "bg-ink-900/5 text-ink-400 ring-1 ring-inset ring-line",
    hint: "Filtered out — never reaches the case list",
    verifiable: false,
  },
};

export interface EmailStatusMeta {
  label: string;
  icon: LucideIcon;
  chip: string;
  dot: string;
}

export const EMAIL_STATUS_META: Record<EmailStatus, EmailStatusMeta> = {
  ready_for_verification: {
    label: "Ready for Verification",
    icon: ShieldCheck,
    chip: "bg-brand-50/90 text-brand-700 ring-1 ring-inset ring-brand-200",
    dot: "bg-brand-500",
  },
  processing: {
    label: "Processing",
    icon: Loader,
    chip: "bg-processing-50/85 text-processing-700 ring-1 ring-inset ring-processing-200",
    dot: "bg-processing-500",
  },
  classified: {
    label: "Classified",
    icon: CircleCheck,
    chip: "bg-surface/75 text-ink-500 ring-1 ring-inset ring-line",
    dot: "bg-ink-300",
  },
  needs_review: {
    label: "Needs Review",
    icon: UserRoundSearch,
    chip: "bg-review-50/85 text-review-700 ring-1 ring-inset ring-review-200",
    dot: "bg-review-500",
  },
  completed: {
    label: "Completed",
    icon: CircleCheck,
    chip: "bg-matched-50/85 text-matched-700 ring-1 ring-inset ring-matched-200",
    dot: "bg-matched-500",
  },
  filtered: {
    label: "Filtered",
    icon: Ban,
    chip: "bg-ink-900/5 text-ink-400 ring-1 ring-inset ring-line",
    dot: "bg-ink-300",
  },
};

export interface MailAttachment {
  name: string;
  sizeLabel: string;
  /** Detected document role; drives the SI / BL labels in the detail view. */
  role: "SI" | "BL" | "other";
  pages: number;
  scanned?: boolean;
  /**
   * Extracted text shown in the preview. SI/BL attachments linked to a case
   * render from the case's field values instead, so this is only needed for
   * documents outside the verification workflow.
   */
  preview?: string[];
}

export interface InboxEmail {
  id: string;
  sender: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  preview: string;
  body: string[];
  receivedTime: string;
  receivedDay: "today" | "yesterday" | "earlier";
  receivedLabel: string;
  /** Sort key: higher is more recent. */
  receivedOrder: number;
  classification: EmailClassification;
  confidence: number;
  classificationNote: string;
  status: EmailStatus;
  attachments: MailAttachment[];
  caseRef?: string;
  shipment?: string;
}

/** Intake split for the week. Document checks are the only ones that verify. */
export interface IntakeTotals {
  total: number;
  checks: number;
  other: number;
  spam: number;
}

export const INBOX_TOTALS: IntakeTotals = {
  total: 128,
  checks: 42,
  other: 71,
  spam: 15,
};

export const INBOX_EMAILS: InboxEmail[] = [
  {
    id: "em-9001",
    sender: "ABC Logistics",
    senderEmail: "documentation@abclogistics.com",
    recipient: "docs@shipverify.io",
    subject: "Please verify draft Bill of Lading",
    preview:
      "Attached are the shipping instruction and the carrier's draft B/L for booking MAEU8830217.",
    body: [
      "Hi team,",
      "Attached are the shipping instruction and the carrier's draft Bill of Lading for booking MAEU8830217. Please cross-check both documents before we approve the draft.",
      "Documentation cut-off is tomorrow 14:00 local time, so any correction request needs to reach the carrier today.",
      "Best regards,\nLena Ortiz — Export Documentation, ABC Logistics",
    ],
    receivedTime: "10:42 AM",
    receivedDay: "today",
    receivedLabel: "Today, 10:42 AM",
    receivedOrder: 1042,
    classification: "document_comparison",
    confidence: 0.96,
    classificationNote:
      "Explicit comparison verb plus two SI/BL-looking attachments; no billing or booking wording.",
    status: "ready_for_verification",
    attachments: [
      { name: "SI_MAEU8830217.pdf", sizeLabel: "182 KB", role: "SI", pages: 2 },
      { name: "DRAFT_BL_MAEU8830217.pdf", sizeLabel: "274 KB", role: "BL", pages: 3 },
    ],
    caseRef: "1028",
    shipment: "MAEU8830217",
  },
  {
    id: "em-9002",
    sender: "Global Cargo Ltd",
    senderEmail: "accounts@globalcargo.co.uk",
    recipient: "docs@shipverify.io",
    subject: "Question regarding invoice #INV-2041",
    preview:
      "We believe the THC line on invoice #INV-2041 has been charged twice for the Rotterdam leg.",
    body: [
      "Good morning,",
      "We believe the terminal handling charge on invoice #INV-2041 has been billed twice for the Rotterdam leg. Could you review and issue a credit note if confirmed?",
      "Invoice copy is attached for reference.",
      "Thanks,\nPriya Raman — Accounts Payable, Global Cargo Ltd",
    ],
    receivedTime: "10:18 AM",
    receivedDay: "today",
    receivedLabel: "Today, 10:18 AM",
    receivedOrder: 1018,
    classification: "invoice_query",
    confidence: 0.93,
    classificationNote: "Invoice reference and charge-dispute wording; no shipping documents attached.",
    status: "classified",
    attachments: [
      {
        name: "INV-2041.pdf",
        sizeLabel: "96 KB",
        role: "other",
        pages: 1,
        preview: [
          "FREIGHT INVOICE",
          "Invoice No.: INV-2041",
          "Issued to: Global Cargo Ltd",
          "Date: 12 Sep 2026",
          "",
          "Ocean freight  CNSHA - NLRTM            USD 1,840.00",
          "Terminal handling charge (origin)       USD   210.00",
          "Terminal handling charge (Rotterdam)    USD   265.00",
          "Terminal handling charge (Rotterdam)    USD   265.00",
          "Documentation fee                       USD    45.00",
          "",
          "Total due                               USD 2,625.00",
          "",
          "No shipping-instruction or bill-of-lading fields present.",
        ],
      },
    ],
  },
  {
    id: "em-9003",
    sender: "Ocean Freight Services",
    senderEmail: "bookings@oceanfreight.sg",
    recipient: "docs@shipverify.io",
    subject: "New shipping instruction for shipment SHP-1024",
    preview:
      "Please find our shipping instruction for SHP-1024. Cargo ready date is 22 September.",
    body: [
      "Dear team,",
      "Please find attached our shipping instruction for shipment SHP-1024, Singapore to Rotterdam. Cargo ready date is 22 September.",
      "Kindly confirm the booking and send the draft B/L once available.",
      "Regards,\nWei Tan — Ocean Freight Services",
    ],
    receivedTime: "9:56 AM",
    receivedDay: "today",
    receivedLabel: "Today, 9:56 AM",
    receivedOrder: 956,
    classification: "new_si",
    confidence: 0.9,
    classificationNote:
      "New shipping instruction submitted with a single SI attachment and a cargo ready date.",
    status: "classified",
    attachments: [
      {
        name: "SI_SHP-1024.docx",
        sizeLabel: "64 KB",
        role: "SI",
        pages: 2,
        preview: [
          "SHIPPING INSTRUCTION",
          "Our reference: SHP-1024",
          "Cargo ready date: 22 Sep 2026",
          "",
          "Shipper: Ocean Freight Services Pte Ltd",
          "Consignee: Rotterdam Bulk Traders BV",
          "Notify Party: Same as consignee",
          "Port of Loading: Singapore (SGSIN)",
          "Port of Discharge: Rotterdam (NLRTM)",
          "Container Count: 2 x 40HC",
          "Gross Weight: 24,150 KGS",
          "",
          "No bill of lading has been issued for this booking yet,",
          "so there is nothing to compare against.",
        ],
      },
    ],
    shipment: "SHP-1024",
  },
  {
    id: "em-9004",
    sender: "XYZ Logistics",
    senderEmail: "ops-news@xyzlogistics.com",
    recipient: "docs@shipverify.io",
    subject: "Weekly operational update",
    preview:
      "Summary of berth congestion at Ningbo and the revised gate hours for week 39.",
    body: [
      "Hello all,",
      "This week's operational summary: berth congestion at Ningbo is easing, and gate hours at Felixstowe move to 06:00–22:00 from Monday.",
      "No action is required from your side.",
      "XYZ Logistics Operations",
    ],
    receivedTime: "9:21 AM",
    receivedDay: "today",
    receivedLabel: "Today, 9:21 AM",
    receivedOrder: 921,
    classification: "general",
    confidence: 0.88,
    classificationNote: "Operational newsletter wording, no request and no attachments.",
    status: "classified",
    attachments: [],
  },
  {
    id: "em-9005",
    sender: "Unknown Sender",
    senderEmail: "promo@win-freight-deals.biz",
    recipient: "docs@shipverify.io",
    subject: "You have won a free shipping voucher!",
    preview: "Congratulations! Claim your free container shipping voucher — limited time offer.",
    body: [
      "CONGRATULATIONS!",
      "You have been selected to receive a FREE container shipping voucher worth $5,000. Click here now to claim — limited time offer!",
      "Unsubscribe",
    ],
    receivedTime: "8:45 AM",
    receivedDay: "today",
    receivedLabel: "Today, 8:45 AM",
    receivedOrder: 845,
    classification: "spam",
    confidence: 0.99,
    classificationNote:
      "Bulk-mail markers, prize wording and an unrecognised sender domain. Kept out of the case list.",
    status: "filtered",
    attachments: [],
  },
  {
    id: "em-9006",
    sender: "Nordwind Handels GmbH",
    senderEmail: "verladung@nordwind-handels.de",
    recipient: "docs@shipverify.io",
    subject: "Draft B/L check — MAEU7741903 against our SI",
    preview:
      "Please confirm the consignee and gross weight on the attached draft before we release.",
    body: [
      "Hallo,",
      "Please compare the attached draft Bill of Lading against our shipping instruction — in particular the consignee block and the total gross weight.",
      "We cannot approve the draft until both match.",
      "Viele Grüße,\nMarkus Weber — Nordwind Handels GmbH",
    ],
    receivedTime: "8:12 AM",
    receivedDay: "today",
    receivedLabel: "Today, 8:12 AM",
    receivedOrder: 812,
    classification: "document_comparison",
    confidence: 0.94,
    classificationNote: "Comparison request naming specific fields, with SI and BL attached.",
    status: "completed",
    attachments: [
      { name: "SI_Nordwind_7741903.pdf", sizeLabel: "168 KB", role: "SI", pages: 2 },
      { name: "BL_DRAFT_7741903.pdf", sizeLabel: "241 KB", role: "BL", pages: 3 },
    ],
    caseRef: "1019",
    shipment: "MAEU7741903",
  },
  {
    id: "em-9007",
    sender: "Atlas Forwarding Ltd",
    senderEmail: "docs@atlasforwarding.sg",
    recipient: "docs@shipverify.io",
    subject: "SI + scanned BL for booking HLCU-DRAFT-8820",
    preview:
      "Sorry, the B/L is a scan from the carrier's fax — hope it is still readable on your side.",
    body: [
      "Hi,",
      "Attached is our SI and the carrier's draft B/L. Apologies, the B/L only came through as a fax scan.",
      "Please check the notify party and discharge port carefully.",
      "Thanks,\nDaniel Koh — Atlas Forwarding Ltd",
    ],
    receivedTime: "7:48 AM",
    receivedDay: "today",
    receivedLabel: "Today, 7:48 AM",
    receivedOrder: 748,
    classification: "document_comparison",
    confidence: 0.58,
    classificationNote:
      "Comparison intent is clear, but the scanned B/L returned low OCR quality — values must be confirmed by a person.",
    status: "needs_review",
    attachments: [
      { name: "SI_HLCU_8820.pdf", sizeLabel: "151 KB", role: "SI", pages: 2 },
      {
        name: "BL_SCAN_HLCU_8820.pdf",
        sizeLabel: "1.8 MB",
        role: "BL",
        pages: 3,
        scanned: true,
      },
    ],
    caseRef: "1022",
    shipment: "HLCU-DRAFT-8820",
  },
  {
    id: "em-9008",
    sender: "Kestrel Logistics BV",
    senderEmail: "export@kestrel-logistics.nl",
    recipient: "docs@shipverify.io",
    subject: "Cross-check attached documents before cut-off",
    preview: "Two documents attached for booking SI-ATL-55219 — please verify today.",
    body: [
      "Dear documentation team,",
      "Two documents are attached for booking SI-ATL-55219. Please cross-check them before the cut-off this evening.",
      "Kind regards,\nSanne de Vries — Kestrel Logistics BV",
    ],
    receivedTime: "7:02 AM",
    receivedDay: "today",
    receivedLabel: "Today, 7:02 AM",
    receivedOrder: 702,
    classification: "document_comparison",
    confidence: 0.91,
    classificationNote: "Cross-check request with two shipping documents attached.",
    status: "processing",
    attachments: [
      { name: "SI_ATL_55219.pdf", sizeLabel: "142 KB", role: "SI", pages: 2 },
      { name: "BL_ATL_55219.pdf", sizeLabel: "0 KB", role: "BL", pages: 0 },
    ],
    caseRef: "1026",
    shipment: "SI-ATL-55219",
  },
  {
    id: "em-9009",
    sender: "Maersk Line Notifications",
    senderEmail: "no-reply@notifications.maersk.com",
    recipient: "docs@shipverify.io",
    subject: "Vessel schedule update — week 39",
    preview: "MSC Aurora 438W ETA Hamburg revised to 28 September, 06:00.",
    body: [
      "Automated notification",
      "MSC Aurora 438W: ETA Hamburg revised to 28 September, 06:00. No documentation action required.",
    ],
    receivedTime: "6:30 AM",
    receivedDay: "today",
    receivedLabel: "Today, 6:30 AM",
    receivedOrder: 630,
    classification: "general",
    confidence: 0.85,
    classificationNote: "Carrier schedule notification from a no-reply sender.",
    status: "classified",
    attachments: [],
  },
  {
    id: "em-9010",
    sender: "Pacific Rim Sourcing",
    senderEmail: "logistics@pacificrimsourcing.com",
    recipient: "docs@shipverify.io",
    subject: "Verify container count on draft BL — OOLU2298471",
    preview: "The draft shows a different number of containers than our instruction.",
    body: [
      "Hi team,",
      "The draft B/L appears to show a different number of containers than our shipping instruction. Please verify and advise the carrier.",
      "Regards,\nJoel Marsh — Pacific Rim Sourcing",
    ],
    receivedTime: "5:40 PM",
    receivedDay: "yesterday",
    receivedLabel: "Yesterday, 5:40 PM",
    receivedOrder: -60,
    classification: "document_comparison",
    confidence: 0.97,
    classificationNote: "Comparison request naming the container count, with SI and BL attached.",
    status: "completed",
    attachments: [
      { name: "SI_OOLU2298471.pdf", sizeLabel: "177 KB", role: "SI", pages: 2 },
      { name: "BL_DRAFT_OOLU2298471.pdf", sizeLabel: "268 KB", role: "BL", pages: 3 },
    ],
    caseRef: "1023",
    shipment: "OOLU2298471",
  },
  {
    id: "em-9011",
    sender: "Hanseatic Chartering",
    senderEmail: "billing@hanseatic-chartering.de",
    recipient: "docs@shipverify.io",
    subject: "Outstanding balance on statement SEP-114",
    preview: "Statement SEP-114 shows two open items from August — please advise on payment.",
    body: [
      "Dear Sir or Madam,",
      "Statement SEP-114 shows two open items dated August. Please advise on the expected remittance date.",
      "Kind regards,\nHanseatic Chartering Billing",
    ],
    receivedTime: "4:05 PM",
    receivedDay: "yesterday",
    receivedLabel: "Yesterday, 4:05 PM",
    receivedOrder: -180,
    classification: "invoice_query",
    confidence: 0.89,
    classificationNote: "Statement of account and remittance wording.",
    status: "classified",
    attachments: [
      {
        name: "Statement_SEP-114.pdf",
        sizeLabel: "88 KB",
        role: "other",
        pages: 2,
        preview: [
          "STATEMENT OF ACCOUNT",
          "Statement No.: SEP-114",
          "Account: Hanseatic Chartering GmbH",
          "",
          "INV-1987   14 Aug 2026   EUR 3,410.00   OPEN",
          "INV-2003   27 Aug 2026   EUR 1,120.00   OPEN",
          "INV-2041   12 Sep 2026   EUR 2,625.00   PAID",
          "",
          "Total outstanding                EUR 4,530.00",
        ],
      },
    ],
  },
  {
    id: "em-9012",
    sender: "Unknown Sender",
    senderEmail: "growth@seo-logistics-leads.net",
    recipient: "docs@shipverify.io",
    subject: "Rank your freight website #1 — guaranteed backlinks",
    preview: "Our SEO package guarantees first-page ranking for freight forwarders.",
    body: [
      "Hello,",
      "Our SEO package guarantees first-page ranking for freight forwarders. 100% risk-free. Reply to get started today!",
      "Unsubscribe",
    ],
    receivedTime: "11:12 AM",
    receivedDay: "yesterday",
    receivedLabel: "Yesterday, 11:12 AM",
    receivedOrder: -320,
    classification: "spam",
    confidence: 0.98,
    classificationNote: "Cold marketing offer with guaranteed-results claims.",
    status: "filtered",
    attachments: [],
  },
];

/**
 * Messages delivered by the next mailbox sync, in order. Received times are
 * stamped when the sync runs, so the list visibly grows.
 */
export type PendingArrival = Omit<
  InboxEmail,
  "receivedTime" | "receivedLabel" | "receivedOrder" | "receivedDay"
>;

export const SYNC_ARRIVALS: PendingArrival[] = [
  {
    id: "em-9101",
    sender: "Kestrel Logistics BV",
    senderEmail: "export@kestrel-logistics.nl",
    recipient: "docs@shipverify.io",
    subject: "Re: Draft BL verification — readable copy attached",
    preview:
      "Apologies for the scan quality. Here is a text-based PDF of the draft B/L for SI-ATL-55219.",
    body: [
      "Dear documentation team,",
      "Apologies — the previous Bill of Lading was a fax scan. Attached is a text-based PDF of the same draft for booking SI-ATL-55219.",
      "Please re-run the check at your convenience.",
      "Kind regards,\nSanne de Vries — Kestrel Logistics BV",
    ],
    classification: "document_comparison",
    confidence: 0.95,
    classificationNote:
      "Reply on an existing comparison thread with a replacement B/L attached; linked to the failed case automatically.",
    status: "ready_for_verification",
    attachments: [
      { name: "SI_ATL_55219.pdf", sizeLabel: "142 KB", role: "SI", pages: 2 },
      { name: "BL_ATL_55219_clean.pdf", sizeLabel: "231 KB", role: "BL", pages: 3 },
    ],
    caseRef: "1026",
    shipment: "SI-ATL-55219",
  },
  {
    id: "em-9102",
    sender: "Maersk Line Notifications",
    senderEmail: "no-reply@notifications.maersk.com",
    recipient: "docs@shipverify.io",
    subject: "Vessel schedule update — week 40",
    preview: "MSC Livorno 226E omits Antwerp; cargo will discharge at Rotterdam.",
    body: [
      "Automated notification",
      "MSC Livorno 226E will omit Antwerp on this rotation. Cargo booked for Antwerp will discharge at Rotterdam. No documentation action required.",
    ],
    classification: "general",
    confidence: 0.86,
    classificationNote: "Carrier schedule notification from a no-reply sender.",
    status: "classified",
    attachments: [],
  },
];
