"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Lock, Mail, ShieldCheck } from "lucide-react";
import { getSettings, saveSettings, startGmailOAuth } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";

export function SettingsView() {
  const toast = useToast();
  const query = useLiveQuery((signal) => getSettings(signal), []);
  const [threshold, setThreshold] = useState(0.85);
  const [alerts, setAlerts] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (query.data) { setThreshold(query.data.confidence_threshold); setAlerts(query.data.mismatch_alerts_enabled) } }, [query.data]);

  if (query.loading && !query.data) return <LoadingState label="Loading operational settings" />;
  if (query.error && !query.data) return <ErrorState message={query.error} retry={() => void query.refresh()} />;
  if (!query.data) return null;

  const save = async () => {
    setSaving(true);
    try { await saveSettings({ confidence_threshold: threshold, mismatch_alerts_enabled: alerts }); await query.refresh(); toast({ title: "Operational settings saved", tone: "success" }) }
    catch { toast({ title: "Settings could not be saved", tone: "warning" }) }
    finally { setSaving(false) }
  };
  return (
    <div className="space-y-5">
      {query.stale && <StaleNotice />}
      <Panel icon={ShieldCheck} title="Verification policy" detail="Two supported controls are persisted in platform_settings/current.">
        <Row title="Confidence threshold" detail="Any extracted field below this value always enters review."><select className="field-glass w-auto" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}>{[0.75, 0.8, 0.85, 0.9, 0.95].map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></Row>
        <Row title="Telegram mismatch alerts" detail="Dashboard review cases remain available when alerts are disabled."><Switch checked={alerts} onChange={setAlerts} label="Telegram mismatch alerts" /></Row>
        {["Low-confidence fields require review", "Missing values require review", "Unreadable documents require review"].map((label) => <Row key={label} title={label} detail="This safety rule is fixed and cannot be bypassed."><span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-500"><Lock className="size-3.5" />Always on</span></Row>)}
        <div className="flex justify-end px-5 py-4"><button type="button" disabled={saving} className="btn-primary active:scale-95" onClick={() => void save()}>{saving ? "Saving…" : "Save policy"}</button></div>
      </Panel>
      <Panel icon={Mail} title="Gmail connection" detail="OAuth and watch state from the production ingestion pipeline.">
        <Row title={query.data.gmail.address || "Mailbox not configured"} detail={`Connection: ${query.data.gmail.oauth_status.replaceAll("_", " ")} · History cursor ${query.data.gmail.history_id_present ? "ready" : "not ready"}`}><button type="button" className="btn-glass active:scale-95" onClick={() => void startGmailOAuth().then(({ authorization_url }) => { window.location.assign(authorization_url) })}><ExternalLink className="size-4" />{query.data.gmail.oauth_status === "connected" ? "Reconnect" : "Connect Gmail"}</button></Row>
        {query.data.gmail.watch_expiration && <Row title="Watch expiration" detail={new Date(query.data.gmail.watch_expiration).toLocaleString("en-MY")}><span className="text-[12px] font-medium text-matched-700">Scheduled renewal</span></Row>}
      </Panel>
    </div>
  );
}

function Panel({ icon: Icon, title, detail, children }: { icon: typeof ShieldCheck; title: string; detail: string; children: React.ReactNode }) {
  return <section className="glass glass-sheen overflow-hidden"><header className="flex items-start gap-3 border-b border-line px-5 py-4"><span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"><Icon className="size-4" /></span><div><h2 className="text-[15px] font-semibold text-ink-900">{title}</h2><p className="mt-1 text-[12px] text-ink-500">{detail}</p></div></header><div className="divide-y divide-line">{children}</div></section>;
}
function Row({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div><p className="text-[13px] font-medium text-ink-900">{title}</p><p className="mt-1 text-[12px] text-ink-400">{detail}</p></div><div>{children}</div></div> }
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full active:scale-95 ${checked ? "bg-brand-600" : "bg-canvas ring-1 ring-inset ring-line"}`}><span className={`absolute top-1 size-4 rounded-full bg-white shadow transition-transform ${checked ? "left-1 translate-x-5" : "left-1"}`} /></button> }
