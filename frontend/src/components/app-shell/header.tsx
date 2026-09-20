"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  Bell,
  LogOut,
  Moon,
  Settings,
  RefreshCw,
  Sun,
  TriangleAlert,
  UserRound,
  UserRoundSearch,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useDismiss } from "@/lib/use-dismiss";
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

const TONE: Record<Notification["tone"], { icon: typeof Bell; tile: string }> = {
  mismatch: {
    icon: AlertOctagon,
    tile: "bg-mismatch-50 text-mismatch-700 ring-mismatch-200",
  },
  review: {
    icon: UserRoundSearch,
    tile: "bg-review-50 text-review-700 ring-review-200",
  },
  failed: { icon: TriangleAlert, tile: "bg-failed-50 text-failed-700 ring-failed-200" },
};

export function Header() {
  const router = useRouter();
  const toast = useToast();
  const { user, signOut } = useAuth();
  const [openMenu, setOpenMenu] = useState<"none" | "notifications" | "user">("none");
  const { dashboard } = useWorkspaceCounts();
  const notifications = useMemo<Notification[]>(() => (
    (dashboard.data?.attention_items || []).slice(0, 6).map((item) => {
      const failed = item.processing_state === "DEAD_LETTER";
      const review = item.status === "NEEDS_REVIEW";
      const fields = [...new Set([...item.defect_fields, ...item.low_confidence_fields])].map(fieldLabel);
      return {
        id: item.case_id,
        title: failed ? "Processing failed" : review ? "Human review required" : "Document mismatch",
        detail: `${item.subject || item.case_id}${fields.length ? ` · ${fields.join(", ")}` : ""}`,
        time: relativeTime(item.created_at),
        tone: failed ? "failed" : review ? "review" : "mismatch",
        href: review ? `/review?case=${encodeURIComponent(item.case_id)}` : `/cases?case=${encodeURIComponent(item.case_id)}`,
      };
    })
  ), [dashboard.data]);

  const close = useCallback(() => setOpenMenu("none"), []);
  const shellRef = useDismiss<HTMLDivElement>(openMenu !== "none", close);
  if (!user) return null;
  const displayName = user.displayName || user.email || "Reviewer";
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const openNotification = (notification: Notification) => {
    close();
    router.push(notification.href);
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-6 border-b border-edge bg-surface/55 px-8 backdrop-blur-2xl backdrop-saturate-150">
      <div className="flex items-center gap-4">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink-900">
          Shipping Document Verification
        </h1>
        <span className="hidden items-center gap-2 rounded-full bg-matched-50/80 px-2.5 py-1 text-[11px] font-medium text-matched-700 ring-1 ring-inset ring-matched-200 lg:inline-flex">
          <span className="relative flex size-1.5">
            <span className="relative inline-flex size-1.5 rounded-full bg-matched-500" />
          </span>
          On-demand sync
        </span>
      </div>

      <div ref={shellRef} className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void dashboard.refresh();
            toast({ title: "Workspace refreshed", tone: "info" });
          }}
          disabled={dashboard.loading}
          aria-label="Refresh workspace"
          title="Refresh workspace"
          className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-surface/80 hover:text-ink-900 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={cn("size-[17px]", dashboard.loading && "animate-spin")} strokeWidth={2} />
        </button>

        <ThemeToggle />

        <div className="relative">
          <button
            type="button"
            onClick={() =>
              setOpenMenu((current) => (current === "notifications" ? "none" : "notifications"))
            }
            aria-label={`Unresolved cases (${notifications.length})`}
            aria-expanded={openMenu === "notifications"}
            className={cn(
              "relative grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-surface/80 hover:text-ink-900",
              openMenu === "notifications" && "bg-surface text-ink-900 shadow-glass",
            )}
          >
            <Bell className="size-[18px]" strokeWidth={2} />
            {notifications.length > 0 && (
              <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-mismatch-500 px-1 text-[9px] font-bold leading-4 text-white ring-2 ring-surface">
                {notifications.length}
              </span>
            )}
          </button>

          {openMenu === "notifications" && (
            <div className="glass-solid absolute right-0 top-[calc(100%+10px)] z-40 w-[380px] overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-[13px] font-semibold text-ink-900">Unresolved cases</p>
                <button
                  type="button"
                  onClick={() => void dashboard.refresh()}
                  className="btn-quiet"
                >
                  <RefreshCw className={cn("size-3.5", dashboard.loading && "animate-spin")} strokeWidth={2.25} />
                  Refresh
                </button>
              </div>
              <ul className="max-h-[320px] overflow-y-auto">
                {notifications.map((notification) => {
                  const tone = TONE[notification.tone];
                  const Icon = tone.icon;
                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(notification)}
                        className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface"
                      >
                        <span
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                            tone.tile,
                          )}
                        >
                          <Icon className="size-4" strokeWidth={2.25} />
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
                    </li>
                  );
                })}
                {!dashboard.loading && notifications.length === 0 && (
                  <li className="px-4 py-8 text-center text-[12.5px] text-ink-400">
                    No unresolved cases.
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="mx-2 h-6 w-px bg-line" />

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu((current) => (current === "user" ? "none" : "user"))}
            aria-label="Account menu"
            aria-expanded={openMenu === "user"}
            className={cn(
              "flex items-center gap-3 rounded-xl px-1.5 py-1 transition-colors hover:bg-surface/80",
              openMenu === "user" && "bg-surface shadow-glass",
            )}
          >
            <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[13px] font-semibold text-white shadow-brand">
              {initials}
            </span>
            <span className="hidden flex-col items-start leading-tight md:flex">
              <span className="text-[13px] font-semibold text-ink-900">{displayName}</span>
              <span className="text-[11px] text-ink-400">Reviewer</span>
            </span>
          </button>

          {openMenu === "user" && (
            <div className="glass-solid absolute right-0 top-[calc(100%+10px)] z-40 w-60 overflow-hidden p-1.5">
              <div className="px-2.5 py-2">
                <p className="text-[13px] font-semibold text-ink-900">{displayName}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-400">{user.email}</p>
              </div>
              <div className="my-1 h-px bg-line" />
              <MenuItem
                icon={UserRound}
                label="My profile"
                onClick={() => {
                  close();
                  toast({
                    title: "Profile",
                    description: "User profiles are managed in your identity provider.",
                    tone: "info",
                  });
                }}
              />
              <MenuItem
                icon={Settings}
                label="Settings"
                onClick={() => {
                  close();
                  router.push("/settings");
                }}
              />
              <MenuItem
                icon={LogOut}
                label="Sign out"
                onClick={() => {
                  close();
                  void signOut();
                }}
              />
            </div>
          )}
        </div>
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
    <button
      type="button"
      onClick={toggle}
      title={`Switch to ${nextLabel} mode`}
      aria-label={`Switch to ${nextLabel} mode`}
      className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-surface/80 hover:text-ink-900"
    >
      {dark ? (
        <Sun className="size-[18px]" strokeWidth={2} />
      ) : (
        <Moon className="size-[18px]" strokeWidth={2} />
      )}
    </button>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bell;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-ink-700 transition-colors hover:bg-surface hover:text-ink-900"
    >
      <Icon className="size-4 text-ink-400" strokeWidth={2} />
      {label}
    </button>
  );
}
