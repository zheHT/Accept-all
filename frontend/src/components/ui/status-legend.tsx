"use client";

import Link from "next/link";
import { STATUS_META, type VerificationStatus } from "@/lib/status";

const ORDER: VerificationStatus[] = [
  "matched",
  "mismatch",
  "needs_review",
  "processing",
  "failed",
];

/** Legend that also navigates: each status opens the case list filtered to it. */
export function StatusLegend() {
  return (
    <ul className="mr-2 hidden flex-wrap items-center gap-x-3 gap-y-2 2xl:flex">
      {ORDER.map((status) => {
        const meta = STATUS_META[status];
        return (
          <li key={status}>
            <Link
              href={status === "needs_review" ? "/review" : `/cases?result=${status}`}
              title={`${meta.hint} — open the list`}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-surface/70 hover:text-ink-900"
            >
              <span className={`size-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
