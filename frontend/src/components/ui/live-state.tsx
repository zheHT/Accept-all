"use client";

import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";

export function LoadingState({ label = "Loading live data" }: { label?: string }) {
  return <div className="glass flex min-h-52 items-center justify-center gap-2 p-8 text-[13px] text-ink-500"><LoaderCircle className="size-4 animate-spin" />{label}</div>;
}

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="glass flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle className="size-5 text-failed-600" />
      <p className="max-w-lg text-[13px] text-ink-600">{message}</p>
      <button type="button" onClick={retry} className="btn-glass active:scale-95"><RefreshCw className="size-4" />Retry</button>
    </div>
  );
}

export function StaleNotice() {
  return <p className="rounded-lg bg-review-50 px-3 py-2 text-[12px] text-review-700 ring-1 ring-inset ring-review-200">Showing the last successful response while ShipVerify reconnects.</p>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="px-6 py-14 text-center"><p className="text-[14px] font-medium text-ink-700">{title}</p><p className="mt-1 text-[13px] text-ink-400">{detail}</p></div>;
}
