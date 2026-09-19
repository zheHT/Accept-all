"use client";

import { useEffect, useState } from "react";
import { Check, Send, ThumbsDown } from "lucide-react";
import { ApiError, getCase, getReviews, reviewCase, sendDraft, updateDraft, type CaseDetail, type CaseSummary } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";
import { useToast } from "@/components/ui/toast";
import { CaseDetailPanel } from "@/components/cases/case-detail-panel";
import { LiveCaseTable } from "@/components/cases/live-case-table";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";

export function ReviewView() {
  const toast = useToast();
  const query = useLiveQuery((signal) => getReviews(signal), []);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async (item: CaseSummary | CaseDetail) => {
    const next = await getCase(item.case_id);
    setDetail(next);
    setSubject(next.draft?.subject || "");
    setBody(next.draft?.body || "");
    window.history.replaceState(null, "", `?case=${item.case_id}`);
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("case");
    if (id) void getCase(id).then((item) => { setDetail(item); setSubject(item.draft?.subject || ""); setBody(item.draft?.body || "") }).catch(() => undefined);
  }, []);

  const stale = async (error: unknown) => {
    if (error instanceof ApiError && error.status === 409 && detail) {
      await open(detail);
      toast({ title: "Case changed", description: "The latest version is open. Review it and repeat the action.", tone: "warning" });
      return true;
    }
    return false;
  };
  const decide = async (decision: "APPROVE" | "DECLINE") => {
    if (!detail) return;
    setBusy(true);
    try {
      await reviewCase(detail, decision);
      await query.refresh();
      if (decision === "APPROVE") {
        setDetail(null);
        toast({ title: "Case approved", tone: "success" });
      } else {
        await open(detail);
        toast({ title: detail.source_type === "gmail" ? "Gmail draft created" : "Case declined", tone: "success" });
      }
    } catch (error) {
      if (!(await stale(error))) toast({ title: "Review action failed", tone: "warning" });
    } finally { setBusy(false) }
  };

  if (query.loading && !query.data) return <LoadingState label="Loading unresolved reviews" />;
  if (query.error && !query.data) return <ErrorState message={query.error} retry={() => void query.refresh()} />;

  return (
    <>
      {query.stale && <StaleNotice />}
      <section className="glass glass-sheen overflow-hidden"><header className="border-b border-line px-5 py-4"><h2 className="text-[15px] font-semibold text-ink-900">Unresolved review cases</h2><p className="mt-1 text-[12px] text-ink-500">Approve a result or decline it and prepare a guarded Gmail draft.</p></header><LiveCaseTable items={query.data?.items ?? []} onOpen={(item) => void open(item)} emptyTitle="No unresolved reviews" /></section>
      {detail && <CaseDetailPanel item={detail} onClose={() => { setDetail(null); window.history.replaceState(null, "", window.location.pathname) }} footer={detail.draft ? <div className="space-y-3"><label className="block text-[12px] font-medium text-ink-700">Draft subject<input className="field-glass mt-1" value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label className="block text-[12px] font-medium text-ink-700">Draft body<textarea className="field-glass mt-1 min-h-32 resize-y" value={body} onChange={(event) => setBody(event.target.value)} /></label><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn-glass active:scale-95" onClick={() => { setBusy(true); void updateDraft(detail.case_id, detail.version, subject, body).then(() => open(detail)).then(() => toast({ title: "Draft saved", tone: "success" })).catch(stale).finally(() => setBusy(false)) }}>Save draft</button><button type="button" disabled={busy} className="btn-primary active:scale-95" onClick={() => { setBusy(true); void sendDraft(detail.case_id, detail.version, detail.draft?.content_hash || "").then(() => query.refresh()).then(() => { setDetail(null); toast({ title: "Draft sent", tone: "success" }) }).catch(stale).finally(() => setBusy(false)) }}><Send className="size-4" />Send Gmail draft</button></div></div> : <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn-primary active:scale-95" onClick={() => void decide("APPROVE")}><Check className="size-4" />Approve</button><button type="button" disabled={busy} className="btn-glass active:scale-95" onClick={() => void decide("DECLINE")}><ThumbsDown className="size-4" />Decline and draft</button></div>} />}
    </>
  );
}
