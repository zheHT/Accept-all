"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { PageHeading } from "@/components/app-shell/page-heading";
import { getCase, getDashboard, type CaseDetail, type DashboardResponse } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";
import { downloadCsv } from "@/lib/export-csv";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { LiveCaseTable } from "@/components/cases/live-case-table";
import { CaseDetailPanel } from "@/components/cases/case-detail-panel";

const PERIODS: DashboardResponse["period"][] = ["day", "week", "month"];

export function DashboardView() {
  const toast = useToast();
  const [period, setPeriod] = useState<DashboardResponse["period"]>("week");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const query = useLiveQuery((signal) => getDashboard(period, signal), [period]);
  const data = query.data;

  const exportLive = () => {
    if (!data) return;
    downloadCsv(`classall-${period}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ...Object.entries(data.metrics).map(([metric, value]) => ({ Period: period, Metric: metric, Value: value })),
      ...data.attention_items.map((item) => ({ Period: period, Metric: item.case_id, Value: item.status || item.processing_state })),
    ]);
    toast({ title: "Live dashboard exported", description: `The selected ${period} metrics and loaded attention rows were written to CSV.`, tone: "success" });
  };

  if (query.loading && !data) return <LoadingState label="Loading live operations summary" />;
  if (query.error && !data) return <ErrorState message={query.error} retry={() => void query.refresh()} />;
  if (!data) return null;
  return (
    <div className="flex flex-col gap-7">
      <PageHeading title="Dashboard" subtitle="Live verification activity and unresolved cases in Asia/Kuala_Lumpur." actions={<button type="button" className="btn-primary active:scale-95" onClick={exportLive}><Download className="size-4" />Export {period}</button>} />
      {query.stale && <StaleNotice />}
      <section className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Reporting period</p><p className="mt-1 text-[12px] text-ink-500">Updated {new Date(data.generated_at).toLocaleTimeString("en-MY")}</p></div><div className="flex rounded-xl bg-surface p-1 ring-1 ring-inset ring-line">{PERIODS.map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`rounded-lg px-3 py-2 text-[12px] font-medium capitalize active:scale-95 ${period === value ? "bg-canvas text-brand-700 shadow-glass" : "text-ink-500"}`}>{value}</button>)}</div></section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
        ["Total cases", data.metrics.total], ["Matched", data.metrics.matches], ["Mismatches", data.metrics.mismatches], ["Needs review", data.metrics.needs_review], ["Processing", data.metrics.processing],
      ].map(([label, value]) => <article key={String(label)} className="glass px-5 py-4"><p className="text-[11px] uppercase tracking-[0.08em] text-ink-400">{label}</p><p className="tabular mt-3 text-[28px] font-semibold tracking-[-0.012em] text-ink-900">{value}</p></article>)}</section>
      <section className="glass glass-sheen overflow-hidden"><header className="border-b border-line px-5 py-4"><h2 className="text-[15px] font-semibold text-ink-900">Cases requiring attention</h2><p className="mt-1 text-[12px] text-ink-500">Newest unresolved mismatch and review cases.</p></header><LiveCaseTable items={data.attention_items} onOpen={(item) => void getCase(item.case_id).then(setDetail)} emptyTitle="Nothing requires attention" /></section>
      {detail && <CaseDetailPanel item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
