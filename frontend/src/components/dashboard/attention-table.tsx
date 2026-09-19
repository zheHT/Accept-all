"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, SearchX } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusChip } from "@/components/status-chip";
import { ATTENTION_CASES, TOTAL_OPEN_CASES, type CaseRow } from "@/lib/mock-data";
import type { VerificationStatus } from "@/lib/status";
import { readParam, writeParam } from "@/lib/url-state";

type CaseFilter = "all" | Extract<VerificationStatus, "mismatch" | "needs_review" | "failed">;

const FILTERS: Array<{ id: CaseFilter; label: string }> = [
  { id: "all", label: "All open" },
  { id: "mismatch", label: "Mismatch" },
  { id: "needs_review", label: "Needs Review" },
  { id: "failed", label: "Failed" },
];

const FINDING_TONE: Record<CaseRow["status"], string> = {
  mismatch: "bg-mismatch-50/85 text-mismatch-700 ring-mismatch-200",
  needs_review: "bg-review-50/85 text-review-700 ring-review-200",
  failed: "bg-failed-50/85 text-failed-700 ring-failed-200",
  processing: "bg-processing-50/85 text-processing-700 ring-processing-200",
  matched: "bg-matched-50/85 text-matched-700 ring-matched-200",
};

export function AttentionTable() {
  const router = useRouter();
  const [filter, setFilter] = useState<CaseFilter>("all");

  /** Rows open the full case on the Verification Cases page. */
  const openCase = (row: CaseRow) =>
    router.push(row.status === "needs_review" ? `/review?case=${row.id}` : `/cases?case=${row.id}`);

  /** `?cases=mismatch` opens the dashboard with that filter already applied. */
  useEffect(() => {
    const requested = readParam("cases");
    if (requested && FILTERS.some(({ id }) => id === requested)) {
      setFilter(requested as CaseFilter);
    }
  }, []);

  const changeFilter = (next: CaseFilter) => {
    setFilter(next);
    writeParam("cases", next === "all" ? null : next);
  };

  const counts = useMemo(() => {
    const byStatus = (status: CaseFilter) =>
      status === "all"
        ? ATTENTION_CASES.length
        : ATTENTION_CASES.filter((row) => row.status === status).length;
    return Object.fromEntries(FILTERS.map(({ id }) => [id, byStatus(id)])) as Record<
      CaseFilter,
      number
    >;
  }, []);

  const rows = useMemo(
    () => (filter === "all" ? ATTENTION_CASES : ATTENTION_CASES.filter((row) => row.status === filter)),
    [filter],
  );

  return (
    <section className="glass glass-sheen overflow-hidden">
      <header className="flex flex-col gap-4 border-b border-line px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
            Cases requiring attention
          </h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Ranked by discrepancy severity, then by documentation cut-off.
          </p>
        </div>
        <div className="flex shrink-0 gap-1 self-start rounded-xl border border-edge bg-surface/55 p-1 backdrop-blur lg:self-auto">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => changeFilter(id)}
              aria-pressed={filter === id}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-200",
                filter === id
                  ? "bg-gradient-to-b from-surface to-surface/80 text-ink-900 shadow-glass"
                  : "text-ink-500 hover:text-ink-900",
              )}
            >
              {label}
              <span
                className={cn(
                  "tabular rounded px-1 text-[10px] font-semibold",
                  filter === id ? "bg-brand-50 text-brand-700" : "text-ink-300",
                )}
              >
                {counts[id]}
              </span>
            </button>
          ))}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <SearchX className="size-6 text-ink-300" strokeWidth={1.75} />
          <p className="text-[14px] font-medium text-ink-700">No cases in this state</p>
          <p className="text-[13px] text-ink-400">
            Nothing is currently flagged as {FILTERS.find((f) => f.id === filter)?.label}.
          </p>
        </div>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead className="bg-surface/45">
            <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
              <th scope="col" className="px-6 py-3 font-semibold">
                Shipment
              </th>
              <th scope="col" className="px-6 py-3 font-semibold">
                Route
              </th>
              <th scope="col" className="px-6 py-3 font-semibold">
                Status
              </th>
              <th scope="col" className="px-6 py-3 font-semibold">
                Findings
              </th>
              <th scope="col" className="px-6 py-3 font-semibold">
                Confidence
              </th>
              <th scope="col" className="px-6 py-3 text-right font-semibold">
                Received
              </th>
              <th scope="col" className="w-10 px-6 py-3">
                <span className="sr-only">Open case</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => openCase(row)}
                className="group cursor-pointer transition-colors hover:bg-surface/70"
              >
                <td className="border-t border-line px-6 py-4 align-middle">
                  <span className="font-mono text-[13px] font-medium tracking-tight text-ink-900">
                    {row.reference}
                  </span>
                  <span className="mt-1 block max-w-[220px] truncate text-[12px] text-ink-500">
                    {row.counterparty}
                  </span>
                </td>

                <td className="border-t border-line px-6 py-4 align-middle">
                  <span className="tabular flex items-center gap-2 text-[13px] font-medium text-ink-700">
                    {row.pol}
                    <ArrowRight className="size-3 text-ink-300" strokeWidth={2.5} />
                    {row.pod}
                  </span>
                  <span className="mt-1 block text-[12px] text-ink-400">{row.vessel}</span>
                </td>

                <td className="border-t border-line px-6 py-4 align-middle">
                  <StatusChip status={row.status} />
                </td>

                <td className="border-t border-line px-6 py-4 align-middle">
                  {row.flaggedFields.length === 0 ? (
                    <span className="text-[13px] text-ink-300">Awaiting extraction</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {row.flaggedFields.map((field) => (
                        <span
                          key={field}
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                            FINDING_TONE[row.status],
                          )}
                        >
                          {field}
                        </span>
                      ))}
                    </span>
                  )}
                </td>

                <td className="border-t border-line px-6 py-4 align-middle">
                  <ConfidenceMeter value={row.confidence} />
                </td>

                <td className="border-t border-line px-6 py-4 text-right align-middle text-[13px] text-ink-500">
                  {row.received}
                </td>

                <td className="border-t border-line px-6 py-4 align-middle">
                  <ChevronRight
                    className="size-4 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600"
                    strokeWidth={2}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="flex items-center justify-between border-t border-line px-6 py-4">
        <span className="text-[12px] text-ink-400">
          Showing {rows.length} of {TOTAL_OPEN_CASES} open cases
        </span>
        <Link
          href="/cases"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 transition-colors hover:text-brand-700"
        >
          View all verification cases
          <ArrowRight className="size-3.5" strokeWidth={2.25} />
        </Link>
      </footer>
    </section>
  );
}

/** Extraction confidence for the case; blank while the agents are still running. */
function ConfidenceMeter({ value }: { value: number }) {
  if (value <= 0) {
    return <span className="text-[13px] text-ink-300">—</span>;
  }

  const pct = Math.round(value * 100);
  const tone =
    value >= 0.9
      ? "from-matched-500 to-matched-700"
      : value >= 0.7
        ? "from-brand-400 to-brand-600"
        : "from-review-500 to-review-700";

  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface/80 ring-1 ring-inset ring-line">
        <span
          className={cn("block h-full rounded-full bg-gradient-to-r", tone)}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular text-[12px] font-medium text-ink-700">{pct}%</span>
    </span>
  );
}
