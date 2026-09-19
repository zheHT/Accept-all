"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { PERIODS, PERIOD_ORDER, type Period } from "@/lib/mock-data";

/** Day / week / month switcher. Selecting a range re-reads every chart figure. */
export function PeriodMenu({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = PERIODS[value];

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="btn-glass"
      >
        <CalendarDays className="size-4 text-ink-400" strokeWidth={2} />
        {current.label}
        <ChevronDown
          className={cn(
            "size-3.5 text-ink-400 transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={2.25}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="glass-solid absolute right-0 top-[calc(100%+8px)] z-40 w-60 overflow-hidden p-1.5"
        >
          {PERIOD_ORDER.map((id) => {
            const period = PERIODS[id];
            const active = id === value;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                  active ? "bg-brand-50/90 text-brand-700" : "text-ink-700 hover:bg-surface/80",
                )}
              >
                <span className="flex-1">
                  <span className="block text-[13px] font-medium">{period.label}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-400">
                    {period.rangeLabel}
                  </span>
                </span>
                {active && <Check className="size-4 text-brand-600" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
