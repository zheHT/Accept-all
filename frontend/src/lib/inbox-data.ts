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

export type EmailClassification =
  | "document_comparison"
  | "new_si"
  | "invoice_query"
  | "general"
  | "spam";

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
  chip: string;
  hint: string;
  verifiable: boolean;
}

export const CLASSIFICATION_META: Record<EmailClassification, ClassificationMeta> = {
  document_comparison: {
    label: "Document Comparison Request",
    icon: ScanSearch,
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
    hint: "Billing question routed to accounts",
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
    hint: "Filtered out before verification",
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
  role: "SI" | "BL" | "other";
  pages: number;
  scanned?: boolean;
  preview?: string[];
}

/** Visual model used by the restored main-branch inbox table and drawer. */
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
  receivedOrder: number;
  classification: EmailClassification;
  confidence: number;
  classificationNote: string;
  status: EmailStatus;
  attachments: MailAttachment[];
  caseRef?: string;
  shipment?: string;
}

export interface IntakeTotals {
  total: number;
  checks: number;
  other: number;
  spam: number;
}
