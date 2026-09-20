"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { PageHeading } from "@/components/app-shell/page-heading";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { useToast } from "@/components/ui/toast";
import {
  fetchAssumptionRegistry,
  fetchKnowledgeBaseWeeks,
  fetchKnowledgePreview,
  publishWeeklySnapshot,
  type AssumptionRecord,
  type KnowledgeBaseWeek,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useLiveQuery } from "@/lib/use-live-query";

type RegistryFilter = "all" | "accepted" | "proposed";

const REGISTRY_FILTERS: Array<{ id: RegistryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "accepted", label: "Accepted" },
  { id: "proposed", label: "Proposed" },
];

export default function KnowledgeBasePage() {
  const toast = useToast();
  const weeks = useLiveQuery((signal) => fetchKnowledgeBaseWeeks(signal), []);
  const registry = useLiveQuery((signal) => fetchAssumptionRegistry(signal), []);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState<{ title: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [registryFilter, setRegistryFilter] = useState<RegistryFilter>("all");
  const [registryQuery, setRegistryQuery] = useState("");

  const publications = weeks.data || [];
  const assumptions = useMemo(() => registry.data || [], [registry.data]);
  const latest = publications[0];
  const totalCases = publications.reduce((sum, item) => sum + item.cases_analyzed, 0);
  const acceptedCount = assumptions.filter((item) => item.status === "accepted").length;

  const visibleAssumptions = useMemo(() => {
    const needle = registryQuery.trim().toLowerCase();
    return assumptions.filter((item) => {
      if (registryFilter !== "all" && item.status !== registryFilter) return false;
      if (!needle) return true;
      return [item.field, item.normalized_value, item.status]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [assumptions, registryFilter, registryQuery]);

  const publish = async () => {
    setPublishing(true);
    try {
      const published = await publishWeeklySnapshot();
      await Promise.all([weeks.refresh(), registry.refresh()]);
      toast({
        title: `${formatWeek(published.week)} published`,
        description: `${published.cases_analyzed} cases were included in the weekly knowledge document.`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Knowledge publication failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setPublishing(false);
    }
  };

  const openPreview = async (week: KnowledgeBaseWeek) => {
    setPreviewLoading(week.week);
    try {
      const html = await fetchKnowledgePreview(`ClassAll_Assumptions_${week.week}`);
      setPreview({ title: `ClassAll weekly knowledge, ${formatWeek(week.week)}`, html });
    } catch (error) {
      toast({
        title: "Preview could not be opened",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setPreviewLoading(null);
    }
  };

  if (weeks.loading && !weeks.data) return <LoadingState label="Loading knowledge base" />;
  if (weeks.error && !weeks.data) {
    return <ErrorState message={weeks.error} retry={() => void weeks.refresh()} />;
  }

  return (
    <div className="flex flex-col gap-7">
      <PageHeading
        title="Knowledge Base"
        subtitle="Weekly operational briefings, verified patterns, and the assumptions reviewers have governed over time."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-glass active:scale-95"
              disabled={weeks.loading || registry.loading}
              onClick={() => {
                void Promise.all([weeks.refresh(), registry.refresh()]);
                toast({ title: "Knowledge base refreshed", tone: "info" });
              }}
            >
              <RefreshCw className={cn("size-3.5", (weeks.loading || registry.loading) && "animate-spin")} />
              Refresh
            </button>
            <button
              type="button"
              className="btn-primary active:scale-95"
              disabled={publishing}
              onClick={() => void publish()}
            >
              <RefreshCw className={cn("size-4", publishing && "animate-spin")} />
              {publishing ? "Publishing…" : "Publish current week"}
            </button>
          </div>
        }
      />

      {(weeks.stale || registry.stale) && <StaleNotice />}

      <KnowledgeSummary
        publications={publications.length}
        totalCases={totalCases}
        assumptions={assumptions.length}
        accepted={acceptedCount}
        latest={latest}
      />

      <section className="grid min-w-0 gap-5 xl:max-h-[850px] xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
        <article className="glass glass-sheen flex min-w-0 flex-col overflow-hidden">
          <header className="flex shrink-0 flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">Weekly briefings</h2>
              <p className="mt-1 text-[12.5px] text-ink-500">
                Each publication summarizes the requested ISO week and preserves its source watermark.
              </p>
            </div>
            <span className="tabular rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
              {publications.length} published
            </span>
          </header>

          {!publications.length ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                title="No weekly briefings yet"
                detail="Publish the current week after reviewed operational cases are available."
              />
            </div>
          ) : (
            <ol className="flex-1 min-h-0 divide-y divide-line overflow-y-auto max-h-[600px] xl:max-h-none">
              {publications.map((week, index) => (
                <WeeklyBriefing
                  key={week.week}
                  week={week}
                  latest={index === 0}
                  loading={previewLoading === week.week}
                  onPreview={() => void openPreview(week)}
                />
              ))}
            </ol>
          )}
        </article>

        <article className="glass glass-sheen flex min-w-0 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-line px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">Assumption registry</h2>
                <p className="mt-1 text-[12.5px] text-ink-500">Evidence-backed operational interpretations.</p>
              </div>
              <span className="tabular text-[12px] font-semibold text-ink-500">{assumptions.length}</span>
            </div>

            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={registryQuery}
                onChange={(event) => setRegistryQuery(event.target.value)}
                placeholder="Search field or interpretation…"
                className="field-glass py-2.5 pl-9 pr-3"
              />
            </label>

            <div className="mt-3 flex gap-1 rounded-xl bg-canvas/70 p-1 ring-1 ring-inset ring-line">
              {REGISTRY_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={registryFilter === filter.id}
                  onClick={() => setRegistryFilter(filter.id)}
                  className={cn(
                    "min-h-9 flex-1 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors active:scale-95",
                    registryFilter === filter.id
                      ? "bg-surface text-ink-900 shadow-glass"
                      : "text-ink-400 hover:text-ink-700",
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            {registry.error && !registry.data ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <ErrorState message={registry.error} retry={() => void registry.refresh()} />
              </div>
            ) : registry.loading && !registry.data ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <LoadingState label="Loading governed assumptions" />
              </div>
            ) : !visibleAssumptions.length ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                  title={assumptions.length ? "No assumptions match" : "No governed assumptions"}
                  detail={assumptions.length ? "Try another search or status filter." : "Reviewed assumptions will accumulate here."}
                />
              </div>
            ) : (
              <ul className="flex-1 min-h-0 divide-y divide-line overflow-y-auto max-h-[600px] xl:max-h-none">
                {visibleAssumptions.map((item) => <AssumptionItem key={item.assumption_id} item={item} />)}
              </ul>
            )}
          </div>
        </article>
      </section>

      <KnowledgePreview preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function KnowledgeSummary({
  publications,
  totalCases,
  assumptions,
  accepted,
  latest,
}: {
  publications: number;
  totalCases: number;
  assumptions: number;
  accepted: number;
  latest?: KnowledgeBaseWeek;
}) {
  const stats = [
    { label: "Published weeks", value: publications, support: "Immutable weekly snapshots", icon: CalendarDays, accent: "bg-brand-500" },
    { label: "Cases summarized", value: totalCases, support: "Across published periods", icon: FileText, accent: "bg-processing-500" },
    { label: "Governed assumptions", value: assumptions, support: `${accepted} accepted by reviewers`, icon: Database, accent: "bg-review-500" },
    { label: "Latest briefing", value: latest ? shortWeek(latest.week) : "None", support: latest ? formatDate(latest.published_at) : "Publish the first report", icon: ShieldCheck, accent: "bg-matched-500" },
  ];

  return (
    <section className="glass glass-sheen grid grid-cols-2 overflow-hidden lg:grid-cols-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className={cn(
              "relative min-w-0 px-4 py-4 sm:px-5",
              index % 2 === 1 && "border-l border-line",
              index >= 2 && "border-t border-line lg:border-t-0",
              index > 0 && "lg:border-l lg:border-line",
            )}
          >
            <span className={cn("absolute inset-x-0 top-0 h-[3px] opacity-70", stat.accent)} />
            <div className="flex items-center gap-2 text-ink-400">
              <Icon className="size-4" />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em]">{stat.label}</span>
            </div>
            <p className="tabular mt-3 truncate text-[26px] font-semibold leading-none tracking-tight text-ink-900">{stat.value}</p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">{stat.support}</p>
          </div>
        );
      })}
    </section>
  );
}

function WeeklyBriefing({
  week,
  latest,
  loading,
  onPreview,
}: {
  week: KnowledgeBaseWeek;
  latest: boolean;
  loading: boolean;
  onPreview: () => void;
}) {
  const outcomes = [
    { label: "Matched", value: week.status_counts.OK || 0, tone: "bg-matched-500" },
    { label: "Mismatch", value: week.status_counts.MISMATCH || 0, tone: "bg-mismatch-500" },
    { label: "Review", value: week.status_counts.NEEDS_REVIEW || 0, tone: "bg-review-500" },
  ];
  const outcomeTotal = outcomes.reduce((sum, item) => sum + item.value, 0);
  const categories = Object.entries(week.category_counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
  const isRealDriveUrl =
    Boolean(week.drive_url?.startsWith("https://")) &&
    !week.drive_url?.includes("ClassAll_");
  const externalDriveUrl = isRealDriveUrl ? week.drive_url : null;

  return (
    <li className="px-5 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold tracking-tight text-ink-900">{formatWeek(week.week)}</p>
            {latest && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-700 ring-1 ring-inset ring-brand-200">
                Latest
              </span>
            )}
            <span className="rounded-full bg-matched-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-matched-700 ring-1 ring-inset ring-matched-200">
              {week.status}
            </span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-400">
            <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />Published {formatDate(week.published_at)}</span>
            <span className="font-mono">{week.content_hash.slice(0, 10)}</span>
          </p>
          <p className="mt-3 max-w-3xl text-pretty text-[13px] leading-6 text-ink-500">
            {week.summary_narrative || "This weekly snapshot contains deterministic operational counts and governed reviewer assumptions."}
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <div className="flex h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-line">
                {outcomes.map((outcome) => (
                  <span
                    key={outcome.label}
                    className={outcome.tone}
                    style={{ width: `${outcomeTotal ? (outcome.value / outcomeTotal) * 100 : 0}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {outcomes.map((outcome) => (
                  <span key={outcome.label} className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
                    <span className={cn("size-1.5 rounded-full", outcome.tone)} />
                    {outcome.label} <strong className="tabular font-semibold text-ink-700">{outcome.value}</strong>
                  </span>
                ))}
              </div>
            </div>
            <dl className="flex gap-5 sm:justify-end">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-ink-400">Cases</dt>
                <dd className="tabular mt-1 text-[16px] font-semibold text-ink-900">{week.cases_analyzed}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.08em] text-ink-400">Assumptions</dt>
                <dd className="tabular mt-1 text-[16px] font-semibold text-ink-900">{week.assumptions_count}</dd>
              </div>
            </dl>
          </div>

          {categories.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {categories.map(([category, count]) => (
                <span key={category} className="rounded-md bg-surface px-2 py-1 text-[10.5px] font-medium text-ink-500 ring-1 ring-inset ring-line">
                  {category.replaceAll("_", " ")} · {count}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {externalDriveUrl ? (
            <a href={externalDriveUrl} target="_blank" rel="noreferrer" className="btn-glass active:scale-95">
              <ExternalLink className="size-4" />
              Google Doc
            </a>
          ) : (
            <button
              type="button"
              className="btn-glass active:scale-95"
              disabled={loading}
              onClick={onPreview}
              title="Open document briefing"
            >
              <FileText className="size-4" />
              Doc
            </button>
          )}
          <button type="button" className="btn-primary active:scale-95" disabled={loading} onClick={onPreview}>
            {loading ? <RefreshCw className="size-4 animate-spin" /> : <BookOpen className="size-4" />}
            {loading ? "Opening…" : "Read briefing"}
          </button>
        </div>
      </div>
    </li>
  );
}

function AssumptionItem({ item }: { item: AssumptionRecord }) {
  const accepted = item.status === "accepted";
  return (
    <li className="px-5 py-4 transition-colors hover:bg-canvas/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-ink-900">{humanize(item.field)}</p>
          <p className="mt-1.5 text-pretty text-[12.5px] leading-5 text-ink-500">{item.normalized_value}</p>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset",
          accepted
            ? "bg-matched-50 text-matched-700 ring-matched-200"
            : "bg-review-50 text-review-700 ring-review-200",
        )}>
          {item.status}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ink-400">
        <span className="tabular">{item.evidence_count} linked case{item.evidence_count === 1 ? "" : "s"}</span>
        <span className="tabular">{Math.round(item.confidence * 100)}% confidence</span>
        {item.last_confirmed_by && <span>Confirmed by {item.last_confirmed_by}</span>}
      </div>
    </li>
  );
}


function KnowledgePreview({
  preview,
  onClose,
}: {
  preview: { title: string; html: string } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!preview) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, preview]);

  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-0 sm:p-5">
      <button type="button" aria-label="Close knowledge preview" onClick={onClose} className="absolute inset-0 bg-overlay backdrop-blur-sm" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={preview.title}
        className="glass-solid relative flex h-full w-full flex-col overflow-hidden rounded-none sm:h-[90vh] sm:max-w-6xl sm:rounded-2xl"
      >
        <header className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
            <BookOpen className="size-[17px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-ink-900">{preview.title}</p>
            <p className="mt-0.5 text-[11px] text-ink-400">Rendered Markdown · authenticated preview</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Open document in new browser tab"
              onClick={() => {
                const blob = new Blob([preview.html], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                window.open(url, "_blank");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface/80 px-2.5 py-1.5 text-[12px] font-medium text-ink-600 transition-colors hover:bg-surface hover:text-ink-900 active:scale-95"
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">New tab</span>
            </button>
            <button type="button" aria-label="Close preview" onClick={onClose} className="grid size-9 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-surface hover:text-ink-900 active:scale-95">
              <X className="size-5" />
            </button>
          </div>
        </header>
        <iframe
          title={preview.title}
          sandbox=""
          srcDoc={preview.html}
          className="min-h-0 flex-1 bg-white"
        />
      </section>
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWeek(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  return match ? `Week ${Number(match[2])}, ${match[1]}` : value;
}

function shortWeek(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  return match ? `W${Number(match[2])} · ${match[1]}` : value;
}
