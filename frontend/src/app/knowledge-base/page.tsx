"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  Filter,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { PageHeading } from "@/components/app-shell/page-heading";
import {
  fetchAssumptionRegistry,
  fetchKnowledgeBaseWeeks,
  publishWeeklySnapshot,
  type AssumptionRecord,
  type KnowledgeBaseWeek,
} from "@/lib/api";

export default function KnowledgeBasePage() {
  const [weeks, setWeeks] = useState<KnowledgeBaseWeek[]>([]);
  const [assumptions, setAssumptions] = useState<AssumptionRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [w, a] = await Promise.all([
        fetchKnowledgeBaseWeeks(),
        fetchAssumptionRegistry(),
      ]);
      setWeeks(w);
      setAssumptions(a);
    } catch (err) {
      console.error("Failed to load knowledge base data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await publishWeeklySnapshot();
      await loadData();
    } catch (err) {
      console.error("Publish failed:", err);
    } finally {
      setPublishing(false);
    }
  };

  const filteredAssumptions = assumptions.filter((a) => {
    if (statusFilter === "all") return true;
    return a.status.toLowerCase() === statusFilter.toLowerCase();
  });

  return (
    <div className="flex flex-col gap-8 pb-12">
      <PageHeading
        title="Weekly Knowledge Base & Assumptions"
        subtitle="Human-readable weekly Google Docs snapshots, LLM-generated operational narratives, and evergreen assumption registry."
        actions={
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-tide-600 px-4 py-2.5 text-sm font-medium text-white shadow-brand transition-all hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles className={`size-4 ${publishing ? "animate-spin" : ""}`} />
            {publishing ? "Publishing..." : "Publish Weekly Snapshot"}
          </button>
        }
      />

      {/* 1. Weekly Knowledge Base Snapshots */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="size-5 text-brand-500" />
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">
              Weekly Knowledge Snapshots
            </h2>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-800 transition-colors"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {weeks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-surface/40 p-12 text-center backdrop-blur-sm">
            <BookOpen className="size-10 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-700">No weekly snapshots published yet</p>
            <p className="text-xs text-ink-400 mt-1 max-w-md">
              Publish your first weekly ISO snapshot to sync Google Docs with the Firestore source of truth.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {weeks.map((w) => (
              <div
                key={w.week}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-edge bg-surface/70 p-5 shadow-sm transition-all hover:border-brand-300 hover:shadow-md backdrop-blur-sm"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                      {w.week}
                    </span>
                    <span className="text-[11px] text-ink-400 font-mono">
                      {w.content_hash ? `${w.content_hash.slice(0, 8)}...` : ""}
                    </span>
                  </div>

                  <h3 className="text-base font-semibold text-ink-900 mb-1">
                    ClassAll Assumptions — {w.week}
                  </h3>
                  <p className="text-xs text-ink-500 line-clamp-3 mb-4">
                    {w.summary_narrative || "No executive summary available for this week."}
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-xs py-2 border-t border-edge/60 mb-4">
                    <div>
                      <span className="text-ink-400">Cases Analyzed:</span>{" "}
                      <span className="font-semibold text-ink-800">{w.cases_analyzed}</span>
                    </div>
                    <div>
                      <span className="text-ink-400">Rules Tracked:</span>{" "}
                      <span className="font-semibold text-ink-800">{w.assumptions_count}</span>
                    </div>
                  </div>
                </div>

                <div>
                  {w.drive_url ? (
                    <a
                      href={w.drive_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-edge bg-surface-raised px-3 py-2 text-xs font-medium text-ink-800 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-950/40"
                    >
                      <ExternalLink className="size-3.5" />
                      Open Google Doc
                    </a>
                  ) : (
                    <span className="text-xs text-ink-400 italic">No external link</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Evergreen Assumption Registry */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-tide-500" />
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">
              Evergreen Assumption Registry
            </h2>
          </div>

          <div className="flex items-center gap-1.5 self-start rounded-xl border border-edge bg-surface/50 p-1 text-xs">
            <Filter className="size-3.5 text-ink-400 ml-1.5" />
            {(["all", "accepted", "proposed", "rejected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors capitalize ${
                  statusFilter === s
                    ? "bg-brand-500 text-white shadow-sm"
                    : "text-ink-600 hover:text-ink-900 hover:bg-surface-raised"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-edge bg-surface/70 shadow-sm backdrop-blur-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-edge bg-surface-raised/80 text-xs font-semibold uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-5 py-3.5">Field</th>
                <th className="px-5 py-3.5">Normalized Value</th>
                <th className="px-5 py-3.5">Evidence Count</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Last Confirmed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {filteredAssumptions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-ink-400">
                    No assumption rules found matching &quot;{statusFilter}&quot;
                  </td>
                </tr>
              ) : (
                filteredAssumptions.map((a) => (
                  <tr key={a.assumption_id} className="hover:bg-surface-raised/40 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-ink-900">{a.field}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-ink-700">
                      {a.normalized_value}
                    </td>
                    <td className="px-5 py-3.5 text-ink-600 font-semibold">{a.evidence_count}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                          a.status === "accepted"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : a.status === "rejected"
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}
                      >
                        {a.status === "accepted" && <CheckCircle2 className="size-3" />}
                        {a.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-ink-500">
                      {a.last_confirmed_by
                        ? `${a.last_confirmed_by} (${a.last_confirmed_date || ""})`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
