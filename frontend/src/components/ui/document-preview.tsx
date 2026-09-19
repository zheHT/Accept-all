"use client";

import { useEffect } from "react";
import { Download, FileText, ScanLine, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface PreviewDocument {
  name: string;
  role?: "SI" | "BL" | "other";
  pages: number;
  sizeLabel?: string;
  scanned?: boolean;
  /** Document text, one entry per line. */
  lines: string[];
  /** Indexes of lines to highlight as the source of a problem. */
  problemLines?: number[];
}

const ROLE_LABEL: Record<string, string> = {
  SI: "Shipping Instruction",
  BL: "Bill of Lading",
  other: "Attachment",
};

/**
 * Document preview.
 *
 * Renders the extracted text as a page so a reviewer can read the source
 * without leaving ShipVerify, and can save it as a text file. Lines that
 * triggered a discrepancy or failed OCR are highlighted in place.
 */
export function DocumentPreview({
  document: doc,
  onClose,
}: {
  document: PreviewDocument | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!doc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.document.addEventListener("keydown", onKeyDown);
    return () => window.document.removeEventListener("keydown", onKeyDown);
  }, [doc, onClose]);

  if (!doc) return null;

  const problems = new Set(doc.problemLines ?? []);

  const download = () => {
    const blob = new Blob([doc.lines.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${doc.name.replace(/\.[a-z]+$/i, "")}-extracted.txt`;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close document preview"
        onClick={onClose}
        className="absolute inset-0 animate-[fade-in_0.15s_ease-out] bg-overlay backdrop-blur-sm"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${doc.name}`}
        className="glass-solid relative flex max-h-[84vh] w-full max-w-[720px] animate-[fade-in_0.2s_ease-out] flex-col overflow-hidden"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
            <FileText className="size-[17px]" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              {doc.role && doc.role !== "other" && (
                <span className="rounded bg-gradient-to-b from-brand-500 to-brand-700 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white">
                  {doc.role}
                </span>
              )}
              <span className="truncate text-[14px] font-semibold text-ink-900">{doc.name}</span>
              {doc.scanned && (
                <span className="inline-flex items-center gap-1 rounded-md bg-review-50 px-1.5 py-0.5 text-[10.5px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                  <ScanLine className="size-3" strokeWidth={2.25} />
                  Scanned
                </span>
              )}
            </p>
            <p className="tabular mt-1 text-[11.5px] text-ink-400">
              {ROLE_LABEL[doc.role ?? "other"]} · {doc.pages} page
              {doc.pages === 1 ? "" : "s"}
              {doc.sizeLabel ? ` · ${doc.sizeLabel}` : ""} · extracted text
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={download} className="btn-glass px-2.5 py-1.5 text-[12px]">
              <Download className="size-3.5" strokeWidth={2} />
              Save text
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-surface hover:text-ink-900"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-canvas/60 p-5">
          <div className="mx-auto max-w-[640px] rounded-xl border border-line bg-surface px-7 py-6 shadow-glass">
            <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.9] text-ink-700">
              {doc.lines.map((line, index) => (
                <span
                  key={index}
                  className={cn(
                    "block rounded px-1.5",
                    problems.has(index) &&
                      "bg-review-50 font-semibold text-review-700 ring-1 ring-inset ring-review-200",
                  )}
                >
                  {line || " "}
                </span>
              ))}
            </pre>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-[11.5px] text-ink-400">
            Text shown is what the extraction agent read from the file.
          </span>
          <button type="button" onClick={onClose} className="btn-glass px-3 py-1.5 text-[12px]">
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
