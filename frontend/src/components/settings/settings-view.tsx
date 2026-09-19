"use client";

import { useState } from "react";
import { Bell, Mail, Moon, Palette, ScanLine, ShieldCheck, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { useTheme, type ThemeChoice } from "@/components/theme/theme-provider";

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const THRESHOLDS = ["75", "80", "85", "90", "95"];

export function SettingsView() {
  const toast = useToast();
  const { theme, mounted, setTheme } = useTheme();

  const [threshold, setThreshold] = useState("85");
  const [routeLowConfidence, setRouteLowConfidence] = useState(true);
  const [reviewScans, setReviewScans] = useState(true);
  const [mismatchAlerts, setMismatchAlerts] = useState(true);
  const [reviewDigest, setReviewDigest] = useState(false);
  const [syncInterval, setSyncInterval] = useState("5");

  return (
    <div className="flex flex-col gap-5">
      <Panel
        icon={Palette}
        title="Appearance"
        description="Choose how ShipVerify looks on this device."
      >
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-[13.5px] font-medium text-ink-900">Theme</p>
            <p className="mt-1 text-[12px] text-ink-400" suppressHydrationWarning>
              {mounted ? `Currently showing ${theme} mode.` : "Reading your saved preference…"}
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="Theme"
            className="flex shrink-0 gap-1 rounded-xl border border-line-strong bg-canvas p-1"
          >
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = mounted && theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setTheme(option.value);
                    toast({
                      title: `${option.label} theme applied`,
                      description: `Interface switched to ${option.label.toLowerCase()} mode on this device.`,
                      tone: "success",
                    });
                  }}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[12.5px] font-medium transition-all",
                    active
                      ? "bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-glass"
                      : "text-ink-500 hover:bg-surface hover:text-ink-900",
                  )}
                >
                  <Icon className="size-4" strokeWidth={2.25} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel
        icon={ShieldCheck}
        title="Verification rules"
        description="How certain the engine must be before it decides a field on its own."
      >
        <Row
          title="Confidence threshold"
          detail="Below this, a field is sent to Human Review instead of being decided automatically."
        >
          <select
            value={threshold}
            onChange={(event) => {
              setThreshold(event.target.value);
              toast({
                title: `Threshold set to ${event.target.value}%`,
                description: "New cases will use this confidence level from the next run.",
                tone: "success",
              });
            }}
            className="field-glass tabular w-auto cursor-pointer px-3 py-2 font-medium"
          >
            {THRESHOLDS.map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </Row>

        <Row
          title="Route low-confidence cases to Human Review"
          detail="Never guess a value: uncertain extractions go to a person."
        >
          <Switch
            label="Route low-confidence cases to Human Review"
            checked={routeLowConfidence}
            onChange={(next) => {
              setRouteLowConfidence(next);
              toast({
                title: next ? "Low-confidence routing on" : "Low-confidence routing off",
                description: next
                  ? "Uncertain cases will continue to appear in the Review Queue."
                  : "Uncertain cases will be marked Mismatch instead. Not recommended.",
                tone: next ? "success" : "warning",
              });
            }}
          />
        </Row>

        <Row
          title="Always review scanned documents"
          detail="Treat OCR output as unverified even when confidence is high."
          icon={ScanLine}
        >
          <Switch
            label="Always review scanned documents"
            checked={reviewScans}
            onChange={(next) => {
              setReviewScans(next);
              toast({
                title: next ? "Scanned documents will be reviewed" : "Scanned documents auto-decided",
                tone: next ? "success" : "warning",
              });
            }}
          />
        </Row>
      </Panel>

      <Panel
        icon={Mail}
        title="Mailbox connection"
        description="The inbox ShipVerify watches for shipping documents."
      >
        <Row title="Sync interval" detail="How often the mailbox is polled for new messages.">
          <select
            value={syncInterval}
            onChange={(event) => {
              setSyncInterval(event.target.value);
              toast({
                title: `Sync interval set to ${event.target.value} minutes`,
                tone: "success",
              });
            }}
            className="field-glass tabular w-auto cursor-pointer px-3 py-2 font-medium"
          >
            {["1", "5", "15", "30"].map((value) => (
              <option key={value} value={value}>
                Every {value} min
              </option>
            ))}
          </select>
        </Row>
      </Panel>

      <Panel icon={Bell} title="Notifications" description="What reaches you, and when.">
        <Row
          title="Mismatch alerts"
          detail="Notify immediately when a discrepancy is found on any shipment."
        >
          <Switch
            label="Mismatch alerts"
            checked={mismatchAlerts}
            onChange={(next) => {
              setMismatchAlerts(next);
              toast({ title: next ? "Mismatch alerts on" : "Mismatch alerts off", tone: "info" });
            }}
          />
        </Row>
        <Row
          title="Daily review digest"
          detail="One summary each morning of everything waiting in the Review Queue."
        >
          <Switch
            label="Daily review digest"
            checked={reviewDigest}
            onChange={(next) => {
              setReviewDigest(next);
              toast({ title: next ? "Daily digest on" : "Daily digest off", tone: "info" });
            }}
          />
        </Row>
      </Panel>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Palette;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass glass-sheen overflow-hidden">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
          <Icon className="size-[17px]" strokeWidth={2} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">{title}</h2>
          <p className="mt-1 text-[12.5px] text-ink-500">{description}</p>
        </div>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({
  title,
  detail,
  icon: Icon,
  children,
}: {
  title: string;
  detail: string;
  icon?: typeof Palette;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} />}
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-ink-900">{title}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-400">{detail}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={cn(
          "tabular w-6 text-[11px] font-semibold uppercase tracking-[0.08em]",
          checked ? "text-brand-600" : "text-ink-400",
        )}
        aria-hidden
      >
        {checked ? "On" : "Off"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200",
          checked
            ? "bg-gradient-to-r from-brand-500 to-brand-700"
            : "bg-canvas ring-1 ring-inset ring-line-strong",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full shadow-glass transition-transform duration-200",
            checked
              ? "translate-x-6 bg-white"
              : "translate-x-1 bg-surface ring-1 ring-inset ring-line-strong",
          )}
        />
      </button>
    </span>
  );
}
