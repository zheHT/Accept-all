export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;
let authorizationFailed = () => {};

export function configureApiAuth(provider: TokenProvider, onAuthorizationFailed: () => void) {
  tokenProvider = provider;
  authorizationFailed = onAuthorizationFailed;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await tokenProvider(false);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, cache: "no-store" });
  if (response.status === 401 && retry) {
    const refreshed = await tokenProvider(true);
    if (refreshed) {
      headers.set("Authorization", `Bearer ${refreshed}`);
      return apiFetch<T>(path, { ...init, headers }, false);
    }
  }
  if (response.status === 401) authorizationFailed();
  if (!response.ok) {
    let message = response.statusText;
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        message = json.detail || json.message || text || response.statusText;
      } catch {
        message = text || response.statusText;
      }
    } catch {
      // keep statusText fallback
    }
    if (response.status === 404 && (message === "Not Found" || message === "")) {
      message = "Endpoint not found (404). The backend service appears to be running an older build without this route.";
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  return (contentType.includes("application/json") ? await response.json() : await response.text()) as T;
}

export function formatApiErrorMessage(error: unknown, fallback = "Please retry."): string {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

export type CaseStatus = "OK" | "MISMATCH" | "NEEDS_REVIEW" | null;

export interface SIArtifactMetadata {
  document_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  generated_at: string;
  generated_by: string;
  fields: Record<string, string>;
}

export interface CategoryWorkflowHistoryItem {
  action: string;
  at: string;
  by: string;
  details?: Record<string, unknown>;
}

export interface CategoryWorkflowState {
  category: string;
  stage: string;
  assigned_team?: string | null;
  si_verified?: boolean;
  si_approved?: boolean;
  si_returned?: boolean;
  history?: CategoryWorkflowHistoryItem[];
}

export interface BlockedSender {
  email: string;
  domain?: string | null;
  blocked_at: string;
  reason: string;
  blocked_by: string;
}

export interface CaseSummary {
  case_id: string;
  source_type: string;
  source_message_id: string;
  sender: string;
  subject: string;
  body?: string;
  html_body?: string | null;
  received_at?: string | null;
  created_at: string;
  updated_at: string;
  processing_state: "DRAFT" | "QUEUED" | "PROCESSING" | "TERMINAL" | "DEAD_LETTER";
  category?: string | null;
  status: CaseStatus;
  review_reason?: string | null;
  defect_fields: string[];
  review_decision?: "APPROVE" | "DECLINE" | null;
  low_confidence: boolean;
  low_confidence_fields: string[];
  confidence?: number | null;
  version: number;
  draft_state?: string | null;
  unresolved_fields?: string[];
  review_progress?: { total: number; completed: number };
  workflow_state?: CategoryWorkflowState | null;
  available_actions?: string[];
  is_sender_blocked?: boolean;
  assigned_team?: string | null;
}
export interface PublicDocument {
  document_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  document_type: "SI" | "BL" | "OTHER" | "UNKNOWN";
  readable?: boolean | null;
  raw_text?: string | null;
}
export interface FieldValue {
  value: string | number | null;
  confidence: number | null;
  unit?: string | null;
  evidence?: string | null;
}
export interface FieldComparison {
  field: string;
  label: string;
  si: FieldValue;
  bl: FieldValue;
  matches: boolean;
  low_confidence: boolean;
}
export interface CaseDetail extends CaseSummary {
  body: string;
  recipients: string[];
  rationale: string;
  assumptions: unknown[];
  documents: PublicDocument[];
  comparisons: FieldComparison[];
  field_reviews?: Record<string, FieldReview>;
  review_history?: FieldReview[];
  si_artifact?: SIArtifactMetadata | null;
  draft: {
    state: string;
    subject: string;
    body: string;
    content_hash: string;
    delivery_mode?: "live" | "compose" | null;
    origin?: "ai" | "template" | null;
    gmail_url?: string | null;
    has_live_gmail?: boolean;
    attachments?: string[];
    prepared_at?: string | null;
    sent_at?: string | null;
    sent_by?: string | null;
  } | null;
}
export interface FieldReview {
  field: string;
  decision: "confirm" | "correct" | "unreadable";
  value: string | null;
  document_role: "SI" | "BL";
  note: string;
  reviewer: string;
  reviewer_id?: string | null;
  at: string;
  original_si?: FieldValue;
  original_bl?: FieldValue;
  effective_values?: { si: string | number | null; bl: string | number | null };
  resolved: boolean;
}
export interface PagedResponse<T> { items: T[]; next_cursor: string | null }
export interface DashboardResponse {
  period: "day" | "week" | "month";
  timezone: string;
  generated_at: string;
  metrics: {
    total: number;
    matches: number;
    mismatches: number;
    needs_review: number;
    processing: number;
    unresolved: number;
    delta_pct?: number;
    previous_total?: number;
    avg_turnaround?: string;
  };
  attention_items: CaseSummary[];
  recent_items: CaseSummary[];
}
export interface SessionInfo {
  uid: string;
  is_admin: boolean;
}
export interface PlatformSettings {
  confidence_threshold: number;
  mismatch_alerts_enabled: boolean;
  low_confidence_requires_review: true;
  missing_value_requires_review: true;
  unreadable_requires_review: true;
  gmail: {
    address: string;
    oauth_status: string;
    watch_expiration?: string | null;
    history_id_present: boolean;
    client_configured?: boolean;
  };
}
export interface KnowledgeBaseWeek {
  week: string;
  content_hash: string;
  published_at: string;
  status: string;
  cases_analyzed: number;
  status_counts: Record<string, number>;
  category_counts: Record<string, number>;
  assumptions_count: number;
  summary_narrative?: string;
}
export interface AssumptionRecord {
  assumption_id: string;
  field: string;
  normalized_value: string;
  evidence_count: number;
  confidence: number;
  case_links: string[];
  status: string;
  last_confirmed_by?: string | null;
  last_confirmed_date?: string | null;
  created_at: string;
}

export const getDashboard = (period: DashboardResponse["period"], signal?: AbortSignal) => apiFetch<DashboardResponse>(`/api/dashboard?period=${period}`, { signal });
export const getInbox = (signal?: AbortSignal, limit = 50) => apiFetch<PagedResponse<CaseSummary>>(`/api/inbox?limit=${limit}`, { signal });
export async function getCases(signal?: AbortSignal, limit = 200): Promise<PagedResponse<CaseSummary>> {
  let cursor: string | null = null;
  const items: CaseSummary[] = [];
  do {
    const url: string = `/api/cases?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page: PagedResponse<CaseSummary> = await apiFetch<PagedResponse<CaseSummary>>(url, { signal });
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return { items, next_cursor: null };
}
export const getReviews = (signal?: AbortSignal, limit = 50) => apiFetch<PagedResponse<CaseSummary>>(`/api/reviews?limit=${limit}`, { signal });
export const getSession = (signal?: AbortSignal) => apiFetch<SessionInfo>("/api/session", { signal });
export const getCase = (id: string, signal?: AbortSignal) => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`, { signal });
export const getDocumentDownload = (caseId: string, documentId: string) =>
  apiFetch<{ url: string }>(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/download`);

/** Fetch the source bytes with the configured auth token (signed file:// URLs are not reliable in-browser). */
export interface DocumentContent {
  blob: File;
  pages: number | null;
}

export async function getDocumentContent(caseId: string, documentId: string, filename: string, signal?: AbortSignal): Promise<DocumentContent> {
  const path = `/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/content`;
  const request = async (forceRefresh: boolean) => {
    const token = await tokenProvider(forceRefresh);
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_BASE_URL}${path}`, { headers, signal, cache: "no-store" });
  };
  let response = await request(false);
  if (response.status === 401) {
    response = await request(true);
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        message = json.detail || json.message || text || response.statusText;
      } catch {
        message = text || response.statusText;
      }
    } catch {
      // keep statusText fallback
    }
    throw new ApiError(message, response.status);
  }
  const pageHeader = Number(response.headers.get("X-Document-Page-Count"));
  const blob = await response.blob();
  return {
    blob: new File([blob], filename, { type: blob.type }),
    pages: Number.isFinite(pageHeader) && pageHeader > 0 ? pageHeader : null,
  };
}

export const reviewField = (
  caseId: string,
  field: string,
  expectedVersion: number,
  decision: FieldReview["decision"],
  note = "",
  value?: string,
  documentRole: FieldReview["document_role"] = "BL",
) => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/fields/${encodeURIComponent(field)}/review`, {
  method: "PUT",
  body: JSON.stringify({ decision, expected_version: expectedVersion, note, ...(value !== undefined ? { value } : {}), document_role: documentRole }),
});
export const retryCase = (item: CaseSummary) => apiFetch<CaseSummary>(`/api/cases/${encodeURIComponent(item.case_id)}/retry?expected_version=${item.version}`, { method: "POST" });
export const reviewCase = (item: CaseSummary, decision: "APPROVE" | "DECLINE", note = "") => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(item.case_id)}/review`, { method: "POST", body: JSON.stringify({ decision, expected_version: item.version, note }) });
export const updateDraft = (id: string, version: number, subject: string, body: string) => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}/draft`, { method: "PUT", body: JSON.stringify({ subject, body, expected_version: version }) });
export const prepareDraft = (caseId: string, expectedVersion?: number) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/draft/prepare`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion }),
  });
export const confirmSentDraft = (caseId: string, expectedVersion: number) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/draft/confirm-sent`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion }),
  });
export const sendDraft = (id: string, version: number, hash: string) => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}/draft/send`, { method: "POST", body: JSON.stringify({ expected_version: version, expected_content_hash: hash }) });
export const getSettings = (signal?: AbortSignal) => apiFetch<PlatformSettings>("/api/settings", { signal });
export const saveSettings = (value: Pick<PlatformSettings, "confidence_threshold" | "mismatch_alerts_enabled">) => apiFetch<PlatformSettings>("/api/settings", { method: "PUT", body: JSON.stringify(value) });
export const startGmailOAuth = () => apiFetch<{ authorization_url: string }>("/api/integrations/gmail/oauth/start");
export const fetchKnowledgeBaseWeeks = (signal?: AbortSignal) => apiFetch<KnowledgeBaseWeek[]>("/api/knowledge-base/weeks", { signal });
export const fetchAssumptionRegistry = (signal?: AbortSignal) => apiFetch<AssumptionRecord[]>("/api/knowledge-base/registry", { signal });
export const publishWeeklySnapshot = (week?: string) => apiFetch<KnowledgeBaseWeek>(`/api/knowledge-base/publish${week ? `?week=${encodeURIComponent(week)}` : ""}`, { method: "POST" });

export const generateSI = (caseId: string, expectedVersion?: number, fields?: Record<string, unknown>) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/generate-si`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, fields }),
  });

export const verifySI = (caseId: string, expectedVersion?: number) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/verify-si`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion }),
  });

export const approveSI = (caseId: string, expectedVersion?: number) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/approve-si`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion }),
  });

export const returnSI = (caseId: string, expectedVersion?: number, subject?: string, body?: string) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/return-si`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, subject, body }),
  });

export const routeCase = (caseId: string, team: string, expectedVersion?: number) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/route`, {
    method: "POST",
    body: JSON.stringify({ team, expected_version: expectedVersion }),
  });

export const draftCategoryResponse = (caseId: string, responseText: string, expectedVersion?: number) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/draft-response`, {
    method: "POST",
    body: JSON.stringify({ response_text: responseText, expected_version: expectedVersion }),
  });

export const completeCategoryCase = (caseId: string, expectedVersion?: number, resolutionNote?: string) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/complete`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, resolution_note: resolutionNote }),
  });

export const blockSender = (caseId: string, expectedVersion?: number, reason?: string) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/block-sender`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, reason }),
  });

export const markNotSpam = (caseId: string, expectedVersion?: number, reclassifyAs?: string) =>
  apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/actions/not-spam`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion, reclassify_as: reclassifyAs }),
  });

export const getBlockedSenders = (signal?: AbortSignal) =>
  apiFetch<BlockedSender[]>("/api/blocked-senders", { signal });

export const unblockSender = (email: string) =>
  apiFetch<void>(`/api/blocked-senders/${encodeURIComponent(email)}`, { method: "DELETE" });
