"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  ExternalLink,
  FileText,
  Pencil,
  ScanLine,
  ShieldQuestion,
  TriangleAlert,
  Clock,
  Send,
  Save,
  Check,
  CheckCheck,
  AlertCircle,
  Paperclip,
  Sparkles,
  RefreshCw,
  Download,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth/auth-provider";
import { type CaseDetail, getDocumentContent } from "@/lib/api";
import { DocumentComparison } from "@/components/ui/document-comparison";
import {
  type ReviewCase,
  type ReviewDecision,
  type DocumentEvidence,
  REVIEW_REASON_LABELS,
  REVIEW_STATUS_META,
  VERIFICATION_THRESHOLD,
} from "@/lib/review-data";
import { buildDocumentLines } from "@/lib/document-text";

type DecisionType = ReviewDecision["type"];

const WORKFLOW_STEPS = [
  "Document comparison",
  "Discrepancy detection",
  "Confidence scoring",
  "Review required",
  "Human decision",
  "Final verification result",
  "Case resolved",
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** "19 Sep 2026, 11:05 AM" */
function formatStamp(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-GB", { month: "short" });
  const hours24 = date.getHours();
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const meridiem = hours24 < 12 ? "AM" : "PM";
  return `${day} ${month} ${date.getFullYear()}, ${hours}:${minutes} ${meridiem}`;
}

export function ReviewDetail({
  reviewCase,
  caseDetail,
  onSubmit,
  onFinalize,
  onDeclineCase,
  onPrepareDraft,
  onConfirmSentDraft,
  preparingDraft = false,
  confirmingSent = false,
  onBack,
  onSaveDraft,
  onSendDraft,
}: {
  reviewCase: ReviewCase;
  caseDetail: CaseDetail | null;
  onSubmit: (decision: ReviewDecision) => void;
  onFinalize?: () => void;
  onDeclineCase?: () => void;
  onPrepareDraft?: () => void;
  onConfirmSentDraft?: () => void;
  preparingDraft?: boolean;
  confirmingSent?: boolean;
  onBack: () => void;
  onSaveDraft: (subject: string, body: string) => void;
  onSendDraft: () => void;
}) {
  const { user } = useAuth();
  const onPrepare = onPrepareDraft || onDeclineCase;
  const draftSectionRef = useRef<HTMLElement>(null);
  const prevDraftHashRef = useRef<string | undefined>(caseDetail?.draft?.content_hash);

  useEffect(() => {
    if (caseDetail?.draft && caseDetail.draft.content_hash !== prevDraftHashRef.current) {
      prevDraftHashRef.current = caseDetail.draft.content_hash;
      draftSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [caseDetail?.draft]);

  const handleDownloadAttachment = async (filename: string) => {
    if (!caseDetail) return;
    const doc = caseDetail.documents?.find((d) => d.filename === filename) || caseDetail.documents?.[0];
    if (doc) {
      try {
        const { blob } = await getDocumentContent(caseDetail.case_id, doc.document_id);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return;
      } catch (e) {
        console.error("Failed to download binary document", e);
      }
    }
  };

  const [decisionType, setDecisionType] = useState<DecisionType | null>(null);
  const [dualPreview, setDualPreview] = useState(false);
  const [correctedValue, setCorrectedValue] = useState("");
  const [notes, setNotes] = useState("");
  const [isEditingDecision, setIsEditingDecision] = useState(false);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Active timer to measure review duration
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const fields = useMemo(() => reviewCase.comparisonFields || [], [reviewCase.comparisonFields]);

  const [selectedField, setSelectedField] = useState(
    fields.find((field) => !field.resolved && field.discrepancyType !== "match")?.field ||
      fields.find((field) => !field.resolved)?.field ||
      fields[0]?.field ||
      reviewCase.problemField,
  );

  useEffect(() => {
    setDraftSubject(caseDetail?.draft?.subject || "");
    setDraftBody(caseDetail?.draft?.body || "");
  }, [caseDetail?.draft?.body, caseDetail?.draft?.subject]);

  useEffect(() => {
    setIsEditingDecision(false);
    setDecisionType(null);
    setCorrectedValue("");
    setNotes("");
  }, [selectedField]);

  const comparison = useMemo(
    () => fields.find((field) => field.field === selectedField),
    [fields, selectedField],
  );

  const activeFieldLabel = comparison?.label || reviewCase.problemField;
  const siValue = comparison?.si ?? reviewCase.si.extractedValue;
  const aiValue = comparison?.bl ?? reviewCase.bl.extractedValue;
  const activeComparison = caseDetail?.comparisons?.find((c) => c.field === selectedField);
  const activeConfidences = [
    activeComparison?.si?.confidence,
    activeComparison?.bl?.confidence,
  ].filter((v): v is number => typeof v === "number" && v > 0);
  const fieldConfidence = activeConfidences.length
    ? activeConfidences.reduce((a, b) => a + b, 0) / activeConfidences.length
    : reviewCase.confidence;
  const confidencePct = Math.round(fieldConfidence * 100);

  // Calculate discrepancies and resolution stats
  const mismatchCount = fields.filter((f) => f.discrepancyType === "mismatch").length;
  const missingCount = fields.filter((f) => f.discrepancyType === "missing").length;
  const uncertainCount = fields.filter((f) => f.discrepancyType === "uncertain").length;
  const resolvedCount = fields.filter((f) => f.resolved || f.humanReview?.resolved).length;
  const unresolvedFields = reviewCase.unresolvedFields || fields.filter((f) => !f.resolved && f.discrepancyType !== "match").map((f) => f.field);
  const unresolvedCount = unresolvedFields.length;

  // Keyboard navigation across the 7 fields (ArrowLeft / ArrowRight)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName)) return;
      const currentIndex = fields.findIndex((f) => f.field === selectedField);
      if (currentIndex === -1) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = fields[(currentIndex + 1) % fields.length];
        if (next) setSelectedField(next.field);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const prev = fields[(currentIndex - 1 + fields.length) % fields.length];
        if (prev) setSelectedField(prev.field);
      }
    },
    [fields, selectedField],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const canSubmit =
    decisionType !== null && (decisionType !== "correct" || correctedValue.trim().length > 0);
  const canFinalize = Boolean(
    onFinalize && unresolvedCount === 0 && resolvedCount > 0,
  );

  const submit = () => {
    if (!decisionType) return;

    const value =
      decisionType === "correct"
        ? correctedValue.trim()
        : decisionType === "confirm"
          ? (aiValue ?? siValue)
          : null;

    onSubmit({
      type: decisionType,
      field: selectedField,
      documentRole: "BL",
      value,
      notes: notes.trim(),
      reviewer: user?.displayName || user?.email || "Reviewer",
      at: formatStamp(new Date()),
    });
    setIsEditingDecision(false);
  };

  // Build field-focused line highlights for evidence panels
  const activeSiDoc = caseDetail?.documents.find((d) => d.document_type === "SI");
  const activeBlDoc = caseDetail?.documents.find((d) => d.document_type === "BL");
  const siBuild = buildDocumentLines("SI", activeSiDoc, caseDetail?.comparisons, activeFieldLabel);
  const blBuild = buildDocumentLines("BL", activeBlDoc, caseDetail?.comparisons, activeFieldLabel);

  const siEvidence: DocumentEvidence = {
    ...reviewCase.si,
    snippet: siBuild.lines,
    fullLines: siBuild.lines,
    problemLines: siBuild.problemLines,
    highlightIndex: siBuild.problemLines[0] ?? 0,
    extractedLabel: activeFieldLabel,
    extractedValue: siValue,
  };

  const blEvidence: DocumentEvidence = {
    ...reviewCase.bl,
    snippet: blBuild.lines,
    fullLines: blBuild.lines,
    problemLines: blBuild.problemLines,
    highlightIndex: blBuild.problemLines[0] ?? 0,
    extractedLabel: activeFieldLabel,
    extractedValue: aiValue,
  };

  const existingReview = comparison?.humanReview;

  return (
    <div className="flex flex-col gap-5">
      <BackBar
        reviewCase={reviewCase}
        onBack={onBack}
        elapsedSeconds={elapsedSeconds}
        unresolvedCount={unresolvedCount}
        resolvedCount={resolvedCount}
      />

      {/* 7-Field Discrepancy Navigator */}
      <section className="glass glass-sheen p-5 sm:p-6" aria-label="Seven Fields Verification Navigator">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
                All 7 Verified Shipping Fields
              </h2>
              <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface/80 p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const currentIndex = fields.findIndex((f) => f.field === selectedField);
                    if (currentIndex !== -1) {
                      const prev = fields[(currentIndex - 1 + fields.length) % fields.length];
                      if (prev) setSelectedField(prev.field);
                    }
                  }}
                  title="Previous field (←)"
                  aria-label="Previous field"
                  className="rounded-md p-1 text-ink-600 transition hover:bg-surface hover:text-ink-900 active:scale-95"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currentIndex = fields.findIndex((f) => f.field === selectedField);
                    if (currentIndex !== -1) {
                      const next = fields[(currentIndex + 1) % fields.length];
                      if (next) setSelectedField(next.field);
                    }
                  }}
                  title="Next field (→)"
                  aria-label="Next field"
                  className="rounded-md p-1 text-ink-600 transition hover:bg-surface hover:text-ink-900 active:scale-95"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
            <p className="mt-1 text-[12.5px] text-ink-500">
              Navigate fields to inspect evidence and resolve discrepancies. Use <kbd className="rounded border border-line bg-surface/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-700">←</kbd> <kbd className="rounded border border-line bg-surface/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-700">→</kbd> to cycle fields.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-3 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-line">
              <span className="size-2 rounded-full bg-brand-500" />
              {resolvedCount} / 7 verified
            </span>
            {mismatchCount > 0 && (
              <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-review-50 px-2.5 py-1 text-[11.5px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                {mismatchCount} {mismatchCount === 1 ? "mismatch" : "mismatches"}
              </span>
            )}
            {missingCount > 0 && (
              <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-failed-50 px-2.5 py-1 text-[11.5px] font-medium text-failed-700 ring-1 ring-inset ring-failed-200">
                {missingCount} missing
              </span>
            )}
            {uncertainCount > 0 && (
              <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                {uncertainCount} low conf
              </span>
            )}
            {unresolvedCount > 0 ? (
              <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-review-50 px-3 py-1 text-[12px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                <AlertCircle className="size-3.5" strokeWidth={2.25} />
                {unresolvedCount} unresolved
              </span>
            ) : (
              <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-matched-50 px-3 py-1 text-[12px] font-medium text-matched-700 ring-1 ring-inset ring-matched-200">
                <Check className="size-3.5" strokeWidth={2.25} />
                All fields resolved
              </span>
            )}
          </div>
        </div>

        {/* Navigator field cards */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" role="tablist" aria-label="Shipping fields list">
          {fields.map((field) => {
            const isSelected = selectedField === field.field;
            const isResolved = field.resolved || Boolean(field.humanReview?.resolved);
            const review = field.humanReview;

            return (
              <button
                key={field.field}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedField(field.field)}
                className={cn(
                  "flex flex-col items-start rounded-xl border p-3 text-left transition-all",
                  isSelected
                    ? "border-brand-500 bg-brand-50/70 shadow-glass ring-2 ring-brand-500/20"
                    : isResolved
                      ? "border-matched-200 bg-matched-50/40 hover:bg-matched-50/70"
                      : field.discrepancyType === "mismatch"
                        ? "border-review-300 bg-review-50/40 hover:bg-review-50/70"
                        : field.discrepancyType === "missing"
                          ? "border-failed-200 bg-failed-50/40 hover:bg-failed-50/70"
                          : "border-line bg-surface/60 hover:bg-surface",
                )}
              >
                <div className="flex w-full items-start justify-between gap-1.5">
                  <span className="truncate text-[12.5px] font-semibold text-ink-900">
                    {field.label}
                  </span>
                  {isResolved ? (
                    <span className="inline-flex shrink-0 items-center rounded-md bg-matched-100/80 px-1.5 py-0.5 text-[10px] font-semibold text-matched-800">
                      ✓ Resolved
                    </span>
                  ) : field.discrepancyType === "mismatch" ? (
                    <span className="inline-flex shrink-0 items-center rounded-md bg-review-100 px-1.5 py-0.5 text-[10px] font-semibold text-review-800">
                      Mismatch
                    </span>
                  ) : field.discrepancyType === "missing" ? (
                    <span className="inline-flex shrink-0 items-center rounded-md bg-failed-100 px-1.5 py-0.5 text-[10px] font-semibold text-failed-800">
                      Missing
                    </span>
                  ) : field.discrepancyType === "uncertain" ? (
                    <span className="inline-flex shrink-0 items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      Low conf
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-400">
                      Match
                    </span>
                  )}
                </div>

                <p className="mt-2 line-clamp-1 text-[11px] text-ink-500">
                  <span className="text-ink-400">SI:</span> {field.si || "—"}
                </p>
                <p className="line-clamp-1 text-[11px] text-ink-700">
                  <span className="text-ink-400">BL:</span> {review?.value ? review.value : field.bl || "—"}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Active Field Reason & Confidence Banner */}
      <section className="glass glass-sheen border-review-200/80 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-review-50 text-review-700 ring-1 ring-inset ring-review-200">
            <TriangleAlert className="size-5" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-brand-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-800">
                Field: {activeFieldLabel}
              </span>
              {comparison?.discrepancyType === "mismatch" && (
                <span className="rounded bg-review-100 px-2 py-0.5 text-[11px] font-semibold text-review-800">
                  SI value differs from BL extraction
                </span>
              )}
              {comparison?.discrepancyType === "missing" && (
                <span className="rounded bg-failed-100 px-2 py-0.5 text-[11px] font-semibold text-failed-800">
                  Missing value in one or both documents
                </span>
              )}
              {comparison?.discrepancyType === "uncertain" && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  Confidence below {Math.round(VERIFICATION_THRESHOLD * 100)}% verification threshold
                </span>
              )}
            </div>

            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">
              {reviewCase.reasonDetail}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="tabular inline-flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-line">
                Extraction confidence
                <span className="font-semibold text-review-700">{confidencePct}%</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-line">
                Reason code
                <span className="font-semibold">
                  {REVIEW_REASON_LABELS[reviewCase.reasonCode]}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-review-50/80 px-3 py-1 text-[12px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                <ShieldQuestion className="size-3.5" strokeWidth={2.25} />
                Unverified machine result — requires reviewer confirmation
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Source documents comparison */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Source documents — {activeFieldLabel}</p>
          <button
            type="button"
            onClick={() => setDualPreview(true)}
            className="btn-glass px-3 py-1.5 text-[12px]"
          >
            <Columns2 className="size-3.5" strokeWidth={2} />
            Compare Side by Side (Original & Text)
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <EvidencePanel
            title="Shipping Instruction"
            role="SI"
            evidence={siEvidence}
            problemField={activeFieldLabel}
            tone="neutral"
            onOpenModal={() => setDualPreview(true)}
          />
          <EvidencePanel
            title="Bill of Lading"
            role="BL"
            evidence={blEvidence}
            problemField={activeFieldLabel}
            tone="problem"
            onOpenModal={() => setDualPreview(true)}
          />
        </div>

        {/* Centered two-pane document comparison modal workspace */}
        <DocumentComparison
          si={siEvidence}
          bl={blEvidence}
          problemField={activeFieldLabel}
          open={dualPreview}
          onClose={() => setDualPreview(false)}
          heading={`Document comparison · ${reviewCase.shipment} · ${activeFieldLabel}`}
        />
      </section>


      {/* Structured Decision & Audit Trail Card */}
      <section className="glass glass-sheen p-6">
        {existingReview && !isEditingDecision ? (
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-matched-100 text-matched-700">
                  <CheckCircle2 className="size-4.5" strokeWidth={2.25} />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold text-matched-800">
                    Human Review Recorded: {decisionLabel(existingReview.decision)}
                  </h3>
                  <p className="mt-0.5 text-[12px] text-ink-500">
                    Saved by <span className="font-semibold text-ink-800">{existingReview.reviewer}</span> at {existingReview.at}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditingDecision(true);
                  setDecisionType(existingReview.decision);
                  setCorrectedValue(existingReview.value || "");
                  setNotes(existingReview.note || "");
                }}
                className="btn-glass text-[12px]"
              >
                <Pencil className="size-3.5" strokeWidth={2} />
                Edit decision
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface/60 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                  Original SI
                </p>
                <p className="mt-1 text-[13px] font-medium text-ink-800">
                  {existingReview.originalSi || "—"}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface/60 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                  Original BL
                </p>
                <p className="mt-1 text-[13px] font-medium text-ink-800">
                  {existingReview.originalBl || "—"}
                </p>
              </div>
              <div className="rounded-xl border border-matched-200 bg-matched-50/60 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-matched-700">
                  Confirmed result
                </p>
                <p className="mt-1 text-[13.5px] font-bold text-ink-900">
                  {existingReview.value ?? "Marked unreadable"}
                </p>
              </div>
            </div>

            {existingReview.note && (
              <p className="mt-3 rounded-xl border border-line bg-surface/50 p-3 text-[12.5px] leading-relaxed text-ink-700">
                <span className="font-semibold">Review note: </span>
                {existingReview.note}
              </p>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">
                  Record Structured Decision for {activeFieldLabel}
                </h3>
                <p className="mt-1 text-[13px] text-ink-500">
                  Your decision is saved into the case audit history alongside reviewer email and timestamp.
                </p>
              </div>
              {existingReview && isEditingDecision && (
                <button
                  type="button"
                  onClick={() => setIsEditingDecision(false)}
                  className="btn-glass text-[12px]"
                >
                  Cancel editing
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              <DecisionOption
                id="confirm"
                active={decisionType === "confirm"}
                onSelect={() => setDecisionType("confirm")}
                icon={CheckCircle2}
                title="Approve / confirm value"
                description={
                  aiValue
                    ? `The extracted information is correct — record “${aiValue}” as the true value.`
                    : `Confirm SI value “${siValue ?? "—"}” as the verified value.`
                }
              />

              <DecisionOption
                id="correct"
                active={decisionType === "correct"}
                onSelect={() => setDecisionType("correct")}
                icon={Pencil}
                title="Supply corrected value"
                description="Input the accurate value found in the original source document. Preserves the original extraction in audit history."
              >
                <input
                  type="text"
                  value={correctedValue}
                  onChange={(event) => setCorrectedValue(event.target.value)}
                  onFocus={() => setDecisionType("correct")}
                  placeholder={`Enter correct ${activeFieldLabel}...`}
                  className="field-glass mt-3 px-3 py-2.5"
                />
              </DecisionOption>

              <DecisionOption
                id="unreadable"
                active={decisionType === "unreadable"}
                onSelect={() => setDecisionType("unreadable")}
                icon={ScanLine}
                title="Mark field unreadable"
                description="Keep this field unresolved because the source cannot be interpreted reliably. Remains visible for supervisor escalation."
              />
            </div>

            <label className="mt-5 block">
              <span className="eyebrow">Review notes (optional)</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Add audit notes or discrepancy reason..."
                className="field-glass mt-2 resize-y px-3 py-2.5 leading-relaxed"
              />
            </label>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-[12px] text-ink-400">
                {canSubmit
                  ? "Click below to save this field's structured decision."
                  : decisionType === "correct"
                    ? "Enter the corrected value to save."
                    : "Select one of the three options to continue."}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submit}
                  className={cn("btn-primary", !canSubmit && "cursor-not-allowed opacity-45")}
                >
                  Save field decision
                  <ArrowRight className="size-4" strokeWidth={2.25} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Case Actions Bar */}
        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12.5px] text-ink-600">
              {unresolvedCount === 0 ? (
                <span className="font-semibold text-matched-700">
                  ✓ All 7 fields checked and resolved ({resolvedCount} decisions recorded).
                </span>
              ) : (
                <span className="text-review-700 font-medium">
                  {unresolvedCount} field(s) remain unresolved before verification can be approved.
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onPrepare && (
                <button
                  type="button"
                  className="btn-glass inline-flex items-center gap-2"
                  disabled={preparingDraft}
                  onClick={onPrepare}
                  title="Prepare an AI correction draft for counterparty clarification"
                >
                  {preparingDraft ? (
                    <RefreshCw className="size-4 animate-spin text-brand-500" />
                  ) : (
                    <Sparkles className="size-4 text-brand-500" />
                  )}
                  {preparingDraft ? "Preparing AI draft..." : "Prepare AI correction draft"}
                </button>
              )}
              {onFinalize && (
                <button
                  type="button"
                  disabled={!canFinalize}
                  onClick={onFinalize}
                  className={cn(
                    "btn-primary",
                    !canFinalize && "cursor-not-allowed opacity-45",
                  )}
                  title={canFinalize ? "Approve case verification" : "Resolve all 7 fields before approving"}
                >
                  <CheckCircle2 className="size-4" strokeWidth={2.25} />
                  Finalize verification
                </button>
              )}
            </div>
          </div>
          {unresolvedCount > 0 && (
            <p className="text-[11.5px] text-ink-400">
              Note: Verification approval is blocked while fields remain unresolved. Use &quot;Prepare AI correction draft&quot; to request clarification from the shipper or carrier.
            </p>
          )}
        </div>
      </section>

      {/* AI Correction Draft Section (if prepared) */}
      {caseDetail?.draft && (
        <section ref={draftSectionRef} className="glass glass-sheen p-6 scroll-mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="eyebrow">AI correction draft</p>
                {caseDetail.draft.delivery_mode === "live" || caseDetail.draft.has_live_gmail ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                    Live Gmail Synced
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20">
                    Gmail Compose Window
                  </span>
                )}
                {caseDetail.draft.origin === "ai" ? (
                  <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20">
                    AI Generated
                  </span>
                ) : caseDetail.draft.origin === "template" ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-medium text-ink-500 ring-1 ring-inset ring-line">
                    Standard Template
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-[12.5px] text-ink-500">
                {caseDetail.draft.delivery_mode === "live" || caseDetail.draft.has_live_gmail
                  ? "Review the generated correction draft and attached documents synced with your shared Gmail mailbox."
                  : "Draft prepared for your Gmail compose window. Review the content and download attachments to include them."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-surface px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500 ring-1 ring-inset ring-line">
                {caseDetail.draft.state}
              </span>
              {caseDetail.draft.gmail_url && (
                <a
                  href={caseDetail.draft.gmail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-glass inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400"
                >
                  <ExternalLink className="size-3.5" />
                  {caseDetail.draft.delivery_mode === "live" ? "Open saved Gmail draft" : "Open Gmail compose"}
                </a>
              )}
            </div>
          </div>

          {/* Attachments Section */}
          {((caseDetail.draft.attachments && caseDetail.draft.attachments.length > 0) ||
            (caseDetail.documents && caseDetail.documents.length > 0)) && (
            <div className="mt-4 rounded-lg bg-surface/50 p-3.5 ring-1 ring-inset ring-line/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-500">
                  <Paperclip className="size-3.5 text-ink-400" />
                  <span>
                    Attached Documents (
                    {caseDetail.draft.attachments?.length || caseDetail.documents?.length || 0})
                  </span>
                </div>
                {caseDetail.draft.delivery_mode !== "live" && !caseDetail.draft.has_live_gmail && (
                  <span className="text-[11.5px] text-ink-400">
                    Click any file to download and manually attach it in Gmail
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {(caseDetail.draft.attachments && caseDetail.draft.attachments.length > 0
                  ? caseDetail.draft.attachments
                  : caseDetail.documents?.map((d) => d.filename) || []
                ).map((filename, idx) => (
                  <button
                    key={`${filename}-${idx}`}
                    type="button"
                    onClick={() => void handleDownloadAttachment(filename)}
                    title={`Download ${filename}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:text-brand-600 dark:text-ink-300 dark:hover:text-brand-400 ring-1 ring-inset ring-line hover:ring-brand-500 transition-colors"
                  >
                    <Paperclip className="size-3 text-brand-500" />
                    <span>{filename}</span>
                    <Download className="size-3 text-ink-400 hover:text-brand-500 ml-0.5" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3">
            <label>
              <span className="eyebrow">Subject</span>
              <input
                value={draftSubject}
                onChange={(event) => setDraftSubject(event.target.value)}
                disabled={caseDetail.draft.state === "SENT"}
                className="field-glass mt-2 px-3 py-2.5"
              />
            </label>
            <label>
              <span className="eyebrow">Message</span>
              <textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                disabled={caseDetail.draft.state === "SENT"}
                rows={8}
                className="field-glass mt-2 resize-y px-3 py-2.5 leading-relaxed font-mono text-[13px]"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-[12px] text-ink-400">
                {caseDetail.draft.sent_at ? (
                  <span>
                    Sent on {new Date(caseDetail.draft.sent_at).toLocaleString()}
                    {caseDetail.draft.sent_by ? ` by ${caseDetail.draft.sent_by}` : ""}
                  </span>
                ) : caseDetail.draft.prepared_at ? (
                  <span>Prepared on {new Date(caseDetail.draft.prepared_at).toLocaleString()}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-glass inline-flex items-center gap-1.5"
                  disabled={caseDetail.draft.state === "SENT"}
                  onClick={() => onSaveDraft(draftSubject, draftBody)}
                >
                  <Save className="size-4" />
                  Save draft
                </button>
                {caseDetail.draft.delivery_mode === "live" || caseDetail.draft.has_live_gmail ? (
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center gap-1.5"
                    disabled={caseDetail.draft.state === "SENT"}
                    onClick={onSendDraft}
                  >
                    <Send className="size-4" />
                    {caseDetail.draft.state === "SENT" ? "Sent" : "Send correction"}
                  </button>
                ) : (
                  <>
                    {caseDetail.draft.gmail_url && (
                      <a
                        href={caseDetail.draft.gmail_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-glass inline-flex items-center gap-1.5 px-3 py-2"
                      >
                        <ExternalLink className="size-4" />
                        Open Gmail compose
                      </a>
                    )}
                    {onConfirmSentDraft && (
                      <button
                        type="button"
                        className="btn-primary inline-flex items-center gap-1.5"
                        disabled={caseDetail.draft.state === "SENT" || confirmingSent}
                        onClick={onConfirmSentDraft}
                      >
                        {confirmingSent ? (
                          <RefreshCw className="size-4 animate-spin" />
                        ) : (
                          <CheckCheck className="size-4" />
                        )}
                        {caseDetail.draft.state === "SENT" ? "Confirmed sent" : "Confirm sent from Gmail"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <WorkflowStrip currentIndex={5} />
    </div>
  );
}

function BackBar({
  reviewCase,
  onBack,
  elapsedSeconds,
  unresolvedCount,
  resolvedCount,
}: {
  reviewCase: ReviewCase;
  onBack: () => void;
  elapsedSeconds: number;
  unresolvedCount: number;
  resolvedCount: number;
}) {
  const status = REVIEW_STATUS_META[reviewCase.status];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn-glass">
          <ArrowLeft className="size-4" strokeWidth={2.25} />
          Review Queue
        </button>
        <div>
          <p className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-ink-400">{reviewCase.caseId}</span>
            <span className="text-[16px] font-semibold tracking-tight text-ink-900">
              {reviewCase.shipment}
            </span>
          </p>
          <p className="mt-0.5 text-[12px] text-ink-400">
            Created {reviewCase.created} · {resolvedCount}/7 fields verified · {unresolvedCount} unresolved
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-line">
          <Clock className="size-3.5 text-ink-400" />
          Review time: {formatDuration(elapsedSeconds)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium",
            status.chip,
          )}
        >
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>
    </div>
  );
}

function EvidencePanel({
  title,
  role,
  evidence,
  problemField,
  tone,
  onOpenModal,
}: {
  title: string;
  role: "SI" | "BL";
  evidence: DocumentEvidence;
  problemField: string;
  tone: "neutral" | "problem";
  onOpenModal: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const problem = tone === "problem" && evidence.extractedValue === null;

  const fullLines = evidence.fullLines?.length ? evidence.fullLines : evidence.snippet;
  const displayLines = expanded ? fullLines : evidence.snippet;
  const hasMore = fullLines.length > evidence.snippet.length;
  const problemSet = new Set(evidence.problemLines ?? []);

  if (!expanded && evidence.highlightIndex >= 0) {
    problemSet.add(evidence.highlightIndex);
  }

  return (
    <article
      className={cn("glass glass-sheen flex flex-col p-5", problem && "border-review-200/80")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white",
                problem
                  ? "bg-gradient-to-b from-review-500 to-review-700"
                  : "bg-gradient-to-b from-brand-500 to-brand-700",
              )}
            >
              {role}
            </span>
            <span className="text-[14px] font-semibold tracking-tight text-ink-900">{title}</span>
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-500">
            <FileText className="size-3.5 text-ink-400" strokeWidth={2} />
            {evidence.name} · {evidence.pages} page{evidence.pages === 1 ? "" : "s"}
            {evidence.scanned && (
              <span className="inline-flex items-center gap-1 rounded bg-review-50 px-1.5 py-0.5 text-[10.5px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                <ScanLine className="size-3" strokeWidth={2.25} />
                Scanned
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenModal}
          className="btn-glass shrink-0 px-2.5 py-1.5 text-[12px]"
          title="Open centered side-by-side comparison modal"
        >
          Open Document
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      <pre
        className={cn(
          "mt-4 overflow-x-auto rounded-xl border border-line bg-surface/70 p-3 font-mono text-[11.5px] leading-relaxed text-ink-700",
          expanded && "max-h-[400px] overflow-y-auto",
        )}
      >
        {displayLines.map((line, index) => {
          const highlighted = expanded
            ? problemSet.has(index)
            : index === evidence.highlightIndex;
          return (
            <span
              key={index}
              className={cn(
                "block rounded px-1",
                highlighted &&
                  (problem
                    ? "bg-review-50 font-semibold text-review-700 ring-1 ring-inset ring-review-200"
                    : "bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"),
              )}
            >
              {line || " "}
            </span>
          );
        })}
      </pre>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-brand-600 transition-colors hover:bg-brand-50"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" strokeWidth={2} />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" strokeWidth={2} />
              Show full document ({fullLines.length} lines)
            </>
          )}
        </button>
      )}

      <p className="mt-auto pt-4 text-[12.5px]">
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
    </article>
  );
}

function DecisionOption({
  id,
  active,
  onSelect,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  icon: typeof CheckCircle2;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all",
        active ? "border-brand-300 bg-brand-50/60 shadow-glass" : "border-line bg-surface/55",
      )}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="review-decision"
          value={id}
          checked={active}
          onChange={onSelect}
          className="mt-1 size-4 shrink-0 accent-brand-600"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-900">
            <Icon
              className={cn("size-4", active ? "text-brand-600" : "text-ink-400")}
              strokeWidth={2.25}
            />
            {title}
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-500">
            {description}
          </span>
        </span>
      </label>
      {children}
    </div>
  );
}


function WorkflowStrip({ currentIndex }: { currentIndex: number }) {
  return (
    <section className="glass p-4">
      <p className="eyebrow">Human review flow</p>
      <ol className="mt-3 flex flex-wrap items-center gap-1.5">
        {WORKFLOW_STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-lg px-2 py-1.5 text-[11px] font-medium ring-1 ring-inset",
                index < currentIndex && "bg-brand-50 text-brand-700 ring-brand-200",
                index === currentIndex &&
                  "bg-gradient-to-b from-brand-500 to-brand-700 text-white ring-brand-700/40",
                index > currentIndex && "bg-surface/70 text-ink-400 ring-line",
              )}
            >
              {step}
            </span>
            {index < WORKFLOW_STEPS.length - 1 && (
              <ArrowRight className="size-3 shrink-0 text-ink-300" strokeWidth={2.5} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function decisionLabel(type: DecisionType): string {
  if (type === "confirm") return "Confirmed";
  if (type === "correct") return "Corrected";
  return "Marked unreadable";
}
