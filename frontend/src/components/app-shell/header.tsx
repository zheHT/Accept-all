"use client";

import { useState } from "react";
import { AlertTriangle, Bell, LogOut, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useTheme } from "@/components/theme/theme-provider";
import { useWorkspaceCounts } from "@/components/workspace/workspace-counts";
import { formatDate, statusLabel } from "@/lib/format";

export function Header() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { theme, mounted, toggle } = useTheme();
  const { attentionItems } = useWorkspaceCounts();
  const [open, setOpen] = useState<"alerts" | "user" | null>(null);
  if (!user) return null;
  const initials = (user.displayName || user.email || "R").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-edge bg-surface/95 px-8 shadow-sm">
      <div><h1 className="text-[15px] font-semibold tracking-tight text-ink-900">Shipping Document Verification</h1><p className="mt-0.5 hidden text-[11px] text-ink-400 sm:block">Live Gmail and Telegram operations</p></div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Switch to ${mounted && theme === "dark" ? "light" : "dark"} mode`} onClick={toggle} className="grid size-10 place-items-center rounded-xl text-ink-500 hover:bg-canvas active:scale-95">{mounted && theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
        <div className="relative"><button type="button" aria-label={`${attentionItems.length} unresolved alerts`} onClick={() => setOpen(open === "alerts" ? null : "alerts")} className="relative grid size-10 place-items-center rounded-xl text-ink-500 hover:bg-canvas active:scale-95"><Bell className="size-4" />{attentionItems.length > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-mismatch-600 px-1 text-center text-[9px] font-bold leading-4 text-white">{attentionItems.length}</span>}</button>{open === "alerts" && <div className="glass-solid absolute right-0 top-12 w-[360px] overflow-hidden"><header className="border-b border-line px-4 py-3 text-[13px] font-semibold text-ink-900">Newest unresolved cases</header>{attentionItems.length ? <ul className="max-h-80 overflow-y-auto">{attentionItems.map((item) => <li key={item.case_id}><button type="button" onClick={() => { setOpen(null); router.push(item.status === "NEEDS_REVIEW" ? `/review?case=${item.case_id}` : `/cases?case=${item.case_id}`) }} className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left hover:bg-surface active:scale-[0.99]"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-review-600" /><span><span className="block text-[12px] font-semibold text-ink-900">{statusLabel(item)} · {item.subject || item.case_id}</span><span className="mt-1 block text-[11px] text-ink-400">{formatDate(item.created_at)}</span></span></button></li>)}</ul> : <p className="px-4 py-8 text-center text-[12px] text-ink-400">No unresolved cases</p>}</div>}</div>
        <div className="relative"><button type="button" aria-label="Account menu" onClick={() => setOpen(open === "user" ? null : "user")} className="flex items-center gap-2 rounded-xl p-1.5 pr-2 hover:bg-canvas active:scale-95"><span className="grid size-8 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{initials}</span><span className="hidden max-w-36 truncate text-[12px] font-medium text-ink-800 md:block">{user.displayName || user.email}</span></button>{open === "user" && <div className="glass-solid absolute right-0 top-12 w-64 p-2"><p className="truncate px-2 py-2 text-[12px] text-ink-500">{user.email}</p><button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-ink-700 hover:bg-surface active:scale-95"><LogOut className="size-4" />Sign out</button></div>}</div>
      </div>
    </header>
  );
}
