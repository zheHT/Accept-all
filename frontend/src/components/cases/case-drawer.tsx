"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  RefreshCw,
  ScanLine,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusChip } from "@/components/status-chip";
import { DocumentPreview, type PreviewDocument } from "@/components/ui/document-preview";
import { useToast } from "@/components/ui/toast";
import { caseDocumentBody } from "@/lib/document-text";
import { REQUIRED_FIELDS, type FieldResult, type VerificationCase } from "@/lib/case-data";

const RESULT_STYLE: Record<FieldResult, { label: string; chip: string; row: string }> = {
  match: {
    label: "Match",
    chip: "bg-matched-50 text-matched-700 ring-matched-200",
    row: "",
  },
  mismatch: {
    label: "Mismatch",
    chip: "bg-mismatch-50 text-mismatch-700 ring-mismatch-200",
    row: "bg-mismatch-50/60",
  },
  uncertain: {
    label: "Uncertain",
    chip: "bg-review-50 text-review-700 ring-review-200",
    row: "bg-review-50/60",
  },
  missing: {
    label: "Missing",
    chip: "bg-failed-50 text-failed-700 ring-failed-200",
    row: "bg-failed-50/50",
  },
  pending: {
    label: "Pending",
    chip: "bg-processing-50 text-processing-700 ring-processing-200",
    row: "",
  },
};

/**
 * Verification case detail: the discrepancy report for one shipment.
 *
 * The verdict is stated first, then the evidence (source email and documents),
 * then the field-by-field comparison. No action is ever taken automatically —
 * approving a draft B/L stays a human decision.
 */
export function CaseDrawer({
  verificationCase,
  onClose,
  onRetry,
}: {
  verificationCase: VerificationCase | null;
  onClose: () => void;
  onRetry: (id: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewDocument | null>(null);

  useEffect(() => {
    if (!verificationCase) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [verificationCase, onClose]);

  if (!verificationCase) return null;

  const item = verificationCase;
  const mismatches = item.fields.filter((field) => field.result === "mismatch");
  const unresolved = item.fields.filter(
    (field) => field.result === "uncertain" || field.result === "missing",
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close case detail"
        onClick={onClose}
        className="absolute inset-0 animate-[fade-in_0.2s_ease-out] bg-overlay backdrop-blur-sm"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Verification case ${item.caseId}`}
        className="relative flex h-full w-full max-w-[760px] animate-[drawer-in_0.28s_cubic-bezier(0.22,1,0.36,1)] flex-col border-l border-edge bg-surface/95 shadow-glass-lg backdrop-blur-2xl backdrop-saturate-150"
      >
        <header className="flex items-start gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] font-semibold text-ink-400">
                {item.caseId}
              </span>
              <StatusChip status={item.result} />
              {item.documents.bl?.scanned && (
                <span className="inline-flex items-center gap-1 rounded-md bg-review-50 px-1.5 py-0.5 text-[10.5px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                  <ScanLine className="size-3" strokeWidth={2.25} />
                  Scanned B/L
                </span>
              )}
            </div>
            <h2 className="mt-2 text-[20px] font-semibold leading-snug tracking-tight text-ink-900">
              {item.shipment}
            </h2>
            <p className="mt-1 text-[12.5px] text-ink-400">
              {item.carrierRef ? `Carrier reference ${item.carrierRef} · ` : ""}
              Updated {item.updated.toLowerCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-surface hover:text-ink-900"
          >
            <X className="size-4.5" strokeWidth={2} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <Verdict item={item} mismatchCount={mismatches.length} unresolvedCount={unresolved.length} />

          <section className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-edge bg-surface/60 p-4">
              <p className="eyebrow">Source email</p>
              <p className="mt-2 flex items-start gap-2 text-[13px] font-medium text-ink-900">
                <Mail className="mt-0.5 size-3.5 shrink-0 text-ink-400" strokeWidth={2} />
                {item.sourceEmailSubject}
              </p>
              <p className="mt-1.5 text-[12px] text-ink-500">{item.sourceEmailSender}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-400">{item.sourceEmailReceived}</p>
            </div>

            <div className="rounded-xl border border-edge bg-surface/60 p-4">
              <p className="eyebrow">Documents</p>
              <div className="mt-2 flex flex-col gap-2">
                {(["SI", "BL"] as const).map((role) => {
                  const file = role === "SI" ? item.documents.si : item.documents.bl;
                  if (!file) return null;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => {
                        const body = caseDocumentBody(item, role);
                        setPreview({
                          name: file.name,
                          role,
                          pages: file.pages,
                          scanned: role === "BL" ? item.documents.bl?.scanned : false,
                          lines: body.lines,
                          problemLines: body.problemLines,
                        });
                      }}
                      className="flex items-center gap-2.5 rounded-lg border border-line bg-surface/80 px-2.5 py-2 text-left transition-colors hover:border-brand-200 hover:bg-surface"
                    >
                      <span className="rounded bg-gradient-to-b from-brand-500 to-brand-700 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white">
                        {role}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-700">
                        {file.name}
                      </span>
                      <ExternalLink className="size-3.5 shrink-0 text-ink-400" strokeWidth={2} />
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="mt-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Field-by-field comparison</p>
                <p className="mt-1.5 text-[12.5px] text-ink-500">
                  {item.fieldsChecked === null
                    ? "No fields could be compared"
                    : `${item.fieldsChecked} of ${REQUIRED_FIELDS.length} required fields checked`}
                </p>
              </div>
              {item.confidence > 0 && (
                <span className="tabular rounded-full bg-surface/80 px-2.5 py-1 text-[11px] font-medium text-ink-500 ring-1 ring-inset ring-line">
                  Extraction confidence {Math.round(item.confidence * 100)}%
                </span>
              )}
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-line">
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead className="bg-surface/70">
                  <tr className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Field
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Shipping Instruction
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Bill of Lading
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {item.fields.map((field) => {
                    const style = RESULT_STYLE[field.result];
                    return (
                      <tr key={field.field} className={style.row}>
                        <td className="border-t border-line px-4 py-3 align-top">
                          <span className="text-[12.5px] font-medium text-ink-900">
                            {field.field}
                          </span>
                          {field.note && (
                            <span className="mt-1 block max-w-[180px] text-[11px] leading-relaxed text-ink-400">
                              {field.note}
                            </span>
                          )}
                        </td>
                        <td className="border-t border-line px-4 py-3 align-top text-[12.5px] text-ink-700">
                          {field.si ?? <span className="text-ink-300">—</span>}
                        </td>
                        <td
                          className={cn(
                            "border-t border-line px-4 py-3 align-top text-[12.5px]",
                            field.result === "mismatch"
                              ? "font-semibold text-mismatch-700"
                              : "text-ink-700",
                          )}
                        >
                          {field.bl ?? (
                            <span className="text-ink-300">
                              {field.result === "pending" ? "extracting…" : "not readable"}
                            </span>
                          )}
                        </td>
                        <td className="border-t border-line px-4 py-3 text-right align-top">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                              style.chip,
                            )}
                          >
                            {style.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-edge bg-surface/55 p-4">
            <p className="eyebrow">How this case was produced</p>
            <ol className="mt-3 flex flex-wrap items-center gap-1.5">
              {[
                "Incoming email",
                "AI classification",
                "SI + BL extraction",
                "7-field normalization",
                "Validation",
              ].map((step) => (
                <li key={step} className="flex items-center gap-1.5">
                  <span className="rounded-lg bg-brand-50 px-2 py-1.5 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                    {step}
                  </span>
                  <ArrowRight className="size-3 text-ink-300" strokeWidth={2.5} />
                </li>
              ))}
              <li>
                <StatusChip status={item.result} />
              </li>
            </ol>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface/60 px-6 py-4">
          <span className="text-[12px] text-ink-400">
            The system never approves or edits a document on its own.
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-glass" onClick={onClose}>
              Close
            </button>
            {item.result === "failed" && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onRetry(item.id);
                  onClose();
                }}
              >
                <RefreshCw className="size-4" strokeWidth={2.25} />
                Retry processing
              </button>
            )}
            {item.result === "needs_review" && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => router.push(`/review?case=${item.id}`)}
              >
                Open human review
                <ArrowRight className="size-4" strokeWidth={2.25} />
              </button>
            )}
            {item.result === "mismatch" && (
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  toast({
                    title: "Correction request drafted",
                    description: `A carrier email listing the ${mismatches.length} discrepancy field(s) on ${item.shipment} is ready in your outbox for review.`,
                    tone: "warning",
                  })
                }
              >
                Draft correction request
                <ArrowRight className="size-4" strokeWidth={2.25} />
              </button>
            )}
            {item.result === "matched" && (
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  toast({
                    title: `${item.shipment} approval recorded`,
                    description: "Your approval of the draft B/L was logged against this case.",
                    tone: "success",
                  })
                }
              >
                <CheckCircle2 className="size-4" strokeWidth={2.25} />
                Approve draft B/L
              </button>
            )}
          </div>
        </footer>
      </section>

      <DocumentPreview document={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function Verdict({
  item,
  mismatchCount,
  unresolvedCount,
}: {
  item: VerificationCase;
  mismatchCount: number;
  unresolvedCount: number;
}) {
  const shared = "rounded-xl border p-4 flex items-start gap-3";

  if (item.result === "matched") {
    return (
      <div className={cn(shared, "border-matched-200 bg-matched-50/70")}>
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-matched-700" strokeWidth={2.25} />
        <div>
          <p className="text-[14px] font-semibold text-matched-700">No mismatch detected</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">
            All {REQUIRED_FIELDS.length} required fields match between the shipping instruction and
            the draft Bill of Lading.
          </p>
        </div>
      </div>
    );
  }

  if (item.result === "mismatch") {
    return (
      <div className={cn(shared, "border-mismatch-200 bg-mismatch-50/70")}>
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-mismatch-700" strokeWidth={2.25} />
        <div>
          <p className="text-[14px] font-semibold text-mismatch-700">
            {mismatchCount} discrepanc{mismatchCount === 1 ? "y" : "ies"} detected
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">{item.issueContext}</p>
        </div>
      </div>
    );
  }

  if (item.result === "needs_review") {
    return (
      <div className={cn(shared, "border-review-200 bg-review-50/70")}>
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-review-700" strokeWidth={2.25} />
        <div>
          <p className="text-[14px] font-semibold text-review-700">
            Human review required — {unresolvedCount} field
            {unresolvedCount === 1 ? "" : "s"} unresolved
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">{item.issueContext}</p>
        </div>
      </div>
    );
  }

  if (item.result === "processing") {
    return (
      <div className={cn(shared, "border-processing-200 bg-processing-50/70")}>
        <RefreshCw
          className="mt-0.5 size-5 shrink-0 animate-spin text-processing-700"
          strokeWidth={2.25}
        />
        <div>
          <p className="text-[14px] font-semibold text-processing-700">
            Extraction in progress — {item.fieldsChecked} of {REQUIRED_FIELDS.length} fields
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">{item.issueContext}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(shared, "border-failed-200 bg-failed-50/70")}>
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-failed-700" strokeWidth={2.25} />
      <div>
        <p className="text-[14px] font-semibold text-failed-700">
          Processing failed — {item.issue}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">{item.issueContext}</p>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-500">
          <FileText className="size-3.5" strokeWidth={2} />
          Retry after the sender supplies a machine-readable document.
        </p>
      </div>
    </div>
  );
}
