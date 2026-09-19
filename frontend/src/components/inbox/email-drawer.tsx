"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ExternalLink,
  FileText,
  Mail,
  Paperclip,
  ScanLine,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { DocumentPreview, type PreviewDocument } from "@/components/ui/document-preview";
import { documentBodyForCase, pendingDocumentBody } from "@/lib/document-text";
import { ClassificationBadge, EmailStatusBadge } from "./badges";
import {
  CLASSIFICATION_META,
  type InboxEmail,
  type MailAttachment,
} from "@/lib/inbox-data";

/**
 * Email detail view.
 *
 * Shows the raw email plus what the classification agent concluded. Only
 * document-comparison emails expose the verification hand-off; the SI vs BL
 * field comparison itself lives on the Verification Case page.
 */
export function EmailDrawer({
  email,
  onClose,
}: {
  email: InboxEmail | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewDocument | null>(null);

  useEffect(() => {
    if (!email) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [email, onClose]);

  /** Opens the attachment's extracted text; SI/BL render from the linked case. */
  const openAttachment = useCallback(
    (file: MailAttachment) => {
      if (!email) return;

      const body =
        (file.preview ? { lines: file.preview, problemLines: [] } : null) ??
        documentBodyForCase(email.caseRef, file.role) ??
        pendingDocumentBody(file.name, email.sender);

      setPreview({
        name: file.name,
        role: file.role,
        pages: file.pages,
        sizeLabel: file.sizeLabel,
        scanned: file.scanned,
        lines: body.lines,
        problemLines: body.problemLines,
      });
    },
    [email],
  );

  /** `?email=<id>&doc=SI` opens straight into a document, for sharing a link. */
  useEffect(() => {
    if (!email) return;
    const requested = new URLSearchParams(window.location.search).get("doc");
    if (!requested) return;
    const file = email.attachments.find(
      (attachment) => attachment.role.toLowerCase() === requested.toLowerCase(),
    );
    if (file) openAttachment(file);
  }, [email, openAttachment]);

  if (!email) return null;

  const meta = CLASSIFICATION_META[email.classification];
  const si = email.attachments.find((file) => file.role === "SI");
  const bl = email.attachments.find((file) => file.role === "BL");

  /** Hands off to the verification workflow and opens the case's comparison report. */
  const openVerificationCase = () => {
    toast({
      title: email.caseRef
        ? `Opening verification case #${email.caseRef}`
        : "Opening verification cases",
      description: email.shipment
        ? `${email.shipment} — SI vs BL comparison of the 7 required fields.`
        : "SI vs BL comparison of the 7 required fields.",
      tone: "info",
    });
    onClose();
    router.push(email.caseRef ? `/cases?case=${email.caseRef}` : "/cases");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close email detail"
        onClick={onClose}
        className="absolute inset-0 animate-[fade-in_0.2s_ease-out] bg-overlay backdrop-blur-sm"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Email: ${email.subject}`}
        className="relative flex h-full w-full max-w-[620px] animate-[drawer-in_0.28s_cubic-bezier(0.22,1,0.36,1)] flex-col border-l border-edge bg-surface/95 shadow-glass-lg backdrop-blur-2xl backdrop-saturate-150"
      >
        <header className="flex items-start gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ClassificationBadge classification={email.classification} />
              <EmailStatusBadge status={email.status} />
            </div>
            <h2 className="mt-3 text-[18px] font-semibold leading-snug tracking-tight text-ink-900">
              {email.subject}
            </h2>
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
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-edge bg-surface/60 p-4">
            <Meta label="From">
              <span className="block font-medium text-ink-900">{email.sender}</span>
              <span className="block truncate text-[12px] text-ink-400">{email.senderEmail}</span>
            </Meta>
            <Meta label="To">
              <span className="block truncate font-medium text-ink-900">{email.recipient}</span>
            </Meta>
            <Meta label="Received">
              <span className="block font-medium text-ink-900">{email.receivedLabel}</span>
            </Meta>
            <Meta label="Attachments">
              <span className="flex items-center gap-1.5 font-medium text-ink-900">
                <Paperclip className="size-3.5 text-ink-400" strokeWidth={2} />
                {email.attachments.length === 0
                  ? "None"
                  : `${email.attachments.length} file${email.attachments.length === 1 ? "" : "s"}`}
              </span>
            </Meta>
          </dl>

          <section className="mt-5 rounded-xl border border-edge bg-surface/60 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-brand-600" strokeWidth={2.25} />
              <p className="eyebrow">AI classification</p>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[14px] font-semibold text-ink-900">{meta.label}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface ring-1 ring-inset ring-line">
                <span
                  className={cn(
                    "block h-full rounded-full bg-gradient-to-r",
                    email.confidence >= 0.85
                      ? "from-matched-500 to-matched-700"
                      : email.confidence >= 0.7
                        ? "from-brand-400 to-brand-600"
                        : "from-review-500 to-review-700",
                  )}
                  style={{ width: `${Math.round(email.confidence * 100)}%` }}
                />
              </span>
              <span className="tabular text-[12px] font-semibold text-ink-700">
                {Math.round(email.confidence * 100)}% confidence
              </span>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
              {email.classificationNote}
            </p>
          </section>

          {meta.verifiable ? (
            <section className="mt-5 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 via-surface to-brand-50/60 p-4 shadow-glass">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand">
                  <ScanSearch className="size-[18px]" strokeWidth={2.25} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-ink-900">
                    Document verification detected
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                    Shipping Instruction and draft Bill of Lading identified
                    {email.shipment ? ` for ${email.shipment}` : ""}. Ready for field-by-field
                    comparison of the 7 required fields.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <DocumentRow role="SI" file={si} onOpen={openAttachment} />
                <DocumentRow role="BL" file={bl} onOpen={openAttachment} />
              </div>

              <button
                type="button"
                onClick={openVerificationCase}
                className="btn-primary mt-4 w-full justify-center"
              >
                Open Verification Case
                {email.caseRef && (
                  <span className="font-mono text-[12px] font-medium opacity-80">
                    #{email.caseRef}
                  </span>
                )}
                <ArrowRight className="size-4" strokeWidth={2.25} />
              </button>
            </section>
          ) : (
            <section className="mt-5 rounded-xl border border-line bg-surface/50 p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-ink-400 ring-1 ring-inset ring-line">
                  <Mail className="size-[18px]" strokeWidth={2} />
                </span>
                <div>
                  <h3 className="text-[14px] font-semibold text-ink-900">
                    No document verification required
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                    Classified as {meta.label.toLowerCase()} and stored for audit. SI vs BL
                    comparison does not apply to this email.
                  </p>
                </div>
              </div>

              {email.attachments.length > 0 && (
                <ul className="mt-4 flex flex-col gap-2">
                  {email.attachments.map((file) => (
                    <li key={file.name}>
                      <button
                        type="button"
                        onClick={() => openAttachment(file)}
                        className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface/70 px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-surface"
                      >
                        <FileText className="size-4 text-ink-400" strokeWidth={2} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-700">
                          {file.name}
                        </span>
                        <span className="tabular text-[11px] text-ink-400">{file.sizeLabel}</span>
                        <ExternalLink className="size-3.5 shrink-0 text-ink-400" strokeWidth={2} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="mt-6">
            <p className="eyebrow">Message</p>
            <div className="mt-3 flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink-700">
              {email.body.map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>

          <Workflow email={email} />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface/60 px-6 py-4">
          <span className="text-[12px] text-ink-400">
            {meta.verifiable
              ? "Verification workflow available"
              : "Classified — no verification workflow"}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-glass" onClick={onClose}>
              Close
            </button>
            {meta.verifiable && (
              <button type="button" className="btn-primary" onClick={openVerificationCase}>
                Open Verification Case
                <ArrowRight className="size-4" strokeWidth={2.25} />
              </button>
            )}
          </div>
        </footer>
      </section>

      <DocumentPreview document={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">{label}</dt>
      <dd className="mt-1 min-w-0 text-[13px]">{children}</dd>
    </div>
  );
}

function DocumentRow({
  role,
  file,
  onOpen,
}: {
  role: "SI" | "BL";
  file?: MailAttachment;
  onOpen: (file: MailAttachment) => void;
}) {
  const roleLabel = role === "SI" ? "Shipping Instruction" : "Bill of Lading";

  if (!file || file.pages === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-review-200 bg-review-50/60 px-3 py-2">
        <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-review-700 ring-1 ring-inset ring-review-200">
          {role}
        </span>
        <span className="flex-1 text-[12.5px] text-review-700">
          {roleLabel} still being extracted
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="flex w-full items-center gap-3 rounded-lg border border-edge bg-surface/85 px-3 py-2 text-left shadow-glass transition-colors hover:border-brand-200 hover:bg-surface"
    >
      <span className="rounded-md bg-gradient-to-b from-brand-500 to-brand-700 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
        {role}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-ink-900">{file.name}</span>
        <span className="tabular block text-[11px] text-ink-400">
          {roleLabel} · {file.pages} pages · {file.sizeLabel}
        </span>
      </span>
      {file.scanned && (
        <span className="inline-flex items-center gap-1 rounded-md bg-review-50 px-1.5 py-0.5 text-[10.5px] font-medium text-review-700 ring-1 ring-inset ring-review-200">
          <ScanLine className="size-3" strokeWidth={2.25} />
          Scanned
        </span>
      )}
      <ExternalLink className="size-3.5 shrink-0 text-ink-400" strokeWidth={2} />
    </button>
  );
}

/** Where this email sits in the intake workflow. */
function Workflow({ email }: { email: InboxEmail }) {
  const verifiable = CLASSIFICATION_META[email.classification].verifiable;

  const steps = verifiable
    ? [
        { label: "Incoming email", state: "done" as const },
        {
          label: "AI classification",
          state: email.status === "processing" ? ("current" as const) : ("done" as const),
        },
        {
          label: "Verification case",
          state:
            email.status === "completed"
              ? ("done" as const)
              : email.status === "processing"
                ? ("todo" as const)
                : ("current" as const),
        },
        {
          label: "SI + BL comparison",
          state: email.status === "completed" ? ("done" as const) : ("todo" as const),
        },
      ]
    : [
        { label: "Incoming email", state: "done" as const },
        { label: "AI classification", state: "done" as const },
        { label: email.status === "filtered" ? "Filtered" : "Classified", state: "done" as const },
      ];

  return (
    <section className="mt-6 rounded-xl border border-edge bg-surface/55 p-4">
      <p className="eyebrow">Workflow</p>
      <ol className="mt-3 flex items-center gap-1.5">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-center text-[11px] font-medium ring-1 ring-inset",
                step.state === "done" && "bg-brand-50 text-brand-700 ring-brand-200",
                step.state === "current" &&
                  "bg-gradient-to-b from-brand-500 to-brand-700 text-white ring-brand-700/40",
                step.state === "todo" && "bg-surface/70 text-ink-400 ring-line",
              )}
            >
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <ArrowRight className="size-3 shrink-0 text-ink-300" strokeWidth={2.5} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
