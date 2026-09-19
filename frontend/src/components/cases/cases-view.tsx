"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RotateCcw, Search } from "lucide-react";
import { ApiError, getCase, getCases, retryCase, type CaseDetail, type CaseSummary } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";
import { downloadCsv } from "@/lib/export-csv";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { LiveCaseTable } from "./live-case-table";
import { CaseDetailPanel } from "./case-detail-panel";

export function CasesView() {
  const toast = useToast();
  const query = useLiveQuery((signal) => getCases(signal), []);
  const [needle, setNeedle] = useState("");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [mutating, setMutating] = useState(false);
  const visible = useMemo(() => (query.data?.items ?? []).filter((item) => [item.case_id, item.subject, item.sender].join(" ").toLowerCase().includes(needle.toLowerCase())), [query.data, needle]);

  const open = async (item: CaseSummary) => {
    const next = await getCase(item.case_id);
    setDetail(next);
    window.history.replaceState(null, "", `?case=${item.case_id}`);
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("case");
    if (id) void getCase(id).then(setDetail).catch(() => undefined);
  }, []);

  if (query.loading && !query.data) return <LoadingState label="Loading verification cases" />;
  if (query.error && !query.data) return <ErrorState message={query.error} retry={() => void query.refresh()} />;

  const exportRows = () => {
    downloadCsv(`classall-cases-${new Date().toISOString().slice(0, 10)}.csv`, visible.map((item) => ({
      "Case ID": item.case_id, Source: item.source_type, Subject: item.subject, Category: item.category || "", Status: item.status || item.processing_state, Findings: [...item.defect_fields, ...item.low_confidence_fields].join("; "), Created: item.created_at,
    })));
    toast({ title: "Live cases exported", description: `${visible.length} currently loaded cases were written to CSV.`, tone: "success" });
  };

  return (
    <>
      {query.stale && <StaleNotice />}
      <section className="glass glass-sheen overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <label className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" /><input className="field-glass pl-9" value={needle} onChange={(event) => setNeedle(event.target.value)} placeholder="Search case, sender, or subject" /></label>
          <button type="button" className="btn-primary active:scale-95" onClick={exportRows}><Download className="size-4" />Export loaded rows</button>
        </header>
        <LiveCaseTable items={visible} onOpen={(item) => void open(item)} />
      </section>
      {detail && <CaseDetailPanel item={detail} onClose={() => { setDetail(null); window.history.replaceState(null, "", window.location.pathname) }} footer={detail.processing_state === "DEAD_LETTER" ? <button type="button" disabled={mutating} className="btn-primary active:scale-95" onClick={() => { setMutating(true); void retryCase(detail).then(async () => { await query.refresh(); setDetail(await getCase(detail.case_id)); toast({ title: "Case queued for retry", tone: "success" }) }).catch((error) => { toast({ title: error instanceof ApiError && error.status === 409 ? "Case changed. Review the refreshed version and retry." : "Retry failed", tone: "warning" }); void open(detail) }).finally(() => setMutating(false)) }}><RotateCcw className="size-4" />Retry processing</button> : undefined} />}
    </>
  );
}
