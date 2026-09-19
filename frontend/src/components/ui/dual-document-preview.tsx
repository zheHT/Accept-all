"use client";

import { useEffect, useState } from "react";
import { Columns2, Download, FileText, Rows2, ScanLine, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DocumentEvidence } from "@/lib/review-data";

type Layout = "side-by-side" | "stacked";

/**
 * Side-by-side document preview that shows both SI and BL in one modal.
 *
 * The reviewer can read both documents simultaneously, toggle between a
 * side-by-side layout and a stacked (vertical) one, and download either
 * document's text. Problem lines are highlighted in-place.
 */
export function DualDocumentPreview({
  si,
  bl,
  problemField,
  open,
  onClose,
}: {
  si: DocumentEvidence;
  bl: DocumentEvidence;
  problemField: string;
  open: boolean;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<Layout>("side-by-side");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.document.addEventListener("keydown", onKeyDown);
    return () => window.document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close document preview"
        onClick={onClose}
        className="absolute inset-0 animate-[fade-in_0.15s_ease-out] bg-overlay backdrop-blur-sm"
      />

      {/* Modal */}
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Side-by-side document comparison"
        className="glass-solid relative flex max-h-[90vh] w-full max-w-[1280px] animate-[fade-in_0.2s_ease-out] flex-col overflow-hidden"
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
              <Columns2 className="size-[17px]" strokeWidth={2} />
            </span>
            <div>
              <p className="text-[14px] font-semibold tracking-tight text-ink-900">
                Document Comparison
              </p>
              <p className="mt-0.5 text-[11.5px] text-ink-400">
                {problemField} · SI vs BL extracted text
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Layout toggle */}
            <div className="flex rounded-lg border border-line bg-surface/70">
              <button
                type="button"
                onClick={() => setLayout("side-by-side")}
                className={cn(
                  "flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
                  layout === "side-by-side"
                    ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"
                    : "text-ink-400 hover:text-ink-700",
                )}
              >
                <Columns2 className="size-3.5" strokeWidth={2} />
                Side by side
              </button>
              <button
                type="button"
                onClick={() => setLayout("stacked")}
                className={cn(
                  "flex items-center gap-1.5 rounded-r-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
                  layout === "stacked"
                    ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"
                    : "text-ink-400 hover:text-ink-700",
                )}
              >
                <Rows2 className="size-3.5" strokeWidth={2} />
                Stacked
              </button>
            </div>

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

        {/* Document panels */}
        <div
          className={cn(
            "flex-1 overflow-y-auto bg-canvas/60 p-4",
            layout === "side-by-side" ? "flex gap-4" : "flex flex-col gap-4",
          )}
        >
          <DocumentPanel
            role="SI"
            title="Shipping Instruction"
            evidence={si}
            problemField={problemField}
            layout={layout}
          />
          <DocumentPanel
            role="BL"
            title="Bill of Lading"
            evidence={bl}
            problemField={problemField}
            layout={layout}
          />
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-[11.5px] text-ink-400">
            Text shown is what the extraction agent read from each document. Problem lines are highlighted.
          </span>
          <button type="button" onClick={onClose} className="btn-glass px-3 py-1.5 text-[12px]">
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single-document panel inside the dual viewer                      */
/* ------------------------------------------------------------------ */

function DocumentPanel({
  role,
  title,
  evidence,
  problemField,
  layout,
}: {
  role: "SI" | "BL";
  title: string;
  evidence: DocumentEvidence;
  problemField: string;
  layout: Layout;
}) {
  const lines = evidence.fullLines?.length ? evidence.fullLines : evidence.snippet;
  const problems = new Set(evidence.problemLines ?? []);

  // If no problemLines from the data, fall back to the original highlightIndex
  if (problems.size === 0 && evidence.highlightIndex >= 0) {
    problems.add(evidence.highlightIndex);
  }

  const isProblemDoc = role === "BL" && evidence.extractedValue === null;

  const download = () => {
    const blob = new Blob([lines.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${evidence.name.replace(/\.[a-z]+$/i, "")}-extracted.txt`;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-surface shadow-glass",
        isProblemDoc ? "border-review-200/80" : "border-line",
        layout === "side-by-side" ? "min-w-0 flex-1" : "",
      )}
    >
      {/* Panel header */}
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white",
                isProblemDoc
                  ? "bg-gradient-to-b from-review-500 to-review-700"
                  : "bg-gradient-to-b from-brand-500 to-brand-700",
              )}
            >
              {role}
            </span>
            <span className="truncate text-[13px] font-semibold text-ink-900">{title}</span>
            {evidence.scanned && (
              <span className="inline-flex items-center gap-1 rounded-md bg-review-50 px-1.5 py-0.5 text-[10px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                <ScanLine className="size-3" strokeWidth={2.25} />
                Scanned
              </span>
            )}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-400">
            <FileText className="size-3 text-ink-300" strokeWidth={2} />
            {evidence.name} · {evidence.pages} page{evidence.pages === 1 ? "" : "s"}
          </p>
        </div>

        <button type="button" onClick={download} className="btn-glass shrink-0 px-2 py-1 text-[11px]">
          <Download className="size-3" strokeWidth={2} />
          Save
        </button>
      </div>

      {/* Panel body — scrollable text */}
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-[1.85] text-ink-700">
          {lines.map((line, index) => (
            <span
              key={index}
              className={cn(
                "block rounded px-1.5",
                problems.has(index) &&
                  (isProblemDoc
                    ? "bg-review-50 font-semibold text-review-700 ring-1 ring-inset ring-review-200"
                    : "bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"),
              )}
            >
              {line || " "}
            </span>
          ))}
        </pre>
      </div>

      {/* Extracted value footer */}
      <div className="border-t border-line px-4 py-2.5">
        <p className="text-[12px]">
          <span className="text-ink-400">{problemField} read as: </span>
          <span
            className={cn(
              "font-semibold",
              evidence.extractedValue ? "text-ink-900" : "text-review-700",
            )}
          >
            {evidence.extractedValue ?? "[unreadable]"}
          </span>
        </p>
      </div>
    </div>
  );
}
