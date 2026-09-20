import type { EmailClassification, EmailStatus, InboxEmail } from "@/lib/inbox-data";

export type InboxTypeFilter = "all" | EmailClassification | "other_requests";
export type InboxStatusFilter = "all" | EmailStatus;
export type InboxDateFilter = "all" | "today" | "yesterday";
export type InboxSortOrder = "newest" | "oldest" | "confidence";

export interface InboxFilterState {
  query: string;
  type: InboxTypeFilter;
  status: InboxStatusFilter;
  date: InboxDateFilter;
  sort: InboxSortOrder;
  includeSpam: boolean;
}

export const OTHER_REQUEST_TYPES: EmailClassification[] = ["new_si", "invoice_query", "general"];

export function filterInboxEmails(emails: InboxEmail[], filters: InboxFilterState): InboxEmail[] {
  const needle = filters.query.trim().toLowerCase();

  return emails
    .filter((email) => {
      if (!filters.includeSpam && filters.type !== "spam" && email.classification === "spam") {
        return false;
      }
      if (filters.type === "other_requests" && !OTHER_REQUEST_TYPES.includes(email.classification)) {
        return false;
      }
      if (filters.type !== "all" && filters.type !== "other_requests" && email.classification !== filters.type) {
        return false;
      }
      if (filters.status !== "all" && email.status !== filters.status) return false;
      if (filters.date !== "all" && email.receivedDay !== filters.date) return false;
      if (!needle) return true;
      return [email.sender, email.senderEmail, email.subject, email.preview, email.shipment ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    })
    .sort((a, b) => {
      if (filters.sort === "confidence") return a.confidence - b.confidence;
      if (filters.sort === "oldest") return a.receivedOrder - b.receivedOrder;
      return b.receivedOrder - a.receivedOrder;
    });
}
