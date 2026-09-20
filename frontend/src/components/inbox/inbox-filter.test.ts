import { describe, expect, it } from "vitest";
import type { InboxEmail } from "@/lib/inbox-data";
import { filterInboxEmails, type InboxFilterState } from "./inbox-filter";

const email = (id: string, classification: InboxEmail["classification"]): InboxEmail => ({
  id,
  sender: "Sender",
  senderEmail: "sender@example.com",
  recipient: "Inbox",
  subject: id,
  preview: "Preview",
  body: [],
  receivedTime: "Now",
  receivedDay: "today",
  receivedLabel: "Today",
  receivedOrder: Number(id),
  classification,
  confidence: 1,
  classificationNote: "",
  status: classification === "spam" ? "filtered" : "classified",
  attachments: [],
});

const baseFilters: InboxFilterState = {
  query: "",
  type: "all",
  status: "all",
  date: "all",
  sort: "newest",
  includeSpam: false,
};

describe("inbox filtering", () => {
  const emails = [email("1", "general"), email("2", "spam")];

  it("excludes spam from the default inbox", () => {
    expect(filterInboxEmails(emails, baseFilters).map(({ id }) => id)).toEqual(["1"]);
  });

  it("shows spam when Spam is selected", () => {
    expect(filterInboxEmails(emails, { ...baseFilters, type: "spam" }).map(({ id }) => id)).toEqual(["2"]);
  });

  it("shows the full dataset for explicit All", () => {
    expect(filterInboxEmails(emails, { ...baseFilters, includeSpam: true }).map(({ id }) => id)).toEqual(["2", "1"]);
  });
});
