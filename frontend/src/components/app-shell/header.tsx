"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellOutlined,
  CloseCircleFilled,
  ExclamationCircleFilled,
  LogoutOutlined,
  MoonOutlined,
  ReloadOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { Avatar, Badge, Dropdown, List, Popover, type MenuProps, Tooltip } from "antd";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme/theme-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { useWorkspaceCounts } from "@/components/workspace/workspace-counts";
import { fieldLabel, relativeTime } from "@/lib/live-view-models";

interface Notification {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "mismatch" | "review" | "failed";
  href: string;
}

const TONE_CONFIG: Record<
  Notification["tone"],
  { icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; bg: string }
> = {
  mismatch: {
    icon: CloseCircleFilled,
    color: "#ff4d4f",
    bg: "bg-mismatch-50 text-mismatch-700 ring-mismatch-200",
  },
  review: {
    icon: ExclamationCircleFilled,
    color: "#faad14",
    bg: "bg-review-50 text-review-700 ring-review-200",
  },
  failed: {
    icon: WarningFilled,
    color: "#fa541c",
    bg: "bg-failed-50 text-failed-700 ring-failed-200",
  },
};

export function Header() {
  const router = useRouter();
  const toast = useToast();
  const { user, signOut } = useAuth();
  const [openNotifications, setOpenNotifications] = useState(false);
  const { dashboard } = useWorkspaceCounts();

  const notifications = useMemo<Notification[]>(
    () =>
      (dashboard.data?.attention_items || []).slice(0, 6).map((item) => {
        const failed = item.processing_state === "DEAD_LETTER";
        const review = item.status === "NEEDS_REVIEW";
        const fields = [
          ...new Set([...item.defect_fields, ...item.low_confidence_fields]),
        ].map(fieldLabel);
        return {
          id: item.case_id,
          title: failed
            ? "Processing failed"
            : review
              ? "Human review required"
              : "Document mismatch",
          detail: `${item.subject || item.case_id}${fields.length ? ` · ${fields.join(", ")}` : ""}`,
          time: relativeTime(item.created_at),
          tone: failed ? "failed" : review ? "review" : "mismatch",
          href: review
            ? `/review?case=${encodeURIComponent(item.case_id)}`
            : `/cases?case=${encodeURIComponent(item.case_id)}`,
        };
      }),
    [dashboard.data],
  );

  if (!user) return null;
  const displayName = user.displayName || user.email || "Reviewer";
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const openNotification = (notification: Notification) => {
    setOpenNotifications(false);
    router.push(notification.href);
  };

  const userMenuItems: MenuProps["items"] = [
    {
      key: "user-info",
      disabled: true,
      label: (
        <div className="py-1">
          <p className="font-semibold text-ink-900">{displayName}</p>
          <p className="truncate text-xs text-ink-400">{user.email}</p>
        </div>
      ),
    },
    { type: "divider" },
    {
      key: "profile",
      icon: <UserOutlined />,
      label: "My profile",
      onClick: () => {
        toast({
          title: "Profile",
          description: "User profiles are managed in your identity provider.",
          tone: "info",
        });
      },
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "Settings",
      onClick: () => {
        router.push("/settings");
      },
    },
    { type: "divider" },
    {
      key: "signout",
      danger: true,
      icon: <LogoutOutlined />,
      label: "Sign out",
      onClick: () => {
        void signOut();
      },
    },
  ];

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-6 border-b border-edge bg-surface/55 px-8 backdrop-blur-2xl backdrop-saturate-150">
      <div className="flex items-center gap-4">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink-900">
          Shipping Document Verification
        </h1>
        <span className="hidden items-center gap-2 rounded-full bg-matched-50/80 px-2.5 py-1 text-[11px] font-medium text-matched-700 ring-1 ring-inset ring-matched-200 lg:inline-flex">
          <Badge status="processing" color="#52c41a" />
          On-demand sync
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Tooltip title="Refresh workspace">
          <button
            type="button"
            onClick={() => {
              void dashboard.refresh();
              toast({ title: "Workspace refreshed", tone: "info" });
            }}
            disabled={dashboard.loading}
            aria-label="Refresh workspace"
            className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-surface/80 hover:text-ink-900 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <ReloadOutlined
              className={cn("text-base", dashboard.loading && "animate-spin")}
            />
          </button>
        </Tooltip>

        <ThemeToggle />

        {/* Telegram Bot Link */}
        <Tooltip title="Open in Telegram">
          <a
            href="https://web.telegram.org/k/#@ShipVerify_Bot"
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Telegram"
            aria-label="Open in Telegram"
            className="grid size-9 place-items-center rounded-full transition-all duration-200 hover:bg-[#24A1DE]/15 hover:scale-105 active:scale-95 cursor-pointer"
          >
            <TelegramIcon className="size-[22px]" />
          </a>
        </Tooltip>

        <Popover
          arrow={false}
          content={
            <List
              className="max-h-80 w-[360px] overflow-y-auto"
              dataSource={notifications}
              loading={dashboard.loading && notifications.length === 0}
              locale={{ emptyText: "No unresolved cases." }}
              rowKey="id"
              size="small"
              renderItem={(notification) => {
                const tone = TONE_CONFIG[notification.tone];
                const Icon = tone.icon;
                return (
                  <List.Item style={{ padding: 0 }}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/90"
                    >
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                          tone.bg,
                        )}
                      >
                        <Icon style={{ color: tone.color, fontSize: 16 }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold text-ink-900">
                          {notification.title}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-500">
                          {notification.detail}
                        </span>
                        <span className="mt-1 block text-[11px] text-ink-400">
                          {notification.time}
                        </span>
                      </span>
                    </button>
                  </List.Item>
                );
              }}
            />
          }
          onOpenChange={setOpenNotifications}
          open={openNotifications}
          placement="bottomRight"
          title={
            <div className="flex w-[360px] items-center justify-between">
              <span>Unresolved cases</span>
              <button
                type="button"
                onClick={() => void dashboard.refresh()}
                className="btn-quiet flex items-center gap-1 text-xs"
              >
                <ReloadOutlined className={cn(dashboard.loading && "animate-spin")} />
                Refresh
              </button>
            </div>
          }
          trigger="click"
        >
          <button
            type="button"
            aria-label={`Unresolved cases (${notifications.length})`}
            aria-expanded={openNotifications}
            className={cn(
              "relative grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-surface/80 hover:text-ink-900 cursor-pointer",
              openNotifications && "bg-surface text-ink-900 shadow-glass",
            )}
          >
            <Badge
              count={notifications.length}
              overflowCount={99}
              size="small"
              offset={[2, -2]}
            >
              <BellOutlined className="text-base text-ink-500 hover:text-ink-900" />
            </Badge>
          </button>
        </Popover>

        <div className="mx-2 h-6 w-px bg-line" />

        {/* User Profile Ant Design Dropdown */}
        <Dropdown menu={{ items: userMenuItems }} trigger={["click"]} placement="bottomRight">
          <button
            type="button"
            aria-label="Account menu"
            className="flex items-center gap-3 rounded-xl px-1.5 py-1 transition-colors hover:bg-surface/80 focus:outline-none cursor-pointer"
          >
            <Avatar
              style={{
                backgroundColor: "#1677ff",
                verticalAlign: "middle",
                fontWeight: 600,
              }}
              size={36}
            >
              {initials}
            </Avatar>
            <span className="hidden flex-col items-start leading-tight md:flex text-left">
              <span className="text-[13px] font-semibold text-ink-900">{displayName}</span>
              <span className="text-[11px] text-ink-400">Reviewer</span>
            </span>
          </button>
        </Dropdown>
      </div>
    </header>
  );
}

/** Quick light/dark switch; the full control lives in Settings › Appearance. */
function ThemeToggle() {
  const { theme, mounted, toggle } = useTheme();
  const dark = mounted && theme === "dark";
  const nextLabel = dark ? "light" : "dark";

  return (
    <Tooltip title={`Switch to ${nextLabel} mode`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`Switch to ${nextLabel} mode`}
        className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-surface/80 hover:text-ink-900 cursor-pointer"
      >
        {dark ? (
          <SunOutlined className="text-base" />
        ) : (
          <MoonOutlined className="text-base" />
        )}
      </button>
    </Tooltip>
  );
}

function TelegramIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 496 512"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="248" cy="256" r="248" fill="#24A1DE" />
      <path
        fill="#FFFFFF"
        d="M369.8 177.9l-40.7 191.8c-3 13.6-11.1 16.9-22.4 10.5l-62-45.7-29.9 28.8c-3.3 3.3-6.1 6.1-12.5 6.1l4.4-63.1 114.9-103.8c5-4.4-1.1-6.9-7.7-2.5l-142 89.4-61.2-19.1c-13.3-4.2-13.6-13.3 2.8-19.7l239.1-92.2c11.1-4 20.8 2.7 17.2 19.5z"
      />
    </svg>
  );
}
