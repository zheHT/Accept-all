"use client";

import { ChevronRight } from "lucide-react";
import type { CaseSummary } from "@/lib/api";
import { formatDate, statusLabel, statusTone } from "@/lib/format";
import { EmptyState } from "@/components/ui/live-state";

export function LiveCaseTable({ items, onOpen, emptyTitle = "No cases yet" }: { items: CaseSummary[]; onOpen: (item: CaseSummary) => void; emptyTitle?: string }) {
  if (!items.length) return <EmptyState title={emptyTitle} detail="New source-backed cases will appear here automatically." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left">
        <thead className="bg-surface/45 text-[11px] uppercase tracking-[0.1em] text-ink-400">
          <tr><th className="px-5 py-3">Case</th><th className="px-5 py-3">Source</th><th className="px-5 py-3">Subject</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Findings</th><th className="px-5 py-3 text-right">Created</th><th className="w-10 px-4"><span className="sr-only">Open</span></th></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.case_id} onClick={() => onOpen(item)} className="group cursor-pointer transition-colors hover:bg-surface/70">
              <td className="border-t border-line px-5 py-4 font-mono text-[12px] text-ink-700">{item.case_id}</td>
              <td className="border-t border-line px-5 py-4"><p className="text-[13px] font-medium text-ink-800">{item.sender || item.source_type}</p><p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-ink-400">{item.category || "Classifying"}</p></td>
              <td className="max-w-sm border-t border-line px-5 py-4"><p className="truncate text-[13px] text-ink-800">{item.subject || "No subject"}</p></td>
              <td className="border-t border-line px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusTone(item.status, item.processing_state)}`}>{statusLabel(item)}</span></td>
              <td className="border-t border-line px-5 py-4 text-[12px] text-ink-500">{[...item.defect_fields, ...item.low_confidence_fields].join(", ") || item.review_reason?.replaceAll("_", " ") || "None"}</td>
              <td className="border-t border-line px-5 py-4 text-right text-[12px] text-ink-500">{formatDate(item.created_at)}</td>
              <td className="border-t border-line px-4"><ChevronRight className="size-4 text-ink-300 transition-transform group-hover:translate-x-0.5" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
