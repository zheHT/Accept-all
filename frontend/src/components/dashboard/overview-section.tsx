"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Card, Progress, Segmented, Skeleton, Statistic } from "antd";
import { cn } from "@/lib/cn";
import { ErrorState, StaleNotice } from "@/components/ui/live-state";
import { DonutChart } from "./donut-chart";
import { PERIOD_ORDER, outcomeSlices, type Period } from "@/lib/dashboard-data";
import { getDashboard } from "@/lib/api";
import { periodData } from "@/lib/live-view-models";
import { useLiveQuery } from "@/lib/use-live-query";
import { STATUS_META } from "@/lib/status";
import { readParam, writeParam } from "@/lib/url-state";

export function OverviewSection() {
  const [period, setPeriod] = useState<Period>("week");
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const query = useLiveQuery((signal) => getDashboard(period, signal), [period]);

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

  if (query.loading && !query.data) {
    return (
      <section className="flex flex-col gap-4">
        <Card className="shadow-sm border-edge bg-surface/80" styles={{ body: { padding: "28px" } }}>
          <Skeleton active paragraph={{ rows: 4 }} />
        </Card>
      </section>
    );
  }
  if (query.error && !query.data) {
    return <ErrorState message={query.error} retry={() => void query.refresh()} />;
  }

  const data = periodData(query.data!);
  const slices = outcomeSlices(data);

  return (
    <section className="flex flex-col gap-4">
      {query.stale && <StaleNotice />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink-900">Overview</h2>
          <p className="mt-1 text-[13px] text-ink-500">
            {data.caption} · <span className="text-ink-400">{data.rangeLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="default"
            size="middle"
            icon={<ReloadOutlined className={cn(query.loading && "animate-spin")} />}
            onClick={() => void query.refresh()}
            disabled={query.loading}
          >
            Refresh
          </Button>

          <Segmented
            value={period}
            options={[
              { label: "Day", value: "day" },
              { label: "Week", value: "week" },
              { label: "Month", value: "month" },
            ]}
            onChange={(val) => changePeriod(val as Period)}
          />
        </div>
      </div>

      <Card className="shadow-sm border-edge bg-surface/80 backdrop-blur" styles={{ body: { padding: "24px 32px" } }}>
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
                        "flex w-full items-center gap-4 rounded-lg px-2 py-3 text-left transition-colors cursor-pointer",
                        activeSlice === index ? "bg-surface/90 shadow-sm" : "hover:bg-surface/60",
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
                        <Progress
                          percent={share}
                          showInfo={false}
                          size="small"
                          strokeColor={
                            slice.status === "matched"
                              ? "#52c41a"
                              : slice.status === "mismatch"
                                ? "#ff4d4f"
                                : slice.status === "needs_review"
                                  ? "#faad14"
                                  : "#1677ff"
                          }
                        />
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

            <div className="grid grid-cols-3 divide-x divide-line pt-2">
              <div className="px-4 first:pl-0">
                <Statistic title="Total cases" value={data.total} />
              </div>
              <div className="px-4">
                <Statistic title="Avg. turnaround" value={data.avgTurnaround} />
              </div>
              <div className="px-4 last:pr-0">
                <Statistic title="Auto-cleared" value={data.autoCleared} suffix="%" />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function DeltaChip({ value, period }: { value: number; period: Period }) {
  const positive = value >= 0;
  const Icon = positive ? ArrowUpOutlined : ArrowDownOutlined;
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
      <Icon className="text-xs" />
      <span className="tabular">
        {positive ? "+" : ""}
        {value}%
      </span>
      <span className="font-medium opacity-80">vs {previous}</span>
    </span>
  );
}
