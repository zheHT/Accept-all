"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatBar, type StatSegment } from "@/components/ui/stat-bar";
import type { IntakeTotals } from "@/lib/inbox-data";

/** Which slice of the intake the list is filtered to. */
export type IntakeGroup = "all" | "checks" | "other" | "spam";

const ACCENT: Record<Exclude<IntakeGroup, "all">, string> = {
  checks: "bg-brand-500",
  other: "bg-tide-500",
  spam: "bg-ink-300",
};

/**
 * Intake overview: the same segmented bar as the other pages, plus one
 * proportion strip underneath so the split between verification work and
 * everything else is visible at a glance. The sync control sits with it,
 * next to the numbers it moves.
 */
export function IntakeBreakdown({
  totals,
  active,
  onSelect,
  syncing,
  lastSync,
  onSync,
}: {
  totals: IntakeTotals;
  active: IntakeGroup;
  onSelect: (group: IntakeGroup) => void;
  syncing: boolean;
  lastSync: string | null;
  onSync: () => void;
}) {
  const pct = (value: number) => (totals.total > 0 ? (value / totals.total) * 100 : 0);

  const segments: StatSegment[] = [
    {
      id: "all",
      label: "Total Emails",
      value: totals.total,
      support: "Received this week",
      accent: "bg-ink-400",
      share: 100,
    },
    {
      id: "checks",
      label: "Document Checks",
      value: totals.checks,
      support: "Continue to SI vs BL verification",
      accent: ACCENT.checks,
      share: Math.round(pct(totals.checks)),
    },
    {
      id: "other",
      label: "Other Requests",
      value: totals.other,
      support: "New SI, invoice and general mail",
      accent: ACCENT.other,
      share: Math.round(pct(totals.other)),
    },
    {
      id: "spam",
      label: "Spam",
      value: totals.spam,
      support: "Filtered out before the case list",
      accent: ACCENT.spam,
      share: Math.round(pct(totals.spam)),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink-900">
          Inbox intake — select a category to filter
        </h2>
        <div className="flex items-center gap-3">
          {lastSync && (
            <span className="tabular text-[11.5px] text-ink-400">Last sync {lastSync}</span>
          )}
          <button type="button" onClick={onSync} disabled={syncing} className="btn-glass">
            <RefreshCw
              className={cn("size-4 text-ink-400", syncing && "animate-spin text-brand-600")}
              strokeWidth={2}
            />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      <StatBar
        segments={segments}
        activeId={active}
        onSelect={(id) => onSelect(id === active && id !== "all" ? "all" : (id as IntakeGroup))}
      />
    </section>
  );
}
