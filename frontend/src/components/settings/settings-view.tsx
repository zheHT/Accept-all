"use client";

import { useEffect, useState } from "react";
import { Bell, ExternalLink, Mail, Moon, Palette, RefreshCw, ScanLine, ShieldCheck, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { useTheme, type ThemeChoice } from "@/components/theme/theme-provider";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { getSession, getSettings, saveSettings, startGmailOAuth } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useLiveQuery } from "@/lib/use-live-query";

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const THRESHOLDS = ["75", "80", "85", "90", "95"];

export function SettingsView() {
  const toast = useToast();
  const { theme, mounted, setTheme } = useTheme();
  const session = useLiveQuery((signal) => getSession(signal), []);
  const isAdmin = session.data?.is_admin === true;
  const settings = useLiveQuery(
    (signal) => (isAdmin ? getSettings(signal) : Promise.resolve(null)),
    [isAdmin],
  );

  const [threshold, setThreshold] = useState("85");
  const [mismatchAlerts, setMismatchAlerts] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setThreshold(String(Math.round(settings.data.confidence_threshold * 100)));
    setMismatchAlerts(settings.data.mismatch_alerts_enabled);
  }, [settings.data]);

  if (session.loading && !session.data) return <LoadingState label="Loading settings access" />;
  if (session.error && !session.data) {
    return <ErrorState message={session.error} retry={() => void session.refresh()} />;
  }
  if (isAdmin && settings.loading && !settings.data) return <LoadingState label="Loading operational settings" />;
  if (isAdmin && settings.error && !settings.data) {
    return <ErrorState message={settings.error} retry={() => void settings.refresh()} />;
  }

  const persist = async (nextThreshold: string, nextAlerts: boolean) => {
    setSaving(true);
    try {
      await saveSettings({
        confidence_threshold: Number(nextThreshold) / 100,
        mismatch_alerts_enabled: nextAlerts,
      });
      await settings.refresh();
      toast({ title: "Operational settings saved", tone: "success" });
    } catch (error) {
      toast({
        title: "Settings were not saved",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {isAdmin && settings.stale && <StaleNotice />}
      {isAdmin && <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            void settings.refresh();
            toast({ title: "Settings refreshed", tone: "info" });
          }}
          disabled={settings.loading}
          aria-label="Refresh operational settings"
          title="Refresh operational settings"
          className="btn-glass active:scale-95 text-[12px]"
        >
          <RefreshCw className={cn("size-3.5", settings.loading && "animate-spin")} />
          Refresh settings
        </button>
      </div>}
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

      {isAdmin ? <>
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
              const next = event.target.value;
              setThreshold(next);
              void persist(next, mismatchAlerts);
            }}
            disabled={saving}
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
          title="Low-confidence values require Human Review"
          detail="Fixed safety policy: uncertain extractions always go to a person."
        >
          <Switch
            label="Low-confidence values require Human Review"
            checked
            disabled
            onChange={() => {}}
          />
        </Row>

        <Row
          title="Missing and unreadable values require review"
          detail="Fixed safety policy: missing or unreadable values can never be auto-approved."
          icon={ScanLine}
        >
          <Switch
            label="Missing and unreadable values require review"
            checked
            disabled
            onChange={() => {}}
          />
        </Row>
        </Panel>

        <Panel
          icon={Mail}
          title="Mailbox connection"
          description="The inbox ShipVerify watches for shipping documents."
        >
        <Row
          title={settings.data?.gmail.address || "Gmail account"}
          detail={
            settings.data?.gmail.client_configured === false || settings.data?.gmail.oauth_status === "Gmail OAuth client not configured"
              ? "OAuth client secret not configured in environment. Gmail compose fallback mode is active."
              : `OAuth: ${settings.data?.gmail.oauth_status || "not connected"} · Watch: ${settings.data?.gmail.watch_expiration ? formatDate(settings.data.gmail.watch_expiration) : "not active"}`
          }
        >
          <button
            type="button"
            className="btn-glass"
            disabled={settings.data?.gmail.client_configured === false || settings.data?.gmail.oauth_status === "Gmail OAuth client not configured"}
            title={
              settings.data?.gmail.client_configured === false || settings.data?.gmail.oauth_status === "Gmail OAuth client not configured"
                ? "Configure GMAIL_OAUTH_CLIENT_JSON to enable shared mailbox connection."
                : undefined
            }
            onClick={() => void startGmailOAuth().then(({ authorization_url }) => window.location.assign(authorization_url)).catch((error: unknown) => toast({ title: "Could not start Gmail connection", description: error instanceof Error ? error.message : "Please retry.", tone: "warning" }))}
          >
            <ExternalLink className="size-4" />
            {settings.data?.gmail.oauth_status === "connected" ? "Reconnect" : "Connect Gmail"}
          </button>
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
              void persist(threshold, next);
            }}
            disabled={saving}
          />
        </Row>
        </Panel>
      </> : (
        <section className="glass glass-sheen px-5 py-4 text-[13px] text-ink-500">
          Operational settings are managed by an administrator.
        </section>
      )}
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
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
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
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60",
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
