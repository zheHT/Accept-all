/**
 * API client to connect the React/Next.js frontend to the FastAPI classifier backend.
 */
import type { EmailClassification } from "@/lib/inbox-data";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface EmailInputPayload {
  email_id: string;
  subject: string;
  body: string;
  sender?: string;
  attachments?: string[];
}

export interface BackendClassificationResponse {
  category:
    | "DOCUMENT_COMPARISON"
    | "NEW_SI_REQUEST"
    | "INVOICE_QUERY"
    | "GENERAL"
    | "SPAM";
  confidence: number;
  reasoning: string;
  is_comparison_candidate: boolean;
  missing_attachments_flag: boolean;
  detected_attachments: string[];
}

/**
 * Maps the backend's strict uppercase category to the frontend's lowercase classification enum.
 */
export function mapBackendCategory(
  backendCategory: BackendClassificationResponse["category"] | string,
): EmailClassification {
  switch (backendCategory) {
    case "DOCUMENT_COMPARISON":
      return "document_comparison";
    case "NEW_SI_REQUEST":
      return "new_si";
    case "INVOICE_QUERY":
      return "invoice_query";
    case "GENERAL":
      return "general";
    case "SPAM":
      return "spam";
    default:
      return "general";
  }
}

/**
 * Call the FastAPI endpoint POST /api/classify to triage an email with Gemini 1.5 Flash.
 */
export async function classifyEmail(
  payload: EmailInputPayload,
): Promise<BackendClassificationResponse> {
  const response = await fetch(`${API_BASE_URL}/api/classify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Classification failed (${response.status}): ${errorText || response.statusText}`,
    );
  }

  return (await response.json()) as BackendClassificationResponse;
}

/**
 * Check backend health and Gemini API readiness.
 */
export async function checkHealth(): Promise<{
  status: string;
  service: string;
  gemini_client_ready: boolean;
}> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`);
  }
  return await response.json();
}
