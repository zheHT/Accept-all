"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { PeriodMenu } from "@/components/ui/period-menu";
import { DonutChart } from "./donut-chart";
import { PERIODS, PERIOD_ORDER, outcomeSlices, type Period } from "@/lib/mock-data";
import { STATUS_META } from "@/lib/status";
import { readParam, writeParam } from "@/lib/url-state";

/**
 * Single overview chart.
 *
 * One donut carries the whole verification picture: hovering a slice or a legend
 * row swaps the centre figure. Supporting numbers sit next to it as plain
 * figures rather than a second chart.
 */
export function OverviewSection() {
  const [period, setPeriod] = useState<Period>("week");
  const [activeSlice, setActiveSlice] = useState<number | null>(null);

  /** `?period=day|week|month` makes the selected range shareable. */
  useEffect(() => {
    const requested = readParam("period");
    if (requested && PERIOD_ORDER.includes(requested as Period)) {
      setPeriod(requested as Period);
    }
  }, []);

  const changePeriod = (next: Period) => {
    setPeriod(next);
    setActiveSlice(null);
    writeParam("period", next === "week" ? null : next);
  };

  const data = PERIODS[period];
  const slices = outcomeSlices(data);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Overview</p>
          <p className="mt-1.5 text-[13px] text-ink-500">
            {data.caption} · <span className="text-ink-400">{data.rangeLabel}</span>
          </p>
        </div>
        <PeriodMenu value={period} onChange={changePeriod} />
      </div>

      <article className="glass glass-sheen p-6 lg:p-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-12">
          <div className="shrink-0 lg:w-[300px]">
            <DonutChart
              slices={slices}
              total={data.total}
              activeIndex={activeSlice}
              onHover={setActiveSlice}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-semibold tracking-tight text-ink-900">
                  Verification outcomes
                </h3>
                <p className="mt-1 text-[12.5px] text-ink-400">
                  Hover a segment to isolate it · {data.total} cases{" "}
                  {period === "day" ? "today" : `this ${period}`}
                </p>
              </div>
              <DeltaChip value={data.deltaPct} period={period} />
            </div>

            <ul className="divide-y divide-line border-y border-line">
              {slices.map((slice, index) => {
                const meta = STATUS_META[slice.status];
                const share = data.total > 0 ? Math.round((slice.value / data.total) * 100) : 0;
                return (
                  <li key={slice.status}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveSlice(index)}
                      onMouseLeave={() => setActiveSlice(null)}
                      onFocus={() => setActiveSlice(index)}
                      onBlur={() => setActiveSlice(null)}
                      className={cn(
                        "flex w-full items-center gap-4 rounded-lg px-2 py-3.5 text-left transition-colors",
                        activeSlice === index ? "bg-surface/80" : "hover:bg-surface/60",
                      )}
                    >
                      <span className={cn("size-2.5 shrink-0 rounded-full", meta.dot)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-ink-900">
                          {slice.label}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-ink-400">
                          {slice.support}
                        </span>
                      </span>
                      <span className="hidden w-32 shrink-0 sm:block">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-surface/80 ring-1 ring-inset ring-line">
                          <span
                            className={cn("block h-full rounded-full", meta.bar)}
                            style={{ width: `${share}%` }}
                          />
                        </span>
                      </span>
                      <span className="w-20 shrink-0 text-right">
                        <span className="tabular block text-[16px] font-semibold leading-none text-ink-900">
                          {slice.value}
                        </span>
                        <span className="tabular mt-1 block text-[11px] text-ink-400">
                          {share}%
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <dl className="grid grid-cols-3 divide-x divide-line">
              <Stat label="Total cases" value={String(data.total)} />
              <Stat label="Avg. turnaround" value={data.avgTurnaround} />
              <Stat label="Auto-cleared" value={`${data.autoCleared}%`} />
            </dl>
          </div>
        </div>
      </article>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">{label}</dt>
      <dd className="tabular mt-1.5 text-[20px] font-semibold leading-none tracking-tight text-ink-900">
        {value}
      </dd>
    </div>
  );
}

function DeltaChip({ value, period }: { value: number; period: Period }) {
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const previous = period === "day" ? "yesterday" : `last ${period}`;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
        positive
          ? "bg-matched-50/85 text-matched-700 ring-matched-200"
          : "bg-failed-50/85 text-failed-700 ring-failed-200",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.5} />
      <span className="tabular">
        {positive ? "+" : ""}
        {value}%
      </span>
      <span className="font-medium opacity-80">vs {previous}</span>
    </span>
  );
}
