"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  Pencil,
  ScanLine,
  ShieldQuestion,
  TriangleAlert,
  Send,
  Save,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth/auth-provider";
import type { CaseDetail } from "@/lib/api";
import { DocumentPreview, type PreviewDocument } from "@/components/ui/document-preview";
import {
  REVIEW_REASON_LABELS,
  REVIEW_STATUS_META,
  VERIFICATION_THRESHOLD,
  type DocumentEvidence,
  type ReviewCase,
  type ReviewDecision,
} from "@/lib/review-data";

type DecisionType = ReviewDecision["type"];

const WORKFLOW_STEPS = [
  "Incoming email",
  "AI classification",
  "SI + BL extraction",
  "Validation",
  "Uncertain result",
  "Human review",
  "Human confirms / corrects",
  "Final verification result",
  "Case resolved",
];

/**
 * Focused review screen for one uncertain field.
 *
 * The AI result is presented as a proposal, never as a verified value, and the
 * original extraction is preserved next to the human decision for audit.
 */
export function ReviewDetail({
  reviewCase,
  caseDetail,
  onSubmit,
  onBack,
  onSaveDraft,
  onSendDraft,
}: {
  reviewCase: ReviewCase;
  caseDetail: CaseDetail | null;
  onSubmit: (decision: ReviewDecision) => void;
  onBack: () => void;
  onSaveDraft: (subject: string, body: string) => void;
  onSendDraft: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [decisionType, setDecisionType] = useState<DecisionType | null>(null);
  const [correctedValue, setCorrectedValue] = useState("");
  const [notes, setNotes] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");

  useEffect(() => {
    setDraftSubject(caseDetail?.draft?.subject || "");
    setDraftBody(caseDetail?.draft?.body || "");
  }, [caseDetail?.draft?.body, caseDetail?.draft?.subject]);

  const aiValue = reviewCase.bl.extractedValue;
  const confidencePct = Math.round(reviewCase.confidence * 100);
  const resolved = reviewCase.decision;

  const canSubmit =
    decisionType !== null && (decisionType !== "correct" || correctedValue.trim().length > 0);

  const submit = () => {
    if (!decisionType) return;

    const value =
      decisionType === "correct"
        ? correctedValue.trim()
        : decisionType === "confirm"
          ? (aiValue ?? reviewCase.si.extractedValue)
          : null;

    onSubmit({
      type: decisionType,
      value,
      notes: notes.trim(),
      reviewer: user?.displayName || user?.email || "Reviewer",
      at: formatStamp(new Date()),
    });
  };

  if (resolved) {
    return (
      <div className="flex flex-col gap-5">
        <BackBar reviewCase={reviewCase} onBack={onBack} />

        <section className="glass glass-sheen overflow-hidden">
          <div className="flex items-start gap-3 border-b border-line bg-matched-50/60 px-6 py-5">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-matched-700" strokeWidth={2.25} />
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight text-matched-700">
                Review Completed
              </h2>
              <p className="mt-1 text-[13px] text-ink-500">
                {reviewCase.problemField} on {reviewCase.shipment} was decided by a person. The case
                is now resolved.
              </p>
            </div>
          </div>

          <dl className="grid gap-x-8 gap-y-4 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Field" value={reviewCase.problemField} />
            <Fact label="SI" value={reviewCase.si.extractedValue ?? "—"} />
            <Fact
              label="BL"
              value={resolved.value ?? "Marked unreadable"}
              tone={resolved.value ? "good" : "warn"}
            />
            <Fact
              label="Decision"
              value={`${decisionLabel(resolved.type)} by ${resolved.reviewer}`}
            />
          </dl>

          <div className="border-t border-line px-6 py-5">
            <p className="eyebrow">Audit trail</p>
            <p className="mt-1.5 text-[12.5px] text-ink-500">
              The original machine extraction is kept alongside the human decision — nothing is
              overwritten silently.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                  AI result
                </p>
                <p className="mt-2 text-[13.5px] font-medium text-ink-700">
                  {aiValue ? `${aiValue}?` : "Could not be determined"}
                </p>
                <p className="tabular mt-1.5 text-[12px] text-ink-400">
                  Confidence {confidencePct}% · below the {Math.round(VERIFICATION_THRESHOLD * 100)}%
                  threshold
                </p>
              </div>
              <div className="rounded-xl border border-matched-200 bg-matched-50/50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-matched-700">
                  Human confirmed result
                </p>
                <p className="mt-2 text-[13.5px] font-semibold text-ink-900">
                  {resolved.value ?? "Document marked unreadable"}
                </p>
                <p className="mt-1.5 text-[12px] text-ink-500">
                  Reviewed by {resolved.reviewer} · {resolved.at}
                </p>
              </div>
            </div>

            {resolved.notes && (
              <p className="mt-3 rounded-xl border border-line bg-surface/50 p-3 text-[12.5px] leading-relaxed text-ink-700">
                <span className="font-semibold">Review notes: </span>
                {resolved.notes}
              </p>
            )}
          </div>

          {resolved.type !== "confirm" && (
            <div className="border-t border-line px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Gmail correction draft</p>
                  <p className="mt-1.5 text-[12.5px] text-ink-500">
                    Review the generated message before sending it to the original sender.
                  </p>
                </div>
                {caseDetail?.draft && (
                  <span className="rounded-full bg-surface px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500 ring-1 ring-inset ring-line">
                    {caseDetail.draft.state}
                  </span>
                )}
              </div>

              {caseDetail?.draft ? (
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
                      className="field-glass mt-2 resize-y px-3 py-2.5 leading-relaxed"
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="btn-glass"
                      disabled={caseDetail.draft.state === "SENT"}
                      onClick={() => onSaveDraft(draftSubject, draftBody)}
                    >
                      <Save className="size-4" />
                      Save draft
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={caseDetail.draft.state === "SENT"}
                      onClick={onSendDraft}
                    >
                      <Send className="size-4" />
                      {caseDetail.draft.state === "SENT" ? "Sent" : "Send correction"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-line bg-surface/60 p-4 text-[12.5px] text-ink-500">
                  The correction draft is being prepared. Refresh the case if it does not appear shortly.
                </p>
              )}
            </div>
          )}

          <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface/50 px-6 py-4">
            <span className="text-[12px] text-ink-400">
              Status: {REVIEW_STATUS_META.resolved.label}
            </span>
            <button type="button" className="btn-primary" onClick={onBack}>
              <ArrowLeft className="size-4" strokeWidth={2.25} />
              Return to Review Queue
            </button>
          </footer>
        </section>

        <WorkflowStrip currentIndex={WORKFLOW_STEPS.length - 1} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <BackBar reviewCase={reviewCase} onBack={onBack} />

      <section className="glass glass-sheen border-review-200/80 p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-review-50 text-review-700 ring-1 ring-inset ring-review-200">
            <TriangleAlert className="size-5" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-ink-900">
              Why does this case need review?
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">
              {reviewCase.reasonDetail}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="tabular inline-flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-line">
                Confidence
                <span className="font-semibold text-review-700">{confidencePct}%</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-line">
                Reason
                <span className="font-semibold">
                  {REVIEW_REASON_LABELS[reviewCase.reasonCode]}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-review-50/80 px-3 py-1 text-[12px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
                <ShieldQuestion className="size-3.5" strokeWidth={2.25} />
                Unverified machine result — do not treat as confirmed
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <p className="eyebrow">Source documents</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <EvidencePanel
            title="Shipping Instruction"
            role="SI"
            evidence={reviewCase.si}
            problemField={reviewCase.problemField}
            tone="neutral"
          />
          <EvidencePanel
            title="Bill of Lading"
            role="BL"
            evidence={reviewCase.bl}
            problemField={reviewCase.problemField}
            tone="problem"
          />
        </div>
      </section>

      <section className="glass glass-sheen p-6">
        <p className="eyebrow">AI extraction</p>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          <Fact label="Field" value={reviewCase.problemField} />
          <Fact label="SI" value={reviewCase.si.extractedValue ?? "—"} />
          <Fact label="BL" value={aiValue ?? "Unknown"} tone={aiValue ? "neutral" : "warn"} />
          <Fact label="AI confidence" value={`${confidencePct}%`} tone="warn" />
          <Fact label="Status" value="Needs Human Confirmation" tone="warn" />
        </dl>
        <p className="mt-4 rounded-xl border border-line bg-surface/55 p-3 text-[12.5px] leading-relaxed text-ink-500">
          The system did not automatically resolve this field because confidence was below the{" "}
          {Math.round(VERIFICATION_THRESHOLD * 100)}% verification threshold.
        </p>
      </section>

      <section className="glass glass-sheen p-6">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">Your Decision</h3>
        <p className="mt-1 text-[13px] text-ink-500">
          Pick one option. Your choice is recorded against the case with your name and the time.
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          <DecisionOption
            id="confirm"
            active={decisionType === "confirm"}
            onSelect={() => setDecisionType("confirm")}
            icon={CheckCircle2}
            title="Approve result"
            description={
              aiValue
                ? `The extracted information is correct — record “${aiValue}” as the B/L value.`
                : `The extracted information is correct — record the SI value “${reviewCase.si.extractedValue}” as also applying to the B/L.`
            }
          />

          <DecisionOption
            id="correct"
            active={decisionType === "correct"}
            onSelect={() => setDecisionType("correct")}
            icon={Pencil}
            title="Decline and propose correction"
            description="Decline the current result and record the value that should appear in the correction draft."
          >
            <input
              type="text"
              value={correctedValue}
              onChange={(event) => setCorrectedValue(event.target.value)}
              onFocus={() => setDecisionType("correct")}
              placeholder="Enter correct BL value..."
              className="field-glass mt-3 px-3 py-2.5"
            />
          </DecisionOption>

          <DecisionOption
            id="unreadable"
            active={decisionType === "unreadable"}
            onSelect={() => setDecisionType("unreadable")}
            icon={ScanLine}
            title="Decline as unreadable"
            description="Decline the current result because the source cannot be interpreted. A correction draft will be prepared."
          />
        </div>

        <label className="mt-5 block">
          <span className="eyebrow">Review notes (optional)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Review notes..."
            className="field-glass mt-2 resize-y px-3 py-2.5 leading-relaxed"
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[12px] text-ink-400">
            {canSubmit
              ? "Your decision will be saved with an audit entry."
              : decisionType === "correct"
                ? "Enter the correct B/L value to continue."
                : "Choose one of the three options to continue."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-glass"
              onClick={() => {
                toast({ title: "Review cancelled", description: "No decision was recorded.", tone: "info" });
                onBack();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className={cn("btn-primary", !canSubmit && "cursor-not-allowed opacity-45")}
            >
              {decisionType === "confirm" ? "Approve" : "Decline"}
              <ArrowRight className="size-4" strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </section>

      <WorkflowStrip currentIndex={5} />
    </div>
  );
}

function BackBar({ reviewCase, onBack }: { reviewCase: ReviewCase; onBack: () => void }) {
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
            {reviewCase.problemField} · created {reviewCase.created}
          </p>
        </div>
      </div>
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
  );
}

function EvidencePanel({
  title,
  role,
  evidence,
  problemField,
  tone,
}: {
  title: string;
  role: "SI" | "BL";
  evidence: DocumentEvidence;
  problemField: string;
  tone: "neutral" | "problem";
}) {
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const problem = tone === "problem" && evidence.extractedValue === null;

  return (
    <article
      className={cn("glass glass-sheen flex flex-col p-5", problem && "border-review-200/80")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2">
            <span className="rounded bg-gradient-to-b from-brand-500 to-brand-700 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white">
              {role}
            </span>
            <span className="text-[14px] font-semibold tracking-tight text-ink-900">{title}</span>
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-500">
            <FileText className="size-3.5 text-ink-400" strokeWidth={2} />
            {evidence.name} · {evidence.pages} pages
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
          onClick={() =>
            setPreview({
              name: evidence.name,
              role,
              pages: evidence.pages,
              scanned: evidence.scanned,
              lines: evidence.snippet,
              problemLines: problem ? [evidence.highlightIndex] : [],
            })
          }
          className="btn-glass shrink-0 px-2.5 py-1.5 text-[12px]"
        >
          Open Document
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface/70 p-3 font-mono text-[11.5px] leading-relaxed text-ink-700">
        {evidence.snippet.map((line, index) => (
          <span
            key={index}
            className={cn(
              "block rounded px-1",
              index === evidence.highlightIndex &&
                (problem
                  ? "bg-review-50 font-semibold text-review-700 ring-1 ring-inset ring-review-200"
                  : "bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"),
            )}
          >
            {line}
          </span>
        ))}
      </pre>

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

      <DocumentPreview document={preview} onClose={() => setPreview(null)} />
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

function Fact({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">{label}</dt>
      <dd
        className={cn(
          "mt-1.5 text-[13.5px] font-semibold",
          tone === "neutral" && "text-ink-900",
          tone === "good" && "text-matched-700",
          tone === "warn" && "text-review-700",
        )}
      >
        {value}
      </dd>
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
