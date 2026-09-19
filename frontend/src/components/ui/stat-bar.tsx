"use client";

import { cn } from "@/lib/cn";

export interface StatSegment {
  id: string;
  label: string;
  value: number | string;
  support: string;
  /** Solid accent used for the top rule and the share meter. */
  accent: string;
  /** Optional share of the total, 0-100, drawn as a hairline meter. */
  share?: number;
}

/**
 * Page overview.
 *
 * One continuous bar divided into segments instead of separate metric cards:
 * the figures line up on a single baseline, a coloured rule above each segment
 * carries the status meaning, and each segment doubles as a filter. Selecting a
 * segment lifts it out of the bar rather than moving anything around it.
 */
export function StatBar({
  segments,
  activeId,
  onSelect,
}: {
  segments: StatSegment[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Overview filters"
      className="glass glass-sheen grid grid-cols-2 overflow-hidden lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
      style={{ ["--cols" as string]: String(segments.length) }}
    >
      {segments.map((segment, index) => {
        const active = activeId === segment.id;

        return (
          <button
            key={segment.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(segment.id)}
            className={cn(
              "group relative flex flex-col border-line px-5 pb-4 pt-4 text-left transition-colors duration-200",
              index > 0 && "lg:border-l",
              index % 2 === 1 && "border-l lg:border-l",
              index >= 2 && "border-t lg:border-t-0",
              active ? "bg-surface/85" : "hover:bg-surface/55",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 top-0 h-[3px] transition-opacity duration-200",
                segment.accent,
                active ? "opacity-100" : "opacity-30 group-hover:opacity-60",
              )}
            />

            <span
              className={cn(
                "text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors",
                active ? "text-ink-700" : "text-ink-400",
              )}
            >
              {segment.label}
            </span>

            <span className="tabular mt-2.5 text-[30px] font-semibold leading-none tracking-tight text-ink-900">
              {segment.value}
            </span>

            <span className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
              {segment.support}
            </span>

            {segment.share !== undefined && (
              <span className="mt-3 block h-[3px] w-full overflow-hidden rounded-full bg-canvas">
                <span
                  className={cn("block h-full rounded-full transition-all duration-300", segment.accent)}
                  style={{ width: `${segment.share}%` }}
                />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
