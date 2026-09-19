import type {
  CaseDetail,
  CaseSummary,
  DashboardResponse,
  FieldComparison as ApiFieldComparison,
  PublicDocument,
} from "@/lib/api";
import {
  REQUIRED_FIELDS,
  type FieldName,
  type FieldResult,
  type VerificationCase,
} from "@/lib/case-data";
import type {
  EmailClassification,
  EmailStatus,
  InboxEmail,
  MailAttachment,
} from "@/lib/inbox-data";
import type {
  DocumentEvidence,
  ReviewCase,
  ReviewReasonCode,
} from "@/lib/review-data";
import type { CaseRow, Period, PeriodData } from "@/lib/dashboard-data";
import type { VerificationStatus } from "@/lib/status";
import { buildDocumentLines } from "@/lib/document-text";

const FIELD_LABELS: Record<string, FieldName> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify Party",
  port_of_loading: "Port of Loading",
  port_of_discharge: "Port of Discharge",
  container_count: "Container Count",
  gross_weight: "Gross Weight (kg)",
};

export function verificationStatus(item: CaseSummary): VerificationStatus {
  if (item.status === "OK") return "matched";
  if (item.status === "MISMATCH") return "mismatch";
  if (item.status === "NEEDS_REVIEW") return "needs_review";
  if (item.processing_state === "DEAD_LETTER") return "failed";
  return "processing";
}

export function relativeTime(value?: string | null): string {
  if (!value) return "Not recorded";
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function localDate(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.valueOf()) ? new Date() : date;
}

function dateBucket(value?: string | null): "today" | "week" | "earlier" {
  const age = Date.now() - localDate(value).valueOf();
  if (age < 86_400_000) return "today";
  if (age < 7 * 86_400_000) return "week";
  return "earlier";
}

function receivedDay(value?: string | null): InboxEmail["receivedDay"] {
  const age = Date.now() - localDate(value).valueOf();
  if (age < 86_400_000) return "today";
  if (age < 2 * 86_400_000) return "yesterday";
  return "earlier";
}

function confidence(item: CaseSummary): number {
  if (item.low_confidence) return 0.5;
  if (item.status || item.processing_state === "TERMINAL") return 1;
  return 0;
}

function classification(category?: string | null): EmailClassification {
  const normalized = (category || "").toUpperCase();
  if (normalized === "BL_COMPARISON" || normalized === "DOCUMENT_COMPARISON") {
    return "document_comparison";
  }
  if (normalized === "SI_REQUEST" || normalized === "NEW_SI_REQUEST") return "new_si";
  if (normalized === "INVOICE_QUERY") return "invoice_query";
  if (normalized === "SPAM") return "spam";
  return "general";
}

function emailStatus(item: CaseSummary): EmailStatus {
  if (item.category === "SPAM") return "filtered";
  if (item.status === "NEEDS_REVIEW") return "needs_review";
  if (item.processing_state === "QUEUED" || item.processing_state === "PROCESSING") {
    return "processing";
  }
  if (item.status) return "completed";
  if (classification(item.category) === "document_comparison") return "ready_for_verification";
  return "classified";
}

function displaySender(sender: string): string {
  if (!sender) return "Unknown sender";
  const match = sender.match(/^([^<]+)</);
  return (match?.[1] || sender.split("@")[0]).trim();
}

function displayEmail(sender: string): string {
  return sender.match(/<([^>]+)>/)?.[1] || sender || "Unknown";
}

function timestampOrder(value?: string | null): number {
  const parsed = localDate(value).valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatReceived(value?: string | null): string {
  if (!value) return "Not recorded";
  const date = localDate(value);
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(date);
}

function bytesLabel(bytes: number): string {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function documentRole(document: PublicDocument): MailAttachment["role"] {
  if (document.document_type === "SI") return "SI";
  if (document.document_type === "BL") return "BL";
  return "other";
}

function attachments(documents: PublicDocument[]): MailAttachment[] {
  return documents.map((document) => ({
    name: document.filename,
    sizeLabel: bytesLabel(document.size_bytes),
    role: documentRole(document),
    pages: 1,
    scanned: document.readable === false,
  }));
}

export function inboxSummary(item: CaseSummary): InboxEmail {
  const when = item.received_at || item.created_at;
  const kind = classification(item.category);
  return {
    id: item.case_id,
    sender: displaySender(item.sender),
    senderEmail: displayEmail(item.sender),
    recipient: "Connected Gmail inbox",
    subject: item.subject || "No subject",
    preview: item.review_reason || `${item.defect_fields.length} flagged field${item.defect_fields.length === 1 ? "" : "s"}`,
    body: [],
    receivedTime: relativeTime(when),
    receivedDay: receivedDay(when),
    receivedLabel: formatReceived(when),
    receivedOrder: timestampOrder(when),
    classification: kind,
    confidence: confidence(item),
    classificationNote: item.review_reason || `Classified by the production intake pipeline as ${item.category || "general"}.`,
    status: emailStatus(item),
    attachments: [],
    caseRef: kind === "document_comparison" ? item.case_id : undefined,
    shipment: item.source_message_id || item.case_id,
  };
}

export function inboxDetail(item: CaseDetail): InboxEmail {
  const files = attachments(item.documents).map((file) => ({
    ...file,
    preview: [
      file.role === "SI" ? "SHIPPING INSTRUCTION · EXTRACTED VALUES" : file.role === "BL" ? "BILL OF LADING · EXTRACTED VALUES" : "ATTACHMENT METADATA",
      "",
      ...item.comparisons.map((comparison) => {
        const value = file.role === "SI" ? valueText(comparison.si) : file.role === "BL" ? valueText(comparison.bl) : null;
        return `${comparison.label}: ${value || "Not available"}`;
      }),
    ],
  }));
  return {
    ...inboxSummary(item),
    preview: item.body.slice(0, 180) || inboxSummary(item).preview,
    body: item.body ? item.body.split(/\n{2,}/).filter(Boolean) : ["No email body was recorded."],
    attachments: files,
    classificationNote: item.rationale || inboxSummary(item).classificationNote,
  };
}

function comparisonResult(comparison: ApiFieldComparison): FieldResult {
  if (comparison.si.value === null || comparison.bl.value === null) return "missing";
  if (comparison.low_confidence) return "uncertain";
  return comparison.matches ? "match" : "mismatch";
}

function valueText(value: ApiFieldComparison["si"]): string | null {
  if (value.value === null || value.value === undefined) return null;
  return `${value.value}${value.unit ? ` ${value.unit}` : ""}`;
}

function emptyFields(status: VerificationStatus): VerificationCase["fields"] {
  return REQUIRED_FIELDS.map((field) => ({
    field,
    si: null,
    bl: null,
    result: status === "processing" ? "pending" : "missing",
    note: null,
  }));
}

function workflow(item: CaseSummary): VerificationCase["workflow"] {
  if (item.review_decision) return "resolved";
  if (item.status === "NEEDS_REVIEW") return "in_review";
  return "open";
}

function action(item: CaseSummary): VerificationCase["action"] {
  if (item.processing_state === "DEAD_LETTER") return "retry";
  if (item.status === "NEEDS_REVIEW") return "review";
  return "view";
}

function issue(item: CaseSummary): string | null {
  if (item.processing_state === "DEAD_LETTER") return item.review_reason || "Processing failed";
  if (item.defect_fields.length) return item.defect_fields.map(fieldLabel).join(", ");
  if (item.low_confidence_fields.length) return item.low_confidence_fields.map(fieldLabel).join(", ");
  if (item.processing_state !== "TERMINAL") return "Extraction in progress";
  return null;
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function caseSummary(item: CaseSummary): VerificationCase {
  const status = verificationStatus(item);
  const when = item.updated_at || item.created_at;
  const flagged = [...new Set([...item.defect_fields, ...item.low_confidence_fields])];
  return {
    id: item.case_id,
    caseId: item.case_id,
    shipment: item.source_message_id || item.case_id,
    carrierRef: null,
    sourceEmailSubject: item.subject || "No subject",
    sourceEmailSender: displaySender(item.sender),
    sourceEmailReceived: formatReceived(item.received_at || item.created_at),
    documents: { si: null, bl: null },
    fieldsChecked: status === "processing" ? 0 : REQUIRED_FIELDS.length,
    result: status,
    issue: issue(item),
    issueDetail: flagged.length ? `${flagged.length} field${flagged.length === 1 ? "" : "s"} require attention` : item.review_reason ?? null,
    issueContext: item.review_reason ?? null,
    updated: relativeTime(when),
    updatedOrder: -timestampOrder(when),
    dateBucket: dateBucket(when),
    workflow: workflow(item),
    action: action(item),
    confidence: confidence(item),
    fields: emptyFields(status),
  };
}

export function caseDetail(item: CaseDetail): VerificationCase {
  const base = caseSummary(item);
  const docs = {
    si: item.documents.find((document) => document.document_type === "SI"),
    bl: item.documents.find((document) => document.document_type === "BL"),
  };
  const comparisons = new Map(item.comparisons.map((comparison) => [comparison.field, comparison]));
  const fields = REQUIRED_FIELDS.map((label) => {
    const apiName = Object.entries(FIELD_LABELS).find(([, value]) => value === label)?.[0];
    const comparison = apiName ? comparisons.get(apiName) : undefined;
    if (!comparison) return emptyFields(base.result).find((field) => field.field === label)!;
    return {
      field: label,
      si: valueText(comparison.si),
      bl: valueText(comparison.bl),
      result: comparisonResult(comparison),
      note: comparison.si.evidence || comparison.bl.evidence || null,
    };
  });
  const confidences = item.comparisons.flatMap((comparison) => [comparison.si.confidence, comparison.bl.confidence]).filter((value): value is number => typeof value === "number");
  return {
    ...base,
    documents: {
      si: docs.si ? { name: docs.si.filename, pages: 1 } : null,
      bl: docs.bl ? { name: docs.bl.filename, pages: 1, scanned: docs.bl.readable === false } : null,
    },
    fields,
    fieldsChecked: fields.filter((field) => field.result !== "pending").length,
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : base.confidence,
    issueContext: item.rationale || base.issueContext,
  };
}

function reviewReason(item: CaseSummary): ReviewReasonCode {
  const reason = (item.review_reason || "").toLowerCase();
  if (item.processing_state === "DEAD_LETTER" || reason.includes("unreadable")) return "unreadable_document";
  if (reason.includes("missing")) return "missing_information";
  if (item.low_confidence || reason.includes("confidence")) return "low_confidence";
  if (reason.includes("ambiguous")) return "ambiguous_value";
  return "processing_issue";
}

function evidence(name: string, field: string, value: string | null, note?: string | null): DocumentEvidence {
  const lines = [note || `${field}: ${value || "Not available"}`];
  return {
    name,
    pages: 1,
    snippet: lines,
    highlightIndex: 0,
    extractedLabel: field,
    extractedValue: value,
  };
}

export function reviewSummary(item: CaseSummary): ReviewCase {
  const problem = item.low_confidence_fields[0] || item.defect_fields[0] || "verification result";
  const when = item.created_at;
  const label = fieldLabel(problem);
  const siBuild = buildDocumentLines("SI", null, null, label);
  const blBuild = buildDocumentLines("BL", null, null, label);
  return {
    id: item.case_id,
    caseId: item.case_id,
    shipment: item.source_message_id || item.case_id,
    problemField: label,
    reason: item.review_reason || "Human confirmation is required",
    reasonCode: reviewReason(item),
    reasonDetail: item.review_reason || "The production safety policy requires a reviewer to decide this case.",
    confidence: confidence(item),
    status: item.review_decision ? "resolved" : "pending",
    created: relativeTime(when),
    createdOrder: timestampOrder(when),
    si: {
      name: "Shipping Instruction",
      pages: 1,
      snippet: siBuild.lines,
      fullLines: siBuild.lines,
      problemLines: siBuild.problemLines,
      highlightIndex: siBuild.problemLines[0] ?? 0,
      extractedLabel: label,
      extractedValue: null,
    },
    bl: {
      name: "Bill of Lading",
      pages: 1,
      snippet: blBuild.lines,
      fullLines: blBuild.lines,
      problemLines: blBuild.problemLines,
      highlightIndex: blBuild.problemLines[0] ?? 0,
      extractedLabel: label,
      extractedValue: null,
    },
  };
}

export function reviewDetail(item: CaseDetail): ReviewCase {
  const base = reviewSummary(item);
  const problemKey = item.low_confidence_fields[0] || item.defect_fields[0] || item.comparisons.find((comparison) => !comparison.matches || comparison.low_confidence)?.field;
  const comparison = item.comparisons.find((entry) => entry.field === problemKey) || item.comparisons[0];
  const siDocument = item.documents.find((document) => document.document_type === "SI");
  const blDocument = item.documents.find((document) => document.document_type === "BL");
  if (!comparison) return base;

  const problemField = comparison.label || fieldLabel(comparison.field);
  const siVal = valueText(comparison.si);
  const blVal = valueText(comparison.bl);

  const siBuild = buildDocumentLines("SI", siDocument, item.comparisons, problemField);
  const blBuild = buildDocumentLines("BL", blDocument, item.comparisons, problemField);

  return {
    ...base,
    problemField,
    reasonDetail: item.rationale || base.reasonDetail,
    confidence: Math.min(comparison.si.confidence ?? 1, comparison.bl.confidence ?? 1),
    si: {
      name: siDocument?.filename || "Shipping Instruction",
      pages: 1,
      snippet: siBuild.lines,
      fullLines: siBuild.lines,
      problemLines: siBuild.problemLines,
      highlightIndex: siBuild.problemLines[0] ?? 0,
      extractedLabel: comparison.label,
      extractedValue: siVal,
      rawText: siDocument?.raw_text ?? null,
    },
    bl: {
      name: blDocument?.filename || "Bill of Lading",
      pages: 1,
      scanned: blDocument?.readable === false,
      snippet: blBuild.lines,
      fullLines: blBuild.lines,
      problemLines: blBuild.problemLines,
      highlightIndex: blBuild.problemLines[0] ?? 0,
      extractedLabel: comparison.label,
      extractedValue: blVal,
      rawText: blDocument?.raw_text ?? null,
    },
  };
}

export function attentionRow(item: CaseSummary): CaseRow {
  return {
    id: item.case_id,
    reference: item.source_message_id || item.case_id,
    counterparty: displaySender(item.sender),
    vessel: item.subject || "Email context",
    pol: "Source",
    pod: "Inbox",
    status: verificationStatus(item),
    flaggedFields: [...new Set([...item.defect_fields, ...item.low_confidence_fields])].map(fieldLabel),
    confidence: confidence(item),
    received: relativeTime(item.received_at || item.created_at),
  };
}

function periodLabel(period: Period): { label: string; caption: string; rangeLabel: string } {
  const now = new Date();
  const rangeLabel = new Intl.DateTimeFormat("en-MY", {
    dateStyle: period === "month" ? undefined : "medium",
    month: period === "month" ? "long" : undefined,
    year: period === "month" ? "numeric" : undefined,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(now);
  if (period === "day") return { label: "Today", caption: "Processed today", rangeLabel };
  if (period === "month") return { label: "This month", caption: "Processed this month", rangeLabel };
  return { label: "This week", caption: "Processed this week", rangeLabel };
}

export function periodData(response: DashboardResponse): PeriodData {
  const labels = periodLabel(response.period);
  const total = response.metrics.total;
  return {
    id: response.period,
    ...labels,
    total,
    matched: response.metrics.matches,
    mismatch: response.metrics.mismatches,
    needsReview: response.metrics.needs_review,
    deltaPct: 0,
    volume: [],
    avgTurnaround: "Live",
    autoCleared: total ? Math.round((response.metrics.matches / total) * 100) : 0,
  };
}
