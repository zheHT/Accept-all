"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw, Search, SearchX, UserRoundSearch, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatBar, type StatSegment } from "@/components/ui/stat-bar";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { ReviewDetail } from "./review-detail";
import {
  REVIEW_REASON_LABELS,
  REVIEW_STATUS_META,
  type ReviewCase,
  type ReviewDecision,
  type ReviewReasonCode,
} from "@/lib/review-data";
import { readParam, writeParam } from "@/lib/url-state";
import {
  ApiError,
  confirmSentDraft,
  getCase,
  getReviews,
  prepareDraft,
  reviewField,
  reviewCase as reviewApiCase,
  sendDraft,
  updateDraft,
  type CaseDetail,
} from "@/lib/api";
import { reviewDetail, reviewSummary } from "@/lib/live-view-models";
import { useLiveQuery } from "@/lib/use-live-query";

type ReasonFilter = "all" | ReviewReasonCode;
/** Which summary card is acting as a filter. */
type GroupFilter = "none" | "pending" | "unreadable_missing" | "ambiguous";
type SortOrder = "oldest" | "newest";

const REASON_OPTIONS: Array<{ value: ReasonFilter; label: string }> = [
  { value: "all", label: "All Reasons" },
  ...(Object.keys(REVIEW_REASON_LABELS) as ReviewReasonCode[]).map((value) => ({
    value,
    label: REVIEW_REASON_LABELS[value],
  })),
];

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  { value: "oldest", label: "Oldest First" },
  { value: "newest", label: "Newest First" },
];

const GROUP_REASONS: Record<Exclude<GroupFilter, "none" | "pending">, ReviewReasonCode[]> = {
  unreadable_missing: ["unreadable_document", "missing_information"],
  ambiguous: ["ambiguous_value", "low_confidence", "processing_issue"],
};

export function ReviewView() {
  const toast = useToast();
  const liveReviews = useLiveQuery((signal) => getReviews(signal), []);
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<CaseDetail | null>(null);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState<ReasonFilter>("all");
  const [group, setGroup] = useState<GroupFilter>("none");
  const [sort, setSort] = useState<SortOrder>("oldest");
  const [displayLimit, setDisplayLimit] = useState(25);
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [isConfirmingSent, setIsConfirmingSent] = useState(false);

  useEffect(() => {
    if (!liveReviews.data) return;
    const incoming = liveReviews.data.items.map(reviewSummary);
    setCases((current) => {
      const activeResolved = current.find((item) => item.id === openId && item.status === "resolved");
      const activeDetail = current.find((item) => item.id === openId && item.comparisonFields?.length);
      const merged = incoming.map((item) => item.id === activeDetail?.id ? activeDetail : item);
      return activeResolved && !merged.some((item) => item.id === activeResolved.id)
        ? [activeResolved, ...merged]
        : merged;
    });
  }, [liveReviews.data, openId]);

  /** `?case=1022` opens a case directly, including from the Verification Cases page. */
  useEffect(() => {
    const requested = readParam("case");
    if (requested && liveReviews.data?.items.some((item) => item.case_id === requested)) {
      setOpenId(requested);
      void getCase(requested).then((detail) => {
        setActiveDetail(detail);
        setCases((current) => current.some((item) => item.id === requested)
          ? current.map((item) => item.id === requested ? reviewDetail(detail) : item)
          : [reviewDetail(detail), ...current]);
      }).catch(() => {});
    }
  }, [liveReviews.data]);

  const openCase = useCallback(
    (item: ReviewCase) => {
      setOpenId(item.id);
      setActiveDetail(null);
      writeParam("case", item.id);
      void getCase(item.id)
        .then((detail) => {
          setActiveDetail(detail);
          setCases((current) => current.map((entry) => entry.id === item.id ? reviewDetail(detail) : entry));
        })
        .catch((error: unknown) => toast({
          title: "Review evidence is temporarily unavailable",
          description: error instanceof Error ? error.message : "Please retry.",
          tone: "warning",
        }));
    },
    [toast],
  );

  const closeCase = useCallback(() => {
    setOpenId(null);
    setActiveDetail(null);
    writeParam("case", null);
    void liveReviews.refresh();
  }, [liveReviews]);

  const submitDecision = useCallback(
    async (id: string, decision: ReviewDecision) => {
      const source = activeDetail?.case_id === id
        ? activeDetail
        : liveReviews.data?.items.find((item) => item.case_id === id);
      if (!source) return;
      const field = decision.field || source.low_confidence_fields[0] || source.defect_fields[0] || activeDetail?.comparisons[0]?.field;
      if (!field) return;
      const note = decision.notes;
      try {
        const updated = await reviewField(
          source.case_id,
          field,
          source.version,
          decision.type,
          note,
          decision.type === "correct" ? decision.value || undefined : undefined,
          decision.documentRole || "BL",
        );
        setActiveDetail(updated);
        setCases((current) => current.map((item) => item.id === id ? reviewDetail(updated) : item));
        await liveReviews.refresh();
        toast({
          title: `${field} decision saved`,
          description: decision.type === "unreadable" ? "The field remains visible as unresolved for follow-up." : "The structured review decision was recorded; the case verdict is unchanged.",
          tone: "success",
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const refreshed = await getCase(id);
          setActiveDetail(refreshed);
          setCases((current) => current.map((item) => item.id === id ? reviewDetail(refreshed) : item));
          await liveReviews.refresh();
        }
        toast({
          title: error instanceof ApiError && error.status === 409 ? "Case changed while it was open" : "Field review failed",
          description: error instanceof ApiError && error.status === 409 ? "The queue was refreshed. Please inspect the case and repeat the action." : error instanceof Error ? error.message : "Please retry.",
          tone: "warning",
        });
      }
    },
    [activeDetail, liveReviews, toast],
  );

  const saveDraft = useCallback(async (subject: string, body: string) => {
    if (!activeDetail) return;
    try {
      const updated = await updateDraft(activeDetail.case_id, activeDetail.version, subject, body);
      setActiveDetail(updated);
      toast({ title: "Correction draft saved", tone: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title: error instanceof ApiError && error.status === 409 ? "Draft changed while it was open" : "Draft save failed",
        description: error instanceof ApiError && error.status === 409 ? "The latest draft was loaded. Review it and repeat your edit." : error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    }
  }, [activeDetail, toast]);

  const deliverDraft = useCallback(async () => {
    if (!activeDetail?.draft) return;
    try {
      const updated = await sendDraft(activeDetail.case_id, activeDetail.version, activeDetail.draft.content_hash);
      setActiveDetail(updated);
      setCases((current) => current.map((item) => (item.id === activeDetail.case_id ? reviewDetail(updated) : item)));
      await liveReviews.refresh();
      toast({
        title: "Correction email sent",
        description: "Draft delivered via live Gmail. Case marked as DECLINE with SENT status.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title: error instanceof ApiError && error.status === 404 ? "Route not found (backend version mismatch)" : error instanceof ApiError && error.status === 409 ? "Draft changed before sending" : "Draft send failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    }
  }, [activeDetail, liveReviews, toast]);

  const finalizeCase = useCallback(async () => {
    if (!activeDetail || (activeDetail.unresolved_fields?.length ?? 1) > 0) return;
    try {
      await reviewApiCase(activeDetail, "APPROVE", "All structured field reviews completed.");
      const refreshed = await getCase(activeDetail.case_id);
      setActiveDetail(refreshed);
      setCases((current) => current.map((item) => item.id === activeDetail.case_id ? reviewDetail(refreshed) : item));
      await liveReviews.refresh();
      toast({ title: "Case finalized", description: "The verification result was approved after all field reviews were completed.", tone: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title: error instanceof ApiError && error.status === 404 ? "Route not found (backend version mismatch)" : "Case finalization failed",
        description: error instanceof Error ? error.message : "Resolve every field and retry.",
        tone: "warning",
      });
    }
  }, [activeDetail, liveReviews, toast]);

  const prepareCorrectionDraft = useCallback(async () => {
    if (!activeDetail) return;
    setIsPreparingDraft(true);
    try {
      const updated = await prepareDraft(activeDetail.case_id, activeDetail.version);
      setActiveDetail(updated);
      setCases((current) => current.map((item) => (item.id === activeDetail.case_id ? reviewDetail(updated) : item)));
      await liveReviews.refresh();

      if (updated.draft?.gmail_url) {
        const opened = window.open(updated.draft.gmail_url, "_blank");
        if (!opened) {
          toast({
            title: "Pop-up blocked",
            description: "Please allow pop-ups or click 'Open in Gmail' to view the draft.",
            tone: "warning",
          });
        }
      }

      toast({
        title: "AI correction draft prepared",
        description: updated.draft?.delivery_mode === "live"
          ? "Draft saved to shared Gmail mailbox with attachments. Review below before sending."
          : "Draft ready in Gmail compose window. Review below and attach documents manually.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title: error instanceof ApiError && error.status === 404 ? "Route not found (backend version mismatch)" : "Correction draft failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setIsPreparingDraft(false);
    }
  }, [activeDetail, liveReviews, toast]);

  const confirmSentCorrectionDraft = useCallback(async () => {
    if (!activeDetail) return;
    setIsConfirmingSent(true);
    try {
      const updated = await confirmSentDraft(activeDetail.case_id, activeDetail.version);
      setActiveDetail(updated);
      setCases((current) => current.map((item) => (item.id === activeDetail.case_id ? reviewDetail(updated) : item)));
      await liveReviews.refresh();
      toast({
        title: "Sent status confirmed",
        description: "Case marked as DECLINE with SENT status and recorded in audit log.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title: "Confirmation failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setIsConfirmingSent(false);
    }
  }, [activeDetail, liveReviews, toast]);

  const filtersActive = query.trim() !== "" || reason !== "all" || group !== "none" || sort !== "oldest";

  const clearFilters = () => {
    setQuery("");
    setReason("all");
    setGroup("none");
    setSort("oldest");
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = cases.filter((item) => {
      if (reason !== "all" && item.reasonCode !== reason) return false;
      if (group === "pending" && item.status === "resolved") return false;
      if (group !== "none" && group !== "pending" && !GROUP_REASONS[group].includes(item.reasonCode)) {
        return false;
      }
      if (!needle) return true;
      return [item.caseId, item.shipment, item.problemField, item.reason]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    // Resolved cases always sink to the bottom: this is a work queue first.
    return filtered.sort((a, b) => {
      const resolvedDiff = Number(a.status === "resolved") - Number(b.status === "resolved");
      if (resolvedDiff !== 0) return resolvedDiff;
      return sort === "oldest" ? b.createdOrder - a.createdOrder : a.createdOrder - b.createdOrder;
    });
  }, [cases, query, reason, group, sort]);

  const visibleRows = useMemo(() => rows.slice(0, displayLimit), [rows, displayLimit]);

  const summarySegments = useMemo<StatSegment[]>(() => {
    const pending = cases.filter((item) => item.status !== "resolved");
    const incomplete = pending.filter((item) => ["unreadable_document", "missing_information"].includes(item.reasonCode)).length;
    const ambiguous = pending.length - incomplete;
    const segment = (id: string, label: string, value: number, support: string, accent: string): StatSegment => ({
      id,
      label,
      value,
      support,
      accent,
      share: pending.length ? Math.round((value / pending.length) * 100) : 0,
    });
    return [
      segment("pending", "Pending Review", pending.length, "Cases waiting for human action", "bg-review-500"),
      segment("unreadable_missing", "Unreadable / Missing", incomplete, "Cases with incomplete document information", "bg-failed-500"),
      segment("ambiguous", "Ambiguous", ambiguous, "Cases where extracted information is uncertain", "bg-processing-500"),
    ];
  }, [cases]);

  const activeCase = openId ? (cases.find((item) => item.id === openId) ?? null) : null;

  if (liveReviews.loading && !liveReviews.data) return <LoadingState label="Loading review queue" />;
  if (liveReviews.error && !liveReviews.data) {
    return <ErrorState message={liveReviews.error} retry={() => void liveReviews.refresh()} />;
  }

  if (activeCase) {
    return (
      <ReviewDetail
        reviewCase={activeCase}
        caseDetail={activeDetail}
        onBack={closeCase}
        onSubmit={(decision) => void submitDecision(activeCase.id, decision)}
        onFinalize={() => void finalizeCase()}
        onPrepareDraft={() => void prepareCorrectionDraft()}
        onDeclineCase={() => void prepareCorrectionDraft()}
        onConfirmSentDraft={() => void confirmSentCorrectionDraft()}
        preparingDraft={isPreparingDraft}
        confirmingSent={isConfirmingSent}
        onSaveDraft={(subject, body) => void saveDraft(subject, body)}
        onSendDraft={() => void deliverDraft()}
      />
    );
  }

  return (
    <>
      {liveReviews.stale && <StaleNotice />}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Review workload — select to filter the queue</p>
        <StatBar
          segments={summarySegments}
          activeId={group}
          onSelect={(id) => setGroup(group === id ? "none" : (id as GroupFilter))}
        />
      </section>

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
              placeholder="Search shipment, case ID, or field..."
              className="field-glass py-2.5 pl-9 pr-3"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Reason filter</span>
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value as ReasonFilter)}
                className="field-glass w-auto cursor-pointer appearance-none py-2.5 pl-3 pr-9 font-medium"
              >
                {REASON_OPTIONS.map((option) => (
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

            <label className="relative">
              <span className="sr-only">Sort order</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOrder)}
                className="field-glass w-auto cursor-pointer appearance-none py-2.5 pl-3 pr-9 font-medium"
              >
                {SORT_OPTIONS.map((option) => (
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
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void liveReviews.refresh()}
            disabled={liveReviews.loading}
            aria-label="Refresh review queue"
            title="Refresh review queue"
            className="btn-glass active:scale-95"
          >
            <RefreshCw className={cn("size-3.5", liveReviews.loading && "animate-spin")} />
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
              Cases Awaiting Review
            </h2>
            <p className="mt-1 text-[13px] text-ink-500">
              The engine stopped on these cases rather than guessing a value.
            </p>
          </div>
          <span className="tabular shrink-0 text-[12px] text-ink-400">
            {visibleRows.length < rows.length
              ? `Showing ${visibleRows.length} of ${rows.length} cases`
              : `${rows.length} of ${cases.filter((item) => item.status !== "resolved").length} pending cases`}
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
            <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
              <thead className="bg-surface/45">
                <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Case
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Shipment
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Problem Field
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Review Reason
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    AI Confidence
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Current Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Created
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((item) => {
                  const status = REVIEW_STATUS_META[item.status];
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
                          className="text-[13.5px] font-semibold tracking-tight text-ink-900 underline-offset-4 hover:text-brand-700 hover:underline"
                        >
                          {item.shipment}
                        </button>
                      </td>
                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span className="text-[13px] font-semibold text-review-700">
                          {item.problemField}
                        </span>
                      </td>
                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span
                          title={item.reasonDetail}
                          className="block max-w-[260px] cursor-help text-[12.5px] text-ink-700"
                        >
                          {item.reason}
                          <span className="mt-0.5 block text-[11px] text-ink-400">
                            {REVIEW_REASON_LABELS[item.reasonCode]}
                          </span>
                        </span>
                      </td>
                      <td className="border-t border-line px-4 py-4 align-middle">
                        <ConfidenceMeter value={item.confidence} />
                      </td>
                      <td className="border-t border-line px-4 py-4 align-middle">
                        <span
                          title={status.hint}
                          className={cn(
                            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium",
                            status.chip,
                          )}
                        >
                          <span className={cn("size-1.5 rounded-full", status.dot)} />
                          {status.label}
                        </span>
                      </td>
                      <td className="border-t border-line px-4 py-4 align-middle text-[12.5px] text-ink-500">
                        {item.created}
                      </td>
                      <td className="border-t border-line px-4 py-4 text-right align-middle">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openCase(item);
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-all",
                            item.status === "resolved"
                              ? "border border-line-strong bg-surface/70 text-ink-700 shadow-glass hover:bg-surface"
                              : "bg-review-500 text-white shadow-glass hover:brightness-105 dark:text-canvas",
                          )}
                        >
                          <UserRoundSearch className="size-3.5" strokeWidth={2.25} />
                          {item.status === "resolved" ? "View" : "Review"}
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
    </>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.7 ? "from-review-500 to-review-700" : "from-failed-500 to-failed-700";

  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface/80 ring-1 ring-inset ring-line">
        <span
          className={cn("block h-full rounded-full bg-gradient-to-r", tone)}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular text-[12.5px] font-semibold text-ink-700">{pct}%</span>
    </span>
  );
}
