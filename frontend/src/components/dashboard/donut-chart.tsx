"use client";

import { STATUS_META } from "@/lib/status";
import type { OutcomeSlice } from "@/lib/mock-data";

const SIZE = 236;
const STROKE = 22;
/** Extra thickness when a segment is focused. */
const STROKE_ACTIVE = 28;
const RADIUS = (SIZE - STROKE_ACTIVE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Arc length removed from each slice so neighbours never touch. */
const GAP = 10;

export function DonutChart({
  slices,
  total,
  activeIndex,
  onHover,
}: {
  slices: OutcomeSlice[];
  total: number;
  activeIndex: number | null;
  onHover: (index: number | null) => void;
}) {
  let offset = 0;
  const arcs = slices.map((slice, index) => {
    const share = total > 0 ? slice.value / total : 0;
    const length = share * CIRCUMFERENCE;
    const arc = { slice, index, share, length: Math.max(length - GAP, 1), offset };
    offset += length;
    return arc;
  });

  const active = activeIndex === null ? null : slices[activeIndex];
  const activeMeta = active ? STATUS_META[active.status] : null;
  const centerValue = active ? active.value : total;
  const centerLabel = active ? active.label : "Total Cases";
  const centerShare =
    active && total > 0 ? `${Math.round((active.value / total) * 100)}% of ${total}` : "verified";

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Verification outcomes: ${slices
          .map((slice) => `${slice.label} ${slice.value}`)
          .join(", ")}`}
      >
        <defs>
          {slices.map((slice) => {
            const [from, to] = STATUS_META[slice.status].gradient;
            return (
              <linearGradient
                key={slice.status}
                id={`donut-${slice.status}`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="0"
                x2={SIZE}
                y2={SIZE}
              >
                <stop offset="0%" stopColor={from} />
                <stop offset="100%" stopColor={to} />
              </linearGradient>
            );
          })}
        </defs>

        {/* Reference track: shows the full circle the slices are measured against. */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-canvas)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS - STROKE_ACTIVE / 2 - 3}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={1}
        />

        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {arcs.map(({ slice, index, length, offset: arcOffset }) => {
            const focused = activeIndex === index;
            return (
              <circle
                key={slice.status}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={`url(#donut-${slice.status})`}
                strokeWidth={focused ? STROKE_ACTIVE : STROKE}
                strokeLinecap="round"
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-arcOffset - GAP / 2}
                opacity={activeIndex === null || focused ? 1 : 0.22}
                className="cursor-pointer transition-all duration-300 ease-out"
                onMouseEnter={() => onHover(index)}
                onMouseLeave={() => onHover(null)}
              />
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {activeMeta && (
          <span className={`mb-2 size-1.5 rounded-full ${activeMeta.dot}`} aria-hidden />
        )}
        <span className="tabular text-[42px] font-semibold leading-none tracking-tight text-ink-900">
          {centerValue}
        </span>
        <span className="mt-2 text-[12px] font-medium text-ink-700">{centerLabel}</span>
        <span className="tabular mt-0.5 text-[11px] text-ink-400">{centerShare}</span>
      </div>
    </div>
  );
}
