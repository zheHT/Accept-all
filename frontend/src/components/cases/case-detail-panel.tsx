"use client";

import { Download, X } from "lucide-react";
import type { CaseDetail } from "@/lib/api";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";

export function CaseDetailPanel({ item, onClose, footer }: { item: CaseDetail; onClose: () => void; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/20" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto overscroll-contain bg-canvas shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-canvas/95 px-6 py-5 backdrop-blur">
          <div><p className="eyebrow">{item.case_id}</p><h2 className="mt-2 text-[20px] font-semibold tracking-[-0.012em] text-ink-900">{item.subject || "Verification case"}</h2><p className="mt-1 text-[12px] text-ink-500">{item.sender} · {formatDate(item.created_at)}</p></div>
          <button type="button" aria-label="Close case" onClick={onClose} className="grid size-10 place-items-center rounded-xl text-ink-500 hover:bg-surface active:scale-95"><X className="size-5" /></button>
        </header>
        <div className="space-y-7 p-6">
          <section><h3 className="text-[13px] font-semibold text-ink-900">Source email</h3><p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-ink-600">{item.body || "No plain-text body was stored."}</p></section>
          <section><h3 className="text-[13px] font-semibold text-ink-900">Documents</h3><ul className="mt-3 grid gap-2 sm:grid-cols-2">{item.documents.map((document) => <li key={document.document_id} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-inset ring-line"><p className="truncate text-[13px] font-medium text-ink-800">{document.filename}</p><p className="mt-1 text-[11px] text-ink-400">{document.document_type} · {(document.size_bytes / 1024).toFixed(1)} KB</p><button type="button" className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 active:scale-95" onClick={() => void apiFetch<{ url: string }>(`/api/cases/${item.case_id}/documents/${document.document_id}/download`).then(({ url }) => window.open(url, "_blank", "noopener,noreferrer"))}><Download className="size-3.5" />Download</button></li>)}</ul></section>
          <section><h3 className="text-[13px] font-semibold text-ink-900">Seven-field verification</h3><div className="mt-3 overflow-hidden rounded-xl ring-1 ring-inset ring-line"><table className="w-full text-left text-[12px]"><thead className="bg-surface text-ink-400"><tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">SI</th><th className="px-3 py-2">B/L</th><th className="px-3 py-2">Result</th></tr></thead><tbody>{item.comparisons.map((comparison) => <tr key={comparison.field}><td className="border-t border-line px-3 py-3 font-medium text-ink-800">{comparison.label}</td><td className="border-t border-line px-3 py-3 text-ink-600">{comparison.si.value ?? "Missing"}</td><td className="border-t border-line px-3 py-3 text-ink-600">{comparison.bl.value ?? "Missing"}</td><td className={`border-t border-line px-3 py-3 font-medium ${comparison.matches && !comparison.low_confidence ? "text-matched-700" : "text-review-700"}`}>{comparison.low_confidence ? "Low confidence" : comparison.matches ? "Match" : "Mismatch"}</td></tr>)}</tbody></table></div></section>
          {item.draft && <section><h3 className="text-[13px] font-semibold text-ink-900">Gmail draft</h3><p className="mt-2 text-[13px] font-medium text-ink-800">{item.draft.subject}</p><p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface p-4 text-[12px] leading-6 text-ink-600 ring-1 ring-inset ring-line">{item.draft.body}</p></section>}
        </div>
        {footer && <footer className="sticky bottom-0 border-t border-line bg-canvas/95 px-6 py-4 backdrop-blur">{footer}</footer>}
      </aside>
    </div>
  );
}
