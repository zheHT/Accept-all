"use client";

import { useMemo, useState } from "react";
import { Mail, Search } from "lucide-react";
import { getCase, getInbox, type CaseDetail, type CaseSummary } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";
import { formatDate } from "@/lib/format";
import { CaseDetailPanel } from "@/components/cases/case-detail-panel";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";

export function InboxView() {
  const query = useLiveQuery((signal) => getInbox(signal), []);
  const [needle, setNeedle] = useState("");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const visible = useMemo(() => (query.data?.items ?? []).filter((item) => [item.sender, item.subject, item.category].join(" ").toLowerCase().includes(needle.toLowerCase())), [query.data, needle]);
  const open = async (item: CaseSummary) => setDetail(await getCase(item.case_id));

  if (query.loading && !query.data) return <LoadingState label="Loading Gmail inbox" />;
  if (query.error && !query.data) return <ErrorState message={query.error} retry={() => void query.refresh()} />;
  return (
    <>
      {query.stale && <StaleNotice />}
      <section className="glass glass-sheen overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div><h2 className="text-[15px] font-semibold text-ink-900">Gmail intake</h2><p className="mt-1 text-[12px] text-ink-500">Live messages already admitted to the ClassAll processing pipeline.</p></div>
          <label className="relative min-w-64"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" /><input className="field-glass pl-9" value={needle} onChange={(event) => setNeedle(event.target.value)} placeholder="Search inbox" /></label>
        </header>
        {!visible.length ? <EmptyState title="Inbox is clear" detail="New Gmail cases will appear after synchronization." /> : <ul className="divide-y divide-line">{visible.map((item) => <li key={item.case_id}><button type="button" onClick={() => void open(item)} className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-surface/70 active:scale-[0.995]"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"><Mail className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="truncate text-[13px] font-semibold text-ink-900">{item.sender || "Unknown sender"}</span><span className="shrink-0 text-[11px] text-ink-400">{formatDate(item.received_at || item.created_at)}</span></span><span className="mt-1 block truncate text-[13px] text-ink-700">{item.subject || "No subject"}</span><span className="mt-1 block text-[11px] uppercase tracking-[0.08em] text-ink-400">{item.category || item.processing_state}</span></span></button></li>)}</ul>}
      </section>
      {detail && <CaseDetailPanel item={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
