"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  Minus,
  Plus,
  Rows2,
  ScanLine,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { getDocumentContent } from "@/lib/api";
import type { DocumentEvidence } from "@/lib/review-data";

type Layout = "side-by-side" | "stacked";
type PaneMode = "original" | "text";
type Role = "SI" | "BL";

interface Position {
  mode: PaneMode;
  page: number;
  pages: number;
  zoom: number;
  textScrollTop: number;
}

const DEFAULT_POSITION: Position = { mode: "text", page: 1, pages: 1, zoom: 100, textScrollTop: 0 };

export interface DocumentComparisonProps {
  si: DocumentEvidence;
  bl?: DocumentEvidence;
  problemField: string;
  open: boolean;
  onClose: () => void;
  heading?: string;
  /** Set for the single-document compatibility view so it never labels a BL as SI. */
  singleRole?: "SI" | "BL" | "other";
}

/**
 * Shared source viewer used by the review queue, inbox, and case drawer.
 * Each pane owns its reading mode and position so mixed PDF/text review is
 * possible without losing context while moving between the two documents.
 */
export function DocumentComparison({
  si,
  bl,
  problemField,
  open,
  onClose,
  heading = "Document Comparison",
  singleRole,
}: DocumentComparisonProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useState<Layout>("side-by-side");
  const [positions, setPositions] = useState<Record<Role, Position>>({ SI: DEFAULT_POSITION, BL: DEFAULT_POSITION });
  const [sourceUrls, setSourceUrls] = useState<Partial<Record<Role, string>>>({});
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<Role, string>>>({});
  const sourceUrlsRef = useRef(sourceUrls);

  const documents = useMemo(() => ({ SI: si, BL: bl }), [si, bl]);
  const storageKey = `shipverify:document-position:${si.caseId || "case"}:${si.documentId || si.name}:${bl?.documentId || bl?.name || ""}`;

  useEffect(() => {
    setSourceUrls((current) => {
      Object.values(current).forEach((url) => url && URL.revokeObjectURL(url));
      return {};
    });
    setSourceErrors({});
  }, [si.caseId, si.documentId, si.name, bl?.caseId, bl?.documentId, bl?.name]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<Record<Role, Position>> | null;
      if (saved) {
        setPositions({
          SI: { ...DEFAULT_POSITION, ...(saved.SI || {}) },
          BL: { ...DEFAULT_POSITION, ...(saved.BL || {}) },
        });
      }
    } catch {
      // A stale or blocked localStorage entry should never stop document review.
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, storageKey]);

  useEffect(() => {
    if (!open) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(positions));
    } catch {
      // Position retention is best effort (private browsing can deny storage).
    }
  }, [open, positions, storageKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    sourceUrlsRef.current = sourceUrls;
  }, [sourceUrls]);

  useEffect(() => () => {
    Object.values(sourceUrlsRef.current).forEach((url) => url && URL.revokeObjectURL(url));
  }, []);

  const loadSource = useCallback(async (role: Role) => {
    const doc = documents[role];
    if (!doc?.documentId || !doc.caseId) {
      setSourceErrors((current) => ({ ...current, [role]: "The original file is not available for this document." }));
      return;
    }
    setSourceErrors((current) => ({ ...current, [role]: undefined }));
    try {
      const { blob, pages } = await getDocumentContent(doc.caseId, doc.documentId);
      const url = URL.createObjectURL(blob);
      setSourceUrls((current) => {
        if (current[role]) URL.revokeObjectURL(current[role]!);
        return { ...current, [role]: url };
      });
      if (pages) setPositions((current) => ({ ...current, [role]: { ...current[role], pages, page: Math.min(current[role].page, pages) } }));
    } catch (error) {
      setSourceErrors((current) => ({
        ...current,
        [role]: error instanceof Error ? error.message : "The original file could not be loaded.",
      }));
    }
  }, [documents]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-2 sm:p-4 md:p-6">
      <button
        type="button"
        aria-label="Close document comparison"
        onClick={onClose}
        className="absolute inset-0 animate-[fade-in_0.15s_ease-out] bg-black/60 backdrop-blur-sm"
      />

      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        className="glass-solid relative flex h-[90vh] max-h-[920px] w-full max-w-[1440px] animate-[fade-in_0.2s_ease-out] flex-col overflow-hidden rounded-2xl border border-line shadow-2xl outline-none"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
              <Columns2 className="size-[17px]" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold tracking-tight text-ink-900">{heading}</p>
              <p className="mt-0.5 truncate text-[11.5px] text-ink-400">{problemField} · SI vs BL evidence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {bl && (
              <div className="hidden rounded-lg border border-line bg-surface/70 sm:flex">
                <button type="button" onClick={() => setLayout("side-by-side")} aria-pressed={layout === "side-by-side"} className={cn("flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors", layout === "side-by-side" ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 font-semibold" : "text-ink-400 hover:text-ink-700")}>
                  <Columns2 className="size-3.5" strokeWidth={2} /> Side by side
                </button>
                <button type="button" onClick={() => setLayout("stacked")} aria-pressed={layout === "stacked"} className={cn("flex items-center gap-1.5 rounded-r-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors", layout === "stacked" ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 font-semibold" : "text-ink-400 hover:text-ink-700")}>
                  <Rows2 className="size-3.5" strokeWidth={2} /> Stacked
                </button>
              </div>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-surface hover:text-ink-900">
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
        </header>

        <div className={cn("grid min-h-0 flex-1 gap-3 overflow-y-auto bg-canvas/60 p-3 sm:gap-4 sm:p-4 xl:grid-cols-2", layout === "stacked" && "xl:grid-cols-1")}>
          <DocumentPane role="SI" displayRole={singleRole || "SI"} evidence={si} problemField={problemField} position={positions.SI} sourceUrl={sourceUrls.SI} sourceError={sourceErrors.SI} onChange={(next) => setPositions((current) => ({ ...current, SI: { ...current.SI, ...next } }))} onLoadSource={() => void loadSource("SI")} />
          {bl && <DocumentPane role="BL" displayRole="BL" evidence={bl} problemField={problemField} position={positions.BL} sourceUrl={sourceUrls.BL} sourceError={sourceErrors.BL} onChange={(next) => setPositions((current) => ({ ...current, BL: { ...current.BL, ...next } }))} onLoadSource={() => void loadSource("BL")} />}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          <span className="text-[11.5px] text-ink-400">Original documents and machine extraction are preserved; reviewer decisions are recorded separately.</span>
          <button type="button" onClick={onClose} className="btn-glass px-3 py-1.5 text-[12px]">Close</button>
        </footer>
      </section>
    </div>
  );
}
function DocumentPane({
  role,
  displayRole,
  evidence,
  problemField,
  position,
  sourceUrl,
  sourceError,
  onChange,
  onLoadSource,
}: {
  role: Role;
  displayRole: "SI" | "BL" | "other";
  evidence: DocumentEvidence;
  problemField: string;
  position: Position;
  sourceUrl?: string;
  sourceError?: string;
  onChange: (next: Partial<Position>) => void;
  onLoadSource: () => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const lines = evidence.fullLines?.length ? evidence.fullLines : evidence.snippet;
  const problems = new Set(evidence.problemLines ?? []);
  if (problems.size === 0 && evidence.highlightIndex >= 0) problems.add(evidence.highlightIndex);

  const fileExt = (evidence.name.split(".").pop() || "DOC").toUpperCase();
  const isPdf = /pdf/i.test(evidence.contentType || "") || /\.pdf$/i.test(evidence.name);
  const isImage = /^image\//i.test(evidence.contentType || "") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(evidence.name);

  const pageCount = Math.max(position.pages || 1, evidence.pages || 1);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const onLoadSourceRef = useRef(onLoadSource);

  useEffect(() => {
    onLoadSourceRef.current = onLoadSource;
  }, [onLoadSource]);

  useEffect(() => {
    if (position.mode === "original" && !sourceUrl && !sourceError && evidence.documentId) {
      onLoadSourceRef.current();
    }
  }, [evidence.documentId, position.mode, sourceError, sourceUrl]);

  useEffect(() => {
    if (position.mode === "text" && textRef.current) textRef.current.scrollTop = position.textScrollTop;
  }, [position.mode, position.textScrollTop]);

  const download = async () => {
    setDownloadError(null);
    if (position.mode === "original" && evidence.documentId && evidence.caseId) {
      try {
        const { blob } = await getDocumentContent(evidence.caseId, evidence.documentId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = evidence.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return;
      } catch {
        // Fallback to downloading parsed text if storage binary is unavailable
      }
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${evidence.name.replace(/\.[a-z0-9]+$/i, "")}-parsed.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const unreadable = evidence.scanned && !evidence.rawText && !lines.length;

  return (
    <article
      className={cn(
        "flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-xl border bg-surface shadow-glass",
        role === "BL" && evidence.extractedValue === null ? "border-review-200/80" : "border-line"
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white",
                displayRole === "BL" && evidence.extractedValue === null
                  ? "bg-gradient-to-b from-review-500 to-review-700"
                  : "bg-gradient-to-b from-brand-500 to-brand-700"
              )}
            >
              {displayRole === "other" ? "FILE" : displayRole}
            </span>
            <span className="truncate text-[13px] font-semibold text-ink-900">
              {displayRole === "SI" ? "Shipping Instruction" : displayRole === "BL" ? "Bill of Lading" : evidence.name}
            </span>
            <span className="rounded bg-canvas/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-ink-500 ring-1 ring-inset ring-line">
              {fileExt}
            </span>
            {evidence.scanned && (
              <span className="inline-flex items-center gap-1 rounded-md bg-review-50 px-1.5 py-0.5 text-[10.5px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                <ScanLine className="size-3" strokeWidth={2.25} /> Scanned
              </span>
            )}
          </p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-[11.5px] text-ink-400">
            <FileText className="size-3 shrink-0 text-ink-300" strokeWidth={2} />
            {evidence.name} · {evidence.pages} page{evidence.pages === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          className="btn-glass shrink-0 px-2.5 py-1 text-[11px]"
          aria-label={`Download ${evidence.name}`}
        >
          <Download className="size-3" strokeWidth={2} /> Download
        </button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/60 px-3 py-2 sm:px-4">
        <div role="tablist" aria-label={`${role} document view`} className="flex rounded-lg border border-line bg-canvas/40 p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={position.mode === "original"}
            onClick={() => {
              onChange({ mode: "original" });
              if (!sourceUrl && !sourceError && evidence.documentId) onLoadSource();
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              position.mode === "original" ? "bg-surface text-brand-700 shadow-glass font-semibold" : "text-ink-400 hover:text-ink-700"
            )}
          >
            Original View
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={position.mode === "text"}
            onClick={() => onChange({ mode: "text" })}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              position.mode === "text" ? "bg-surface text-brand-700 shadow-glass font-semibold" : "text-ink-400 hover:text-ink-700"
            )}
          >
            Extracted Text
          </button>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-ink-500">
          <button
            type="button"
            className="grid size-6 place-items-center rounded-md hover:bg-surface text-ink-600 transition-colors"
            onClick={() => onChange({ zoom: Math.max(50, position.zoom - 10) })}
            aria-label="Zoom out"
            title="Zoom out (min 50%)"
          >
            <Minus className="size-3" />
          </button>
          <button
            type="button"
            className="tabular min-w-[44px] rounded px-1.5 py-0.5 text-center font-medium hover:bg-surface text-ink-700 transition-colors"
            onClick={() => onChange({ zoom: 100 })}
            title="Click to reset zoom to 100%"
          >
            {position.zoom}%
          </button>
          <button
            type="button"
            className="grid size-6 place-items-center rounded-md hover:bg-surface text-ink-600 transition-colors"
            onClick={() => onChange({ zoom: Math.min(250, position.zoom + 10) })}
            aria-label="Zoom in"
            title="Zoom in (max 250%)"
          >
            <Plus className="size-3" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-canvas/60">
        {position.mode === "original" ? (
          <div className="relative flex h-[min(65vh,720px)] min-h-[380px] flex-col">
            {sourceUrl && !sourceError ? (
              isImage ? (
                <div className="flex flex-1 items-center justify-center overflow-auto p-4 bg-canvas/40">
                  <img
                    src={sourceUrl}
                    alt={`${evidence.name} original view`}
                    style={{
                      transform: `scale(${position.zoom / 100})`,
                      transformOrigin: "center center",
                      transition: "transform 0.15s ease-out",
                    }}
                    className="max-h-full max-w-full rounded object-contain shadow-glass"
                  />
                </div>
              ) : isPdf ? (
                <iframe
                  title={`${evidence.name} original view`}
                  src={`${sourceUrl}#page=${Math.max(1, position.page)}&zoom=${position.zoom}`}
                  className="min-h-0 flex-1 border-0 bg-white"
                />
              ) : (
                <iframe
                  title={`${evidence.name} original view`}
                  src={sourceUrl}
                  className="min-h-0 flex-1 border-0 bg-white"
                />
              )
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3.5 py-2 text-[12px] text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-medium">
                    <FileText className="size-3.5 shrink-0 text-amber-600" />
                    <span>Original document file is unavailable in storage. Inspecting parsed text lines instead.</span>
                  </div>
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300">
                    {fileExt} · Parsed View
                  </span>
                </div>
                <div
                  ref={textRef}
                  onScroll={(event) => onChange({ textScrollTop: event.currentTarget.scrollTop })}
                  className="h-full min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 bg-canvas/30"
                >
                  <pre
                    style={{
                      fontSize: `${Math.max(10, (11.5 * position.zoom) / 100)}px`,
                      lineHeight: 1.85,
                    }}
                    className="mx-auto max-w-[760px] whitespace-pre-wrap break-words rounded-xl border border-line bg-surface px-3 py-4 font-mono text-ink-700 shadow-glass sm:px-5"
                  >
                    {unreadable && (
                      <span className="mb-3 block rounded-lg border border-review-200 bg-review-50/70 px-3 py-2 font-sans text-[12px] font-medium text-review-700">
                        This document could not be read reliably. Treat extracted values as unresolved until a reviewer supplies a decision.
                      </span>
                    )}
                    {lines.length ? (
                      lines.map((line, index) => (
                        <span
                          key={index}
                          className={cn(
                            "block rounded px-1.5 transition-colors",
                            problems.has(index) &&
                              (role === "BL"
                                ? "bg-review-50 font-semibold text-review-700 ring-1 ring-inset ring-review-200"
                                : "bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-200")
                          )}
                        >
                          {line || " "}
                        </span>
                      ))
                    ) : (
                      <span className="block text-ink-400">No extracted or parsed text lines available.</span>
                    )}
                  </pre>
                </div>
              </div>
            )}
            {isPdf && sourceUrl && !sourceError && pageCount > 1 && (
              <div className="flex items-center justify-center gap-2 border-t border-line bg-surface/70 px-3 py-2">
                <button
                  type="button"
                  onClick={() => onChange({ page: Math.max(1, position.page - 1) })}
                  disabled={position.page <= 1}
                  className="grid size-7 place-items-center rounded-md text-ink-500 hover:bg-surface disabled:opacity-30"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <label className="flex items-center gap-1 text-[11px] text-ink-500">
                  <span className="sr-only">Page</span>
                  <input
                    aria-label="Current page"
                    type="number"
                    min={1}
                    max={pageCount}
                    value={position.page}
                    onChange={(event) =>
                      onChange({ page: Math.min(Math.max(1, Number(event.target.value) || 1), pageCount) })
                    }
                    className="field-glass w-12 px-1.5 py-1 text-center text-[11px]"
                  />{" "}
                  / {pageCount}
                </label>
                <button
                  type="button"
                  onClick={() => onChange({ page: Math.min(pageCount, position.page + 1) })}
                  disabled={position.page >= pageCount}
                  className="grid size-7 place-items-center rounded-md text-ink-500 hover:bg-surface disabled:opacity-30"
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            ref={textRef}
            onScroll={(event) => onChange({ textScrollTop: event.currentTarget.scrollTop })}
            className="h-[min(65vh,720px)] min-h-[380px] overflow-y-auto p-3 sm:p-4"
          >
            <pre
              style={{
                fontSize: `${Math.max(10, (11.5 * position.zoom) / 100)}px`,
                lineHeight: 1.85,
              }}
              className="mx-auto max-w-[760px] whitespace-pre-wrap break-words rounded-xl border border-line bg-surface px-3 py-4 font-mono text-ink-700 shadow-glass sm:px-5"
            >
              {unreadable && (
                <span className="mb-3 block rounded-lg border border-review-200 bg-review-50/70 px-3 py-2 font-sans text-[12px] font-medium text-review-700">
                  This document could not be read reliably. Treat extracted values as unresolved until a reviewer supplies a decision.
                </span>
              )}
              {lines.length ? (
                lines.map((line, index) => (
                  <span
                    key={index}
                    className={cn(
                      "block rounded px-1.5 transition-colors",
                      problems.has(index) &&
                        (role === "BL"
                          ? "bg-review-50 font-semibold text-review-700 ring-1 ring-inset ring-review-200"
                          : "bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-200")
                    )}
                  >
                    {line || " "}
                  </span>
                ))
              ) : (
                <span className="block text-ink-400">No extracted text is available.</span>
              )}
            </pre>
          </div>
        )}
      </div>

      <div className="border-t border-line px-3 py-2.5 sm:px-4">
        <p className="text-[12px]">
          <span className="text-ink-400">{problemField} read as: </span>
          <span className={cn("font-semibold", evidence.extractedValue ? "text-ink-900" : "text-review-700")}>
            {evidence.extractedValue ?? "[unreadable]"}
          </span>
        </p>
        {downloadError && <p className="mt-1 text-[11px] text-review-700">{downloadError}</p>}
      </div>
    </article>
  );
}
