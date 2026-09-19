"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileCheck2,
  Inbox,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useWorkspaceCounts } from "@/components/workspace/workspace-counts";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: { value: number; tone: "neutral" | "review" };
}

const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: Settings };

export function Sidebar() {
  const pathname = usePathname();
  const { unreadEmails, pendingReviews } = useWorkspaceCounts();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Badges track what is still untouched, so they fall as the operator works.
  const primaryNav: NavItem[] = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard },
    {
      label: "Inbox",
      href: "/inbox",
      icon: Inbox,
      badge: unreadEmails > 0 ? { value: unreadEmails, tone: "neutral" } : undefined,
    },
    { label: "Verification Cases", href: "/cases", icon: FileCheck2 },
    {
      label: "Review Queue",
      href: "/review",
      icon: UserRoundCheck,
      badge: pendingReviews > 0 ? { value: pendingReviews, tone: "review" } : undefined,
    },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[264px] flex-col border-r border-edge bg-surface/55 backdrop-blur-2xl backdrop-saturate-150">
      <div className="flex h-16 items-center gap-3 px-6">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 shadow-brand">
          <ShieldCheck className="size-5 text-white" strokeWidth={2.25} />
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-[17px] font-semibold tracking-tight text-ink-900">
            Ship
            <span className="bg-gradient-to-r from-brand-500 to-tide-500 bg-clip-text text-transparent">
              Verify
            </span>
          </span>
          <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
            Document Control
          </span>
        </span>
      </div>

      <nav className="flex flex-1 flex-col px-3 pt-4">
        <p className="eyebrow px-3 pb-2">Workspace</p>
        <ul className="flex flex-col gap-1">
          {primaryNav.map((item) => (
            <li key={item.href}>
              <NavRow item={item} active={isActive(item.href)} />
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-col gap-1 pb-5">
          <div className="my-4 h-px bg-gradient-to-r from-transparent via-line-strong to-transparent" />
          <NavRow item={SETTINGS_NAV} active={isActive(SETTINGS_NAV.href)} />
        </div>
      </nav>
    </aside>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
        active
          ? "bg-gradient-to-r from-brand-100/90 via-brand-50/70 to-transparent text-brand-700"
          : "text-ink-700 hover:bg-surface/70 hover:text-ink-900",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-400 to-brand-700" />
      )}
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-700",
        )}
        strokeWidth={2}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && (
        <span
          className={cn(
            "tabular rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
            item.badge.tone === "review"
              ? "bg-review-50 text-review-700 ring-1 ring-inset ring-review-200"
              : "bg-surface/80 text-ink-500 ring-1 ring-inset ring-line",
          )}
        >
          {item.badge.value}
        </span>
      )}
    </Link>
  );
}
