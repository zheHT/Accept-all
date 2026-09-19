"use client";

import { useState } from "react";
import { BookOpen, RefreshCw, X } from "lucide-react";
import { PageHeading } from "@/components/app-shell/page-heading";
import { fetchAssumptionRegistry, fetchKnowledgeBaseWeeks, fetchKnowledgePreview, publishWeeklySnapshot } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";

export default function KnowledgeBasePage() {
  const toast = useToast();
  const weeks = useLiveQuery((signal) => fetchKnowledgeBaseWeeks(signal), []);
  const registry = useLiveQuery((signal) => fetchAssumptionRegistry(signal), []);
  const [preview, setPreview] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  if (weeks.loading && !weeks.data) return <LoadingState label="Loading knowledge base" />;
  if (weeks.error && !weeks.data) return <ErrorState message={weeks.error} retry={() => void weeks.refresh()} />;
  const publish = async () => { setPublishing(true); try { await publishWeeklySnapshot(); await Promise.all([weeks.refresh(), registry.refresh()]); toast({ title: "Weekly knowledge published", tone: "success" }) } catch { toast({ title: "Knowledge publication failed", tone: "warning" }) } finally { setPublishing(false) } };
  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="Knowledge Base" subtitle="Authenticated weekly summaries and governed operational assumptions." actions={<button type="button" className="btn-primary active:scale-95" disabled={publishing} onClick={() => void publish()}><RefreshCw className={`size-4 ${publishing ? "animate-spin" : ""}`} />Publish current week</button>} />
      {(weeks.stale || registry.stale) && <StaleNotice />}
      <section className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <article className="glass glass-sheen overflow-hidden"><header className="border-b border-line px-5 py-4"><h2 className="text-[15px] font-semibold text-ink-900">Weekly publications</h2></header>{!weeks.data?.length ? <EmptyState title="No weekly publications" detail="Publish the current week when the first operational cases are ready." /> : <ul className="divide-y divide-line">{weeks.data.map((week) => <li key={week.week} className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[13px] font-semibold text-ink-900">{week.week}</p><p className="mt-1 text-[12px] text-ink-500">{week.cases_analyzed} cases · {week.assumptions_count} assumptions</p><p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-500">{week.summary_narrative}</p></div><button type="button" className="btn-glass active:scale-95" onClick={() => void fetchKnowledgePreview(`ClassAll_Assumptions_${week.week}`).then(setPreview)}><BookOpen className="size-4" />Preview</button></div></li>)}</ul>}</article>
        <article className="glass glass-sheen overflow-hidden"><header className="border-b border-line px-5 py-4"><h2 className="text-[15px] font-semibold text-ink-900">Assumption registry</h2></header>{registry.error && !registry.data ? <ErrorState message={registry.error} retry={() => void registry.refresh()} /> : !registry.data?.length ? <EmptyState title="No governed assumptions" detail="Reviewed assumptions will accumulate here." /> : <ul className="divide-y divide-line">{registry.data.map((item) => <li key={item.assumption_id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><p className="text-[13px] font-medium text-ink-900">{item.field}</p><span className="rounded-full bg-surface px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-ink-500 ring-1 ring-inset ring-line">{item.status}</span></div><p className="mt-1 text-[12px] leading-5 text-ink-500">{item.normalized_value}</p><p className="mt-2 text-[11px] text-ink-400">{item.evidence_count} linked cases</p></li>)}</ul>}</article>
      </section>
      {preview && <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/25 p-5"><section className="h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-canvas shadow-2xl"><header className="flex items-center justify-between border-b border-line px-4 py-3"><p className="text-[13px] font-semibold text-ink-900">Authenticated Markdown preview</p><button type="button" aria-label="Close preview" onClick={() => setPreview(null)} className="grid size-10 place-items-center rounded-xl hover:bg-surface active:scale-95"><X className="size-5" /></button></header><iframe title="Knowledge base preview" sandbox="" srcDoc={preview} className="h-[calc(100%-65px)] w-full bg-white" /></section></div>}
    </div>
  );
}
