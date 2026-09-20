"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Paperclip, RefreshCw, Search, SearchX, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { useWorkspaceCounts } from "@/components/workspace/workspace-counts";
import { ClassificationBadge, EmailStatusBadge } from "./badges";
import { EmailDrawer } from "./email-drawer";
import { IntakeBreakdown, type IntakeGroup } from "./intake-breakdown";
import {
  CLASSIFICATION_META,
  EMAIL_STATUS_META,
  type EmailClassification,
  type EmailStatus,
  type InboxEmail,
} from "@/lib/inbox-data";
import { getCase, getInbox } from "@/lib/api";
import { inboxDetail, inboxSummary } from "@/lib/live-view-models";
import { useLiveQuery } from "@/lib/use-live-query";

/** "other_requests" groups the three non-verification, non-spam categories. */
type TypeFilter = "all" | EmailClassification | "other_requests";
type StatusFilter = "all" | EmailStatus;
type DateFilter = "all" | "today" | "yesterday";
type SortOrder = "newest" | "oldest" | "confidence";

const OTHER_REQUEST_TYPES: EmailClassification[] = ["new_si", "invoice_query", "general"];

const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All Types" },
  ...(Object.keys(CLASSIFICATION_META) as EmailClassification[]).map((value) => ({
    value: value as TypeFilter,
    label: CLASSIFICATION_META[value].label,
  })),
  { value: "other_requests", label: "Other Requests (SI, invoice, general)" },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All Status" },
  ...(Object.keys(EMAIL_STATUS_META) as EmailStatus[]).map((value) => ({
    value,
    label: EMAIL_STATUS_META[value].label,
  })),
];

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "Date: Any" },
  { value: "today", label: "Date: Today" },
  { value: "yesterday", label: "Date: Yesterday" },
];

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "confidence", label: "Lowest Confidence" },
];

export function InboxView() {
  const toast = useToast();
  const { markEmailRead, isEmailRead } = useWorkspaceCounts();
  const inbox = useLiveQuery((signal) => getInbox(signal), []);

  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [date, setDate] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [selected, setSelected] = useState<InboxEmail | null>(null);
  const [displayLimit, setDisplayLimit] = useState(25);

  useEffect(() => {
    if (inbox.data) setEmails(inbox.data.items.map(inboxSummary));
  }, [inbox.data]);

  const totals = useMemo(() => ({
    total: emails.length,
    checks: emails.filter((email) => email.classification === "document_comparison").length,
    spam: emails.filter((email) => email.classification === "spam").length,
    other: emails.filter((email) => OTHER_REQUEST_TYPES.includes(email.classification)).length,
  }), [emails]);

  /** `?email=<id>` opens an email directly, so a colleague can be sent a link. */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("email");
    const match = emails.find((email) => email.id === id);
    if (match) {
      setSelected(match);
      markEmailRead(match.id);
      void getCase(match.id).then((detail) => setSelected(inboxDetail(detail))).catch(() => {});
    }
  }, [emails, markEmailRead]);

  const openEmail = useCallback(
    (email: InboxEmail) => {
      setSelected(email);
      markEmailRead(email.id);
      window.history.replaceState(null, "", `?email=${email.id}`);
      void getCase(email.id)
        .then((detail) => setSelected(inboxDetail(detail)))
        .catch((error: unknown) => toast({
          title: "Email details are temporarily unavailable",
          description: error instanceof Error ? error.message : "Please retry.",
          tone: "warning",
        }));
    },
    [markEmailRead, toast],
  );

  const closeEmail = useCallback(() => {
    setSelected(null);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const sync = useCallback(async () => {
    await inbox.refresh();
    setLastSync(clock(new Date()));
    toast({
      title: "Mailbox refreshed",
      description: "The latest Gmail-sourced cases are now shown.",
      tone: "success",
    });
  }, [inbox, toast]);

  /** The intake panel and the Classification select share one piece of state. */
  const group: IntakeGroup =
    type === "document_comparison"
      ? "checks"
      : type === "spam"
        ? "spam"
        : type === "other_requests"
          ? "other"
          : "all";

  const selectGroup = (next: IntakeGroup) =>
    setType(
      next === "checks"
        ? "document_comparison"
        : next === "spam"
          ? "spam"
          : next === "other"
            ? "other_requests"
            : "all",
    );

  const filtersActive =
    query.trim() !== "" || type !== "all" || status !== "all" || date !== "all" || sort !== "newest";

  const clearFilters = () => {
    setQuery("");
    setType("all");
    setStatus("all");
    setDate("all");
    setSort("newest");
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = emails.filter((email) => {
      if (type === "other_requests" && !OTHER_REQUEST_TYPES.includes(email.classification)) {
        return false;
      }
      if (type !== "all" && type !== "other_requests" && email.classification !== type) return false;
      if (status !== "all" && email.status !== status) return false;
      if (date !== "all" && email.receivedDay !== date) return false;
      if (!needle) return true;
      return [email.sender, email.senderEmail, email.subject, email.preview, email.shipment ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    return filtered.sort((a, b) => {
      if (sort === "confidence") return a.confidence - b.confidence;
      if (sort === "oldest") return a.receivedOrder - b.receivedOrder;
      return b.receivedOrder - a.receivedOrder;
    });
  }, [emails, query, type, status, date, sort]);

  const visibleRows = useMemo(() => rows.slice(0, displayLimit), [rows, displayLimit]);

  if (inbox.loading && !inbox.data) return <LoadingState label="Loading inbox" />;
  if (inbox.error && !inbox.data) {
    return <ErrorState message={inbox.error} retry={() => void inbox.refresh()} />;
  }

  return (
    <>
      <IntakeBreakdown
        totals={totals}
        active={group}
        onSelect={selectGroup}
        syncing={inbox.loading}
        lastSync={lastSync}
        onSync={() => void sync()}
      />

      {inbox.stale && <StaleNotice />}

      <section className="glass glass-sheen flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1 lg:min-w-[300px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
              strokeWidth={2}
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sender, subject, or email..."
              className="field-glass py-2.5 pl-9 pr-3"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Classification filter"
              value={type}
              options={TYPE_OPTIONS}
              onChange={setType}
            />
            <FilterSelect
              label="Status filter"
              value={status}
              options={STATUS_OPTIONS}
              onChange={setStatus}
            />
            <FilterSelect
              label="Date filter"
              value={date}
              options={DATE_OPTIONS}
              onChange={setDate}
            />
            <FilterSelect
              label="Sort order"
              value={sort}
              options={SORT_OPTIONS}
              onChange={setSort}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void sync()}
            disabled={inbox.loading}
            aria-label="Refresh inbox"
            title="Refresh inbox"
            className="btn-glass active:scale-95"
          >
            <RefreshCw className={cn("size-3.5", inbox.loading && "animate-spin")} />
            Refresh
          </button>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!filtersActive}
            className={cn(
              "btn-quiet",
              !filtersActive && "cursor-not-allowed opacity-40 hover:bg-transparent",
            )}
          >
            <X className="size-3.5" strokeWidth={2.25} />
            Clear filters
          </button>
        </div>
      </section>

      <section className="glass glass-sheen overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
              Incoming email
            </h2>
            <p className="mt-1 text-[12.5px] text-ink-500">
              Click an email to see its classification and attachments.
            </p>
          </div>
          <span className="tabular shrink-0 text-[12px] text-ink-400">
            {visibleRows.length < rows.length
              ? `Showing ${visibleRows.length} of ${rows.length} emails`
              : `${rows.length} of ${totals.total} emails`}
          </span>
        </header>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <SearchX className="size-6 text-ink-300" strokeWidth={1.75} />
            <p className="text-[14px] font-medium text-ink-700">No emails match these filters</p>
            <p className="text-[13px] text-ink-400">
              Try a different search term, or clear the filters to see the full inbox.
            </p>
            <button type="button" onClick={clearFilters} className="btn-glass mt-2">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1140px] border-separate border-spacing-0 text-left">
              <thead className="bg-surface/45">
                <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Sender
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Subject
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Received
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Classification
                  </th>
                  <th scope="col" className="px-4 py-3 text-center font-semibold">
                    Files
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((email) => {
                  const meta = CLASSIFICATION_META[email.classification];
                  const isSpam = email.classification === "spam";
                  const read = isEmailRead(email.id);

                  return (
                    <tr
                      key={email.id}
                      onClick={() => openEmail(email)}
                      className="group cursor-pointer transition-colors hover:bg-surface/70"
                    >
                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            title={read ? "Read" : "Unread"}
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              read ? "bg-transparent" : "bg-brand-500",
                            )}
                          />
                          <span
                            className={cn(
                              "grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
                              meta.verifiable
                                ? "bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-brand"
                                : isSpam
                                  ? "bg-ink-900/5 text-ink-400 ring-1 ring-inset ring-line"
                                  : "bg-surface text-ink-500 ring-1 ring-inset ring-line",
                            )}
                          >
                            {initials(email.sender)}
                          </span>
                          <span className="min-w-0">
                            <span
                              className={cn(
                                "block truncate text-[13px] font-semibold",
                                isSpam ? "text-ink-500" : "text-ink-900",
                              )}
                            >
                              {email.sender}
                            </span>
                            <span className="block max-w-[140px] truncate text-[11.5px] text-ink-400">
                              {email.senderEmail}
                            </span>
                          </span>
                        </span>
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span
                          className={cn(
                            "block max-w-[280px] truncate text-[13px]",
                            read ? "font-normal" : "font-semibold",
                            isSpam ? "text-ink-400" : "text-ink-900",
                          )}
                        >
                          {email.subject}
                        </span>
                        <span className="mt-1 block max-w-[280px] truncate text-[12px] text-ink-400">
                          {email.preview}
                        </span>
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span className="tabular block text-[13px] font-medium text-ink-700">
                          {email.receivedTime}
                        </span>
                        <span className="block text-[11.5px] capitalize text-ink-400">
                          {email.receivedDay}
                        </span>
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <ClassificationBadge classification={email.classification} />
                      </td>

                      <td className="border-t border-line px-4 py-4 text-center align-middle">
                        {email.attachments.length === 0 ? (
                          <span className="text-[13px] text-ink-300">—</span>
                        ) : (
                          <span
                            title={email.attachments.map((file) => file.name).join(", ")}
                            className="tabular inline-flex items-center gap-1 rounded-md bg-surface/80 px-1.5 py-0.5 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-line"
                          >
                            <Paperclip className="size-3 text-ink-400" strokeWidth={2.25} />
                            {email.attachments.length}
                          </span>
                        )}
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <EmailStatusBadge status={email.status} />
                      </td>

                      <td className="border-t border-line px-4 py-4 text-right align-middle">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEmail(email);
                          }}
                          className="btn-glass px-3 py-1.5 text-[12px] group-hover:border-brand-200 group-hover:text-brand-700"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > displayLimit && (
          <div className="flex justify-center border-t border-line py-3">
            <button
              type="button"
              onClick={() => setDisplayLimit((prev) => prev + 25)}
              className="btn-glass text-[12.5px]"
            >
              Show more ({rows.length - displayLimit} remaining)
            </button>
          </div>
        )}
      </section>

      <EmailDrawer email={selected} onClose={closeEmail} />
    </>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="field-glass w-auto cursor-pointer appearance-none py-2.5 pl-3 pr-9 font-medium"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-400"
        strokeWidth={2.25}
      />
    </label>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** "10:42 AM" */
function clock(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
