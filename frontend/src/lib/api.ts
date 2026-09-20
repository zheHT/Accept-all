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
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  return (contentType.includes("application/json") ? await response.json() : await response.text()) as T;
}

export type CaseStatus = "OK" | "MISMATCH" | "NEEDS_REVIEW" | null;
export interface CaseSummary {
  case_id: string;
  source_type: string;
  source_message_id: string;
  sender: string;
  subject: string;
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
  version: number;
  draft_state?: string | null;
  unresolved_fields?: string[];
  review_progress?: { total: number; completed: number };
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
  draft: { state: string; subject: string; body: string; content_hash: string } | null;
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
  metrics: { total: number; matches: number; mismatches: number; needs_review: number; processing: number; unresolved: number };
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
  gmail: { address: string; oauth_status: string; watch_expiration?: string | null; history_id_present: boolean };
}
export interface KnowledgeBaseWeek {
  week: string;
  drive_file_id?: string | null;
  drive_url?: string | null;
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
export const getCases = (signal?: AbortSignal, limit = 50) => apiFetch<PagedResponse<CaseSummary>>(`/api/cases?limit=${limit}`, { signal });
export const getReviews = (signal?: AbortSignal, limit = 50) => apiFetch<PagedResponse<CaseSummary>>(`/api/reviews?limit=${limit}`, { signal });
export const getSession = (signal?: AbortSignal) => apiFetch<SessionInfo>("/api/session", { signal });
export const getCase = (id: string, signal?: AbortSignal) => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`, { signal });
export const getDocumentDownload = (caseId: string, documentId: string) =>
  apiFetch<{ url: string }>(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/download`);

/** Fetch the source bytes with the configured auth token (signed file:// URLs are not reliable in-browser). */
export interface DocumentContent {
  blob: Blob;
  pages: number | null;
}

export async function getDocumentContent(caseId: string, documentId: string, signal?: AbortSignal): Promise<DocumentContent> {
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
  return { blob: await response.blob(), pages: Number.isFinite(pageHeader) && pageHeader > 0 ? pageHeader : null };
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
export const sendDraft = (id: string, version: number, hash: string) => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}/draft/send`, { method: "POST", body: JSON.stringify({ expected_version: version, expected_content_hash: hash }) });
export const getSettings = (signal?: AbortSignal) => apiFetch<PlatformSettings>("/api/settings", { signal });
export const saveSettings = (value: Pick<PlatformSettings, "confidence_threshold" | "mismatch_alerts_enabled">) => apiFetch<PlatformSettings>("/api/settings", { method: "PUT", body: JSON.stringify(value) });
export const startGmailOAuth = () => apiFetch<{ authorization_url: string }>("/api/integrations/gmail/oauth/start");
export const fetchKnowledgeBaseWeeks = (signal?: AbortSignal) => apiFetch<KnowledgeBaseWeek[]>("/api/knowledge-base/weeks", { signal });
export const fetchAssumptionRegistry = (signal?: AbortSignal) => apiFetch<AssumptionRecord[]>("/api/knowledge-base/registry", { signal });
export const publishWeeklySnapshot = (week?: string) => apiFetch<KnowledgeBaseWeek>(`/api/knowledge-base/publish${week ? `?week=${encodeURIComponent(week)}` : ""}`, { method: "POST" });
export const fetchKnowledgePreview = (filename: string) => apiFetch<string>(`/api/knowledge-base/preview/${encodeURIComponent(filename)}`);
