"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AuditOutlined,
  DashboardOutlined,
  InboxOutlined,
  ReadOutlined,
  SafetyCertificateFilled,
  SettingOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import { Badge } from "antd";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import { useWorkspaceCounts } from "@/components/workspace/workspace-counts";

interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  badge?: { value: number; tone: "neutral" | "review" };
}

const SETTINGS_NAV: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: SettingOutlined,
};

export function Sidebar() {
  const pathname = usePathname();
  const { unreadEmails, pendingReviews } = useWorkspaceCounts();
  const isActive = (href: string) =>
    pathname ? (href === "/" ? pathname === "/" : pathname.startsWith(href)) : false;

  // Badges track what is still untouched, so they fall as the operator works.
  const primaryNav: NavItem[] = [
    { label: "Dashboard", href: "/", icon: DashboardOutlined },
    {
      label: "Inbox",
      href: "/inbox",
      icon: InboxOutlined,
      badge: unreadEmails > 0 ? { value: unreadEmails, tone: "neutral" } : undefined,
    },
    { label: "Verification Cases", href: "/cases", icon: AuditOutlined },
    {
      label: "Review Queue",
      href: "/review",
      icon: SolutionOutlined,
      badge: pendingReviews > 0 ? { value: pendingReviews, tone: "review" } : undefined,
    },
    { label: "Knowledge Base", href: "/knowledge-base", icon: ReadOutlined },
  ];

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-edge bg-surface/55 backdrop-blur-xl backdrop-saturate-125 lg:flex">
        <div className="flex h-16 items-center gap-3 px-6">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
            <SafetyCertificateFilled className="text-lg text-white" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-tight text-ink-900">
              Ship<span className="text-[#1677FF] font-bold">Verify</span>
            </span>
            <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
              Document Control
            </span>
          </span>
        </div>

        <nav className="flex flex-1 flex-col px-3 pt-4">
          <span className="px-3 pb-2 text-[11px] font-medium tracking-wider text-ink-400 uppercase select-none">
            Workspace
          </span>
          <ul className="flex flex-col gap-1">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <NavRow item={item} active={isActive(item.href)} />
              </li>
            ))}
          </ul>

          <div className="mt-auto flex flex-col gap-1 pb-5">
            <div className="my-4 h-px bg-line" />
            <NavRow item={SETTINGS_NAV} active={isActive(SETTINGS_NAV.href)} />
          </div>
        </nav>
      </aside>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-edge bg-surface/95 px-2 lg:hidden"
      >
        {[...primaryNav, SETTINGS_NAV].map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative grid size-11 place-items-center rounded-xl transition-transform active:scale-95",
                active ? "bg-brand-50 text-brand-700" : "text-ink-400",
              )}
            >
              <Icon style={{ fontSize: 18 }} />
              {item.badge && (
                <span className="absolute right-0 top-0 min-w-4 rounded-full bg-review-500 px-1 text-center text-[9px] font-bold leading-4 text-white">
                  {item.badge.value}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-[#1677FF]/10 text-[#1677FF] font-semibold"
          : "text-ink-700 hover:bg-surface/80 hover:text-ink-900",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[#1677FF]" />
      )}
      <Icon
        style={{ fontSize: 16 }}
        className={cn(
          "shrink-0 transition-colors",
          active ? "text-[#1677FF]" : "text-ink-400 group-hover:text-ink-700",
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && (
        <Badge
          count={item.badge.value}
          overflowCount={99}
          style={{
            backgroundColor: item.badge.tone === "review" ? "#faad14" : "#1677ff",
            boxShadow: "none",
            fontWeight: 600,
            fontSize: "11px",
          }}
        />
      )}
    </Link>
  );
}
