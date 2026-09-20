"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Eye, RefreshCw, Search, SearchX, UserRoundSearch, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { StatusChip } from "@/components/status-chip";
import { StatBar, type StatSegment } from "@/components/ui/stat-bar";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { CaseDrawer } from "./case-drawer";
import { type VerificationCase } from "@/lib/case-data";
import { type VerificationStatus } from "@/lib/status";
import { readParam, writeParam } from "@/lib/url-state";
import { ApiError, getCase, getCases, retryCase as retryApiCase } from "@/lib/api";
import { caseDetail, caseSummary } from "@/lib/live-view-models";
import { useLiveQuery } from "@/lib/use-live-query";

type ResultFilter = "all" | VerificationStatus;
type WorkflowFilter = "all" | "open" | "in_review" | "resolved";
type DateFilter = "all" | "today" | "week";
type SortOrder = "newest" | "oldest";

const RESULT_OPTIONS: Array<{ value: ResultFilter; label: string }> = [
  { value: "all", label: "All Results" },
  { value: "matched", label: "Matched" },
  { value: "mismatch", label: "Mismatch" },
  { value: "needs_review", label: "Needs Review" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

const WORKFLOW_OPTIONS: Array<{ value: WorkflowFilter; label: string }> = [
  { value: "all", label: "All Status" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In Review" },
  { value: "resolved", label: "Resolved" },
];

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "All Dates" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
];

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

const ACTION_LABEL = {
  view: { label: "View", icon: Eye },
  review: { label: "Review", icon: UserRoundSearch },
  retry: { label: "Retry", icon: RefreshCw },
} as const;

export function CasesView() {
  const router = useRouter();
  const toast = useToast();
  const liveCases = useLiveQuery((signal) => getCases(signal), []);

  const [cases, setCases] = useState<VerificationCase[]>([]);
  const [result, setResult] = useState<ResultFilter>("all");
  const [workflow, setWorkflow] = useState<WorkflowFilter>("all");
  const [date, setDate] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [query, setQuery] = useState("");
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(25);

  useEffect(() => {
    if (liveCases.data) setCases(liveCases.data.items.map(caseSummary));
  }, [liveCases.data]);

  /** `?case=1023` opens a case directly; `?result=mismatch` pre-filters the table. */
  useEffect(() => {
    const requestedCase = readParam("case");
    if (requestedCase && liveCases.data?.items.some((item) => item.case_id === requestedCase)) {
      setOpenCaseId(requestedCase);
      void getCase(requestedCase).then((detail) => {
        setCases((current) => current.some((item) => item.id === requestedCase)
          ? current.map((item) => item.id === requestedCase ? caseDetail(detail) : item)
          : [caseDetail(detail), ...current]);
      }).catch(() => {});
    }
    const requestedResult = readParam("result");
    if (requestedResult && RESULT_OPTIONS.some((option) => option.value === requestedResult)) {
      setResult(requestedResult as ResultFilter);
    }
  }, [liveCases.data]);

  const changeResult = useCallback((next: ResultFilter) => {
    setResult(next);
    writeParam("result", next === "all" ? null : next);
  }, []);

  const openCase = useCallback((item: VerificationCase) => {
    setOpenCaseId(item.id);
    writeParam("case", item.id);
    void getCase(item.id)
      .then((detail) => setCases((current) => current.map((entry) => entry.id === item.id ? caseDetail(detail) : entry)))
      .catch((error: unknown) => toast({
        title: "Case detail is temporarily unavailable",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      }));
  }, [toast]);

  const closeCase = useCallback(() => {
    setOpenCaseId(null);
    writeParam("case", null);
  }, []);

  /** Retry puts the case back into processing, the same as the engine would. */
  const retryCase = useCallback(
    async (id: string) => {
      const source = liveCases.data?.items.find((item) => item.case_id === id);
      if (!source) return;
      try {
        await retryApiCase(source);
        await liveCases.refresh();
        setOpenCaseId(null);
        toast({
          title: `Reprocessing ${id}`,
          description: "The case was safely queued for another processing pass.",
          tone: "info",
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) await liveCases.refresh();
        toast({
          title: error instanceof ApiError && error.status === 409 ? "Case changed while it was open" : "Retry failed",
          description: error instanceof ApiError && error.status === 409 ? "The live case was refreshed. Please review it and repeat the action." : error instanceof Error ? error.message : "Please retry.",
          tone: "warning",
        });
      }
    },
    [liveCases, toast],
  );

  const reviewCase = useCallback(
    (item: VerificationCase) => {
      router.push(`/review?case=${item.id}`);
    },
    [router],
  );

  const filtersActive =
    query.trim() !== "" ||
    result !== "all" ||
    workflow !== "all" ||
    date !== "all" ||
    sort !== "newest";

  const clearFilters = () => {
    setQuery("");
    setWorkflow("all");
    setDate("all");
    setSort("newest");
    changeResult("all");
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = cases.filter((item) => {
      if (result !== "all" && item.result !== result) return false;
      if (workflow !== "all" && item.workflow !== workflow) return false;
      if (date !== "all" && item.dateBucket !== date) return false;
      if (!needle) return true;
      return [item.caseId, item.shipment, item.carrierRef ?? "", item.sourceEmailSubject, item.issue ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    return filtered.sort((a, b) =>
      sort === "oldest" ? b.updatedOrder - a.updatedOrder : a.updatedOrder - b.updatedOrder,
    );
  }, [cases, query, result, workflow, date, sort]);

  const visibleRows = useMemo(() => rows.slice(0, displayLimit), [rows, displayLimit]);

  /**
   * One card per unresolved outcome (review first, then mismatch, then failure)
   * so the strip covers the different kinds of problem rather than repeating one.
   */
  const attention = useMemo(() => {
    const unresolved = cases
      .filter((item) => item.workflow !== "resolved")
      .sort((a, b) => a.updatedOrder - b.updatedOrder);

    const picked: VerificationCase[] = [];
    for (const result of ["needs_review", "mismatch", "failed"] as const) {
      const match = unresolved.find((item) => item.result === result);
      if (match) picked.push(match);
    }
    return picked;
  }, [cases]);

  const summarySegments = useMemo<StatSegment[]>(() => {
    const total = cases.length;
    const count = (status: VerificationStatus) => cases.filter((item) => item.result === status).length;
    const segment = (
      id: string,
      label: string,
      value: number,
      support: string,
      accent: string,
    ): StatSegment => ({
      id,
      label,
      value,
      support,
      accent,
      share: total ? Math.round((value / total) * 100) : 0,
    });
    return [
      segment("all", "All Cases", total, "Verification cases", "bg-brand-500"),
      segment("matched", "Matched", count("matched"), "No mismatch detected", "bg-matched-500"),
      segment("mismatch", "Mismatch", count("mismatch"), "Discrepancy detected", "bg-mismatch-500"),
      segment("needs_review", "Needs Review", count("needs_review"), "Human verification required", "bg-review-500"),
    ];
  }, [cases]);

  const activeCase = openCaseId ? (cases.find((item) => item.id === openCaseId) ?? null) : null;

  if (liveCases.loading && !liveCases.data) return <LoadingState label="Loading verification cases" />;
  if (liveCases.error && !liveCases.data) {
    return <ErrorState message={liveCases.error} retry={() => void liveCases.refresh()} />;
  }

  return (
    <>
      {liveCases.stale && <StaleNotice />}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Overview — select to filter the table</p>
        <StatBar
          segments={summarySegments}
          activeId={result}
          onSelect={(id) =>
            changeResult(id === result && id !== "all" ? "all" : (id as ResultFilter))
          }
        />
      </section>

      {attention.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Attention required</p>
            <span className="text-[11.5px] text-ink-400">
              {attention.length} unresolved case{attention.length === 1 ? "" : "s"} ranked by impact
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {attention.map((item) => (
              <article
                key={item.id}
                className={cn(
                  "glass flex flex-col gap-3 p-4",
                  item.result === "mismatch" && "border-mismatch-200/80",
                  item.result === "needs_review" && "border-review-200/80",
                  item.result === "failed" && "border-failed-200/80",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openCase(item)}
                    className="text-[14px] font-semibold tracking-tight text-ink-900 underline-offset-4 hover:text-brand-700 hover:underline"
                  >
                    {item.shipment}
                  </button>
                  <StatusChip status={item.result} />
                </div>

                <div>
                  <p className="text-[12.5px] font-medium text-ink-700">
                    {item.result === "mismatch"
                      ? `${item.fields.filter((field) => field.result === "mismatch").length} discrepancy detected — ${item.issue}`
                      : item.result === "needs_review"
                        ? `Human review required — ${item.issue}`
                        : `Processing failed — ${item.issue}`}
                  </p>
                  {item.issueDetail && (
                    <p className="mt-1 font-mono text-[12px] text-ink-500">{item.issueDetail}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    item.result === "needs_review" ? reviewCase(item) : openCase(item)
                  }
                  className="btn-glass mt-auto w-full justify-center"
                >
                  {item.result === "needs_review" ? "Review case" : "Open case"}
                  <ArrowRight className="size-3.5" strokeWidth={2.25} />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="glass glass-sheen flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1 lg:min-w-[320px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
              strokeWidth={2}
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search shipment, case ID, or email subject..."
              className="field-glass py-2.5 pl-9 pr-3"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Result filter"
              value={result}
              options={RESULT_OPTIONS}
              onChange={changeResult}
            />
            <FilterSelect
              label="Status filter"
              value={workflow}
              options={WORKFLOW_OPTIONS}
              onChange={setWorkflow}
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
            onClick={() => void liveCases.refresh()}
            disabled={liveCases.loading}
            aria-label="Refresh cases"
            title="Refresh cases"
            className="btn-glass active:scale-95"
          >
            <RefreshCw className={cn("size-3.5", liveCases.loading && "animate-spin")} />
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
            Clear Filters
          </button>
        </div>
      </section>

      <section className="glass glass-sheen overflow-hidden">
        <header className="flex flex-col gap-1 border-b border-line px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
              Verification Cases
            </h2>
            <p className="mt-1 text-[13px] text-ink-500">
              Document comparison requests processed by the verification engine.
            </p>
          </div>
          <span className="tabular shrink-0 text-[12px] text-ink-400">
            {visibleRows.length < rows.length
              ? `Showing ${visibleRows.length} of ${rows.length} cases`
              : `${rows.length} of ${cases.length} cases`}
          </span>
        </header>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <SearchX className="size-6 text-ink-300" strokeWidth={1.75} />
            <p className="text-[14px] font-medium text-ink-700">No cases match these filters</p>
            <button type="button" onClick={clearFilters} className="btn-glass mt-2">
              Clear Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1140px] border-separate border-spacing-0 text-left">
              <thead className="bg-surface/45">
                <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Case
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Shipment
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Source Email
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Docs
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">
                    Fields
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Result
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Issue
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Updated
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((item) => {
                  const action = ACTION_LABEL[item.action];
                  const ActionIcon = action.icon;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => openCase(item)}
                      className="group cursor-pointer transition-colors hover:bg-surface/70"
                    >
                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span className="font-mono text-[12px] text-ink-400">{item.caseId}</span>
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openCase(item);
                          }}
                          className="block text-[13.5px] font-semibold tracking-tight text-ink-900 underline-offset-4 hover:text-brand-700 hover:underline"
                        >
                          {item.shipment}
                        </button>
                        {item.carrierRef && (
                          <span className="mt-0.5 block font-mono text-[11px] text-ink-400">
                            {item.carrierRef}
                          </span>
                        )}
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span className="block max-w-[200px] truncate text-[12.5px] text-ink-500">
                          {item.sourceEmailSubject}
                        </span>
                        <span className="mt-0.5 block max-w-[200px] truncate text-[11px] text-ink-400">
                          {item.sourceEmailSender}
                        </span>
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-500">
                          <span className="rounded bg-surface/85 px-1.5 py-0.5 font-mono text-[10.5px] ring-1 ring-inset ring-line">
                            SI
                          </span>
                          +
                          <span className="rounded bg-surface/85 px-1.5 py-0.5 font-mono text-[10.5px] ring-1 ring-inset ring-line">
                            BL
                          </span>
                        </span>
                      </td>

                      <td className="whitespace-nowrap border-t border-line px-4 py-4 align-middle">
                        <FieldsMeter checked={item.fieldsChecked} />
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        <StatusChip status={item.result} />
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle">
                        {item.issue ? (
                          <span
                            title={item.issueContext ?? undefined}
                            className="block cursor-help"
                          >
                            <span
                              className={cn(
                                "block text-[12.5px] font-semibold",
                                item.result === "mismatch" && "text-mismatch-700",
                                item.result === "needs_review" && "text-review-700",
                                item.result === "failed" && "text-failed-700",
                                item.result === "processing" && "text-processing-700",
                              )}
                            >
                              {item.issue}
                            </span>
                            {item.issueDetail && (
                              <span className="mt-0.5 block max-w-[190px] truncate font-mono text-[11px] text-ink-500">
                                {item.issueDetail}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span
                            title="No mismatch detected"
                            className="cursor-help text-[13px] text-ink-300"
                          >
                            —
                          </span>
                        )}
                      </td>

                      <td className="border-t border-line px-4 py-4 align-middle text-[12.5px] text-ink-500">
                        {item.updated}
                      </td>

                      <td className="border-t border-line px-4 py-4 text-right align-middle">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (item.action === "retry") retryCase(item.id);
                            else if (item.action === "review") reviewCase(item);
                            else openCase(item);
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-all",
                            item.action === "view" &&
                              "border border-edge bg-surface/70 text-ink-700 shadow-glass hover:bg-surface hover:text-ink-900",
                            // Status ramps invert in dark mode, so these keep a
                            // solid fill with theme-appropriate label colour.
                            item.action === "review" &&
                              "bg-review-500 text-white shadow-glass hover:brightness-105 dark:text-canvas",
                            item.action === "retry" &&
                              "bg-failed-500 text-white shadow-glass hover:brightness-105 dark:text-canvas",
                          )}
                        >
                          <ActionIcon className="size-3.5" strokeWidth={2.25} />
                          {action.label}
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

      <CaseDrawer verificationCase={activeCase} onClose={closeCase} onRetry={(id) => void retryCase(id)} />
    </>
  );
}

function FieldsMeter({ checked }: { checked: number | null }) {
  if (checked === null) {
    return <span className="text-[13px] text-ink-300">—</span>;
  }

  const total = 7;
  const complete = checked === total;

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="tabular whitespace-nowrap text-[12.5px] font-medium text-ink-700">
        {checked} / {total}
      </span>
      <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-surface/80 ring-1 ring-inset ring-line">
        <span
          className={cn(
            "block h-full rounded-full bg-gradient-to-r",
            complete ? "from-matched-500 to-matched-700" : "from-processing-500 to-processing-700",
          )}
          style={{ width: `${(checked / total) * 100}%` }}
        />
      </span>
    </span>
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
