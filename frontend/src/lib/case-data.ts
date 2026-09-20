import type { VerificationStatus } from "./status";

/** The seven fields verified by the production comparison engine. */
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
export type FieldResult = "match" | "mismatch" | "uncertain" | "missing" | "pending";

export interface FieldComparison {
  field: FieldName;
  si: string | null;
  bl: string | null;
  result: FieldResult;
  note: string | null;
}

export type CaseWorkflow = "open" | "in_review" | "resolved";
export type CaseAction = "view" | "review" | "retry";

/** Visual model used by the restored main-branch case table and drawer. */
export interface VerificationCase {
  id: string;
  caseId: string;
  shipment: string;
  carrierRef: string | null;
  sourceEmailSubject: string;
  sourceEmailSender: string;
  sourceEmailReceived: string;
  documents: {
    si: { name: string; pages: number; documentId?: string; caseId?: string; contentType?: string; rawText?: string | null } | null;
    bl: { name: string; pages: number; scanned?: boolean; documentId?: string; caseId?: string; contentType?: string; rawText?: string | null } | null;
  };
  fieldsChecked: number | null;
  result: VerificationStatus;
  issue: string | null;
  issueDetail: string | null;
  issueContext: string | null;
  updated: string;
  updatedOrder: number;
  dateBucket: "today" | "week" | "earlier";
  workflow: CaseWorkflow;
  action: CaseAction;
  confidence: number;
  fields: FieldComparison[];
}
