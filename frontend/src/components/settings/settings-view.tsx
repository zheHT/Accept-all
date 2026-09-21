"use client";

import { useEffect, useState } from "react";
import {
  BellOutlined,
  BgColorsOutlined,
  ExportOutlined,
  MailOutlined,
  MoonOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ScanOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Button, Card, Segmented, Select, Skeleton, Switch } from "antd";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { useTheme, type ThemeChoice } from "@/components/theme/theme-provider";
import { ErrorState, StaleNotice } from "@/components/ui/live-state";
import { getSession, getSettings, saveSettings, startGmailOAuth } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useLiveQuery } from "@/lib/use-live-query";

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

  if (session.loading && !session.data) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "24px" } }}>
          <Skeleton active paragraph={{ rows: 4 }} />
        </Card>
      </div>
    );
  }
  if (session.error && !session.data) {
    return <ErrorState message={session.error} retry={() => void session.refresh()} />;
  }
  if (isAdmin && settings.loading && !settings.data) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "24px" } }}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      </div>
    );
  }
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
    <div className="flex flex-col gap-6">
      {isAdmin && settings.stale && <StaleNotice />}
      {isAdmin && (
        <div className="flex justify-end">
          <Button
            icon={<ReloadOutlined className={cn(settings.loading && "animate-spin")} />}
            onClick={() => {
              void settings.refresh();
              toast({ title: "Settings refreshed", tone: "info" });
            }}
            disabled={settings.loading}
          >
            Refresh settings
          </Button>
        </div>
      )}

      {/* Appearance */}
      <Card
        className="border-edge bg-surface/80 shadow-sm"
        title={
          <div className="flex items-center gap-3 py-1">
            <span className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600 text-base">
              <BgColorsOutlined />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-900">Appearance</h2>
              <p className="text-xs font-normal text-ink-500">
                Choose how ShipVerify looks on this device.
              </p>
            </div>
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-4 py-2">
          <div>
            <p className="text-sm font-semibold text-ink-900">Theme</p>
            <p className="text-xs text-ink-400 mt-0.5" suppressHydrationWarning>
              {mounted ? `Currently showing ${theme} mode.` : "Reading your saved preference…"}
            </p>
          </div>

          <Segmented
            value={mounted ? theme : "light"}
            options={[
              {
                label: (
                  <span className="flex items-center gap-1.5 px-2 py-1">
                    <SunOutlined />
                    Light
                  </span>
                ),
                value: "light",
              },
              {
                label: (
                  <span className="flex items-center gap-1.5 px-2 py-1">
                    <MoonOutlined />
                    Dark
                  </span>
                ),
                value: "dark",
              },
            ]}
            onChange={(val) => {
              setTheme(val as ThemeChoice);
              toast({
                title: `${val} theme applied`,
                description: `Interface switched to ${String(val).toLowerCase()} mode.`,
                tone: "success",
              });
            }}
          />
        </div>
      </Card>

      {/* Verification Rules */}
      {isAdmin ? (
        <>
          <Card
            className="border-edge bg-surface/80 shadow-sm"
            title={
              <div className="flex items-center gap-3 py-1">
                <span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 text-base">
                  <SafetyCertificateOutlined />
                </span>
                <div>
                  <h2 className="text-[15px] font-bold text-ink-900">Verification Rules</h2>
                  <p className="text-xs font-normal text-ink-500">
                    How certain the engine must be before it decides a field on its own.
                  </p>
                </div>
              </div>
            }
          >
            <div className="flex flex-col divide-y divide-line">
              <div className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Confidence threshold</p>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Below this, a field is sent to Human Review instead of being decided automatically.
                  </p>
                </div>
                <Select
                  style={{ width: 100 }}
                  value={threshold}
                  options={THRESHOLDS.map((val) => ({ value: val, label: `${val}%` }))}
                  onChange={(next) => {
                    setThreshold(next);
                    void persist(next, mismatchAlerts);
                  }}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    Low-confidence values require Human Review
                  </p>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Fixed safety policy: uncertain extractions always go to a person.
                  </p>
                </div>
                <Switch checked disabled />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="flex items-start gap-2">
                  <ScanOutlined className="text-ink-400 text-base mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-ink-900">
                      Missing and unreadable values require review
                    </p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      Fixed safety policy: missing or unreadable values can never be auto-approved.
                    </p>
                  </div>
                </div>
                <Switch checked disabled />
              </div>
            </div>
          </Card>

          {/* Mailbox Connection */}
          <Card
            className="border-edge bg-surface/80 shadow-sm"
            title={
              <div className="flex items-center gap-3 py-1">
                <span className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600 text-base">
                  <MailOutlined />
                </span>
                <div>
                  <h2 className="text-[15px] font-bold text-ink-900">Mailbox Connection</h2>
                  <p className="text-xs font-normal text-ink-500">
                    The inbox ShipVerify watches for shipping documents.
                  </p>
                </div>
              </div>
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {settings.data?.gmail.address || "Gmail account"}
                </p>
                <p className="text-xs text-ink-400 mt-0.5">
                  {settings.data?.gmail.client_configured === false ||
                  settings.data?.gmail.oauth_status === "Gmail OAuth client not configured"
                    ? "OAuth client secret not configured in environment. Gmail compose fallback mode is active."
                    : `OAuth: ${settings.data?.gmail.oauth_status || "not connected"} · Watch: ${settings.data?.gmail.watch_expiration ? formatDate(settings.data.gmail.watch_expiration) : "not active"}`}
                </p>
              </div>

              <Button
                icon={<ExportOutlined />}
                disabled={
                  settings.data?.gmail.client_configured === false ||
                  settings.data?.gmail.oauth_status === "Gmail OAuth client not configured"
                }
                onClick={() =>
                  void startGmailOAuth()
                    .then(({ authorization_url }) => window.location.assign(authorization_url))
                    .catch((error: unknown) =>
                      toast({
                        title: "Could not start Gmail connection",
                        description: error instanceof Error ? error.message : "Please retry.",
                        tone: "warning",
                      }),
                    )
                }
              >
                {settings.data?.gmail.oauth_status === "connected" ? "Reconnect" : "Connect Gmail"}
              </Button>
            </div>
          </Card>

          {/* Notifications */}
          <Card
            className="border-edge bg-surface/80 shadow-sm"
            title={
              <div className="flex items-center gap-3 py-1">
                <span className="grid size-8 place-items-center rounded-lg bg-amber-50 text-amber-600 text-base">
                  <BellOutlined />
                </span>
                <div>
                  <h2 className="text-[15px] font-bold text-ink-900">Notifications</h2>
                  <p className="text-xs font-normal text-ink-500">
                    Configure alert preferences and delivery channels.
                  </p>
                </div>
              </div>
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-semibold text-ink-900">Mismatch alerts</p>
                <p className="text-xs text-ink-400 mt-0.5">
                  Notify immediately when a discrepancy is found on any shipment.
                </p>
              </div>

              <Switch
                checked={mismatchAlerts}
                onChange={(next) => {
                  setMismatchAlerts(next);
                  void persist(threshold, next);
                }}
                disabled={saving}
              />
            </div>
          </Card>
        </>
      ) : (
        <Card className="border-edge bg-surface/80 text-ink-500 text-sm">
          Operational settings are managed by an administrator.
        </Card>
      )}
    </div>
  );
}
