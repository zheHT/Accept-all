"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileStack,
  FileText,
  Loader,
  Mail,
  Paperclip,
  Receipt,
  ScanLine,
  ScanSearch,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Steps, Tag } from "antd";
import { useToast } from "@/components/ui/toast";
import { DocumentPreview, type PreviewDocument } from "@/components/ui/document-preview";
import { DocumentComparison } from "@/components/ui/document-comparison";
import { pendingDocumentBody } from "@/lib/document-text";
import { downloadFile } from "@/lib/download-file";
import { EmailStatusBadge } from "./badges";
import {
  CLASSIFICATION_META,
  type InboxEmail,
  type MailAttachment,
} from "@/lib/inbox-data";
import {
  getCase,
  getDocumentContent,
  getDocumentDownload,
  generateSI,
  verifySI,
  approveSI,
  returnSI,
  routeCase,
  draftCategoryResponse,
  completeCategoryCase,
  blockSender,
  markNotSpam,
  type CaseDetail,
} from "@/lib/api";
import { reviewDetail, inboxDetail, bytesLabel } from "@/lib/live-view-models";
import type { DocumentEvidence, ReviewCase } from "@/lib/review-data";

const CLASSIFICATION_TAG_COLORS = {
  document_comparison: "blue",
  new_si: "cyan",
  invoice_query: "purple",
  general: "default",
  spam: "red",
} satisfies Record<InboxEmail["classification"], string>;

/**
 * Email detail view.
 *
 * Shows the raw email plus what the classification agent concluded.
 * Includes interactive category workflows for:
 * - Document Comparison: SI vs BL verification hand-off
 * - New SI Request: SI generation (.txt), verification, approval, return to requester
 * - Invoice Query: Route to Finance, draft response, completion
 * - General: Route to Customer Service, draft response, completion
 * - Spam: Block sender (DB + Gmail filter) or Mark Not Spam
 */
export function EmailDrawer({
  email,
  onClose,
  onEmailUpdated,
}: {
  email: InboxEmail | null;
  onClose: () => void;
  onEmailUpdated?: (email: InboxEmail) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [currentEmail, setCurrentEmail] = useState<InboxEmail | null>(email);
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const [comparisonCase, setComparisonCase] = useState<ReviewCase | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showFieldsPreview, setShowFieldsPreview] = useState(false);
  const [customResponse, setCustomResponse] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");

  useEffect(() => {
    setCurrentEmail(email);
    setCustomResponse("");
    setResolutionNote("");
    setShowFieldsPreview(false);
  }, [email]);

  useEffect(() => {
    if (!currentEmail) return;

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
  }, [currentEmail, onClose]);

  const handleAction = async (
    actionKey: string,
    apiCall: () => Promise<CaseDetail>,
    successTitle: string,
    successDescription: string,
  ) => {
    if (!currentEmail) return;
    setActionLoading(actionKey);
    try {
      const detail = await apiCall();
      const updated = inboxDetail(detail);
      setCurrentEmail(updated);
      onEmailUpdated?.(updated);
      toast({ title: successTitle, description: successDescription, tone: "success" });
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadSI = async (docId: string, filename: string) => {
    if (!currentEmail) return;
    setDownloading(true);
    try {
      const { blob } = await getDocumentContent(currentEmail.id, docId, filename);
      downloadFile(blob, filename);
      toast({ title: "SI Artifact downloaded", description: `${filename} saved.`, tone: "success" });
    } catch (err) {
      try {
        const { url } = await getDocumentDownload(currentEmail.id, docId);
        window.open(url, "_blank");
      } catch {
        toast({
          title: "Download failed",
          description: err instanceof Error ? err.message : "Could not retrieve file.",
          tone: "warning",
        });
      }
    } finally {
      setDownloading(false);
    }
  };

  /** Opens the shared document comparison workspace; SI/BL render from the linked case. */
  const openAttachment = useCallback(
    (file: MailAttachment) => {
      if (!currentEmail) return;
      if (currentEmail.caseRef) {
        void openComparison();
        return;
      }
      const siAtt = currentEmail.attachments.find((a) => a.role === "SI") || file;
      const blAtt = currentEmail.attachments.find((a) => a.role === "BL" && a.name !== siAtt.name);
      const bodySi = (siAtt.preview ? { lines: siAtt.preview, problemLines: [] } : null) ?? pendingDocumentBody(siAtt.name, currentEmail.sender);
      const bodyBl = blAtt ? ((blAtt.preview ? { lines: blAtt.preview, problemLines: [] } : null) ?? pendingDocumentBody(blAtt.name, currentEmail.sender)) : null;

      setComparisonCase({
        id: currentEmail.id,
        caseId: currentEmail.id,
        shipment: currentEmail.shipment || currentEmail.subject || "Email Attachment",
        problemField: "Source documents",
        reason: "Inbox attachment preview",
        reasonCode: "low_confidence",
        reasonDetail: "Email attachment inspection",
        confidence: currentEmail.confidence,
        status: "pending",
        created: currentEmail.receivedTime,
        createdOrder: 0,
        si: {
          name: siAtt.name,
          pages: siAtt.pages,
          scanned: siAtt.scanned,
          snippet: bodySi.lines,
          fullLines: bodySi.lines,
          problemLines: bodySi.problemLines,
          highlightIndex: -1,
          extractedLabel: "Extracted value",
          extractedValue: null,
        },
        bl: (blAtt && bodyBl) ? {
          name: blAtt.name,
          pages: blAtt.pages,
          scanned: blAtt.scanned,
          snippet: bodyBl.lines,
          fullLines: bodyBl.lines,
          problemLines: bodyBl.problemLines,
          highlightIndex: -1,
          extractedLabel: "Extracted value",
          extractedValue: null,
        } : undefined as unknown as DocumentEvidence,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentEmail],
  );

  /** `?email=<id>&doc=SI` opens straight into a document, for sharing a link. */
  useEffect(() => {
    if (!currentEmail) return;
    const requested = new URLSearchParams(window.location.search).get("doc");
    if (!requested) return;
    const file = currentEmail.attachments.find(
      (attachment) => attachment.role.toLowerCase() === requested.toLowerCase(),
    );
    if (file) openAttachment(file);
  }, [currentEmail, openAttachment]);

  if (!currentEmail) return null;

  const currentClassification = currentEmail.classification;
  const currentConfidence = currentEmail.confidence;
  const currentReasoning = currentEmail.classificationNote;
  const meta = CLASSIFICATION_META[currentClassification];
  const ClassificationIcon = meta.icon;
  const si = currentEmail.attachments.find((file) => file.role === "SI");
  const bl = currentEmail.attachments.find((file) => file.role === "BL");

  /** Hands off to the verification workflow and opens the case's comparison report. */
  const openVerificationCase = () => {
    toast({
      title: currentEmail.caseRef
        ? `Opening verification case #${currentEmail.caseRef}`
        : "Opening verification cases",
      description: currentEmail.shipment
        ? `${currentEmail.shipment} — SI vs BL comparison of the 7 required fields.`
        : "SI vs BL comparison of the 7 required fields.",
      tone: "info",
    });
    onClose();
    router.push(currentEmail.caseRef ? `/cases?case=${currentEmail.caseRef}` : "/cases");
  };

  const openComparison = async () => {
    if (!currentEmail?.caseRef) {
      if (currentEmail?.attachments.length) {
        openAttachment(currentEmail.attachments[0]);
        return;
      }
      toast({ title: "Verification case is not ready", description: "Open the case after extraction finishes.", tone: "warning" });
      return;
    }
    setComparisonLoading(true);
    try {
      const detail = await getCase(currentEmail.caseRef);
      setComparisonCase(reviewDetail(detail));
    } catch (error) {
      toast({ title: "Document comparison is unavailable", description: error instanceof Error ? error.message : "Please retry.", tone: "warning" });
    } finally {
      setComparisonLoading(false);
    }
  };

  const stage = currentEmail.workflowState?.stage || "INITIAL";

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
        aria-label={`Email: ${currentEmail.subject}`}
        className="relative flex h-full w-full max-w-[640px] animate-[drawer-in_0.28s_cubic-bezier(0.22,1,0.36,1)] flex-col border-l border-edge bg-surface/95 shadow-glass-lg backdrop-blur-2xl backdrop-saturate-150"
      >
        <header className="flex items-start gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Tag
                color={CLASSIFICATION_TAG_COLORS[currentClassification]}
                icon={<ClassificationIcon className="size-3.5" strokeWidth={2.25} />}
                title={meta.hint}
              >
                {meta.label}
              </Tag>
              <EmailStatusBadge status={currentEmail.status} />
              {currentEmail.assignedTeam && (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-700 ring-1 ring-inset ring-line">
                  <Users className="size-3 text-ink-400" />
                  {currentEmail.assignedTeam}
                </span>
              )}
              {currentEmail.isSenderBlocked && (
                <span className="inline-flex items-center gap-1 rounded-md bg-failed-50 px-2 py-0.5 text-[11px] font-semibold text-failed-700 ring-1 ring-inset ring-failed-200">
                  <Ban className="size-3 text-failed-500" />
                  Sender Blocked
                </span>
              )}
            </div>
            <h2 className="mt-3 text-[18px] font-semibold leading-snug tracking-tight text-ink-900">
              {currentEmail.subject}
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
              <span className="block font-medium text-ink-900">{currentEmail.sender}</span>
              <span className="block truncate text-[12px] text-ink-400">{currentEmail.senderEmail}</span>
            </Meta>
            <Meta label="To">
              <span className="block truncate font-medium text-ink-900">{currentEmail.recipient}</span>
            </Meta>
            <Meta label="Received">
              <span className="block font-medium text-ink-900">{currentEmail.receivedLabel}</span>
            </Meta>
            <Meta label="Attachments">
              <span className="flex items-center gap-1.5 font-medium text-ink-900">
                <Paperclip className="size-3.5 text-ink-400" strokeWidth={2} />
                {currentEmail.attachments.length === 0
                  ? "None"
                  : `${currentEmail.attachments.length} file${currentEmail.attachments.length === 1 ? "" : "s"}`}
              </span>
            </Meta>
          </dl>

          <section className="mt-5 rounded-xl border border-edge bg-surface/60 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-brand-600" strokeWidth={2.25} />
              <h3 className="text-sm font-semibold text-ink-900">Production classification</h3>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Tag
                color={CLASSIFICATION_TAG_COLORS[currentClassification]}
                icon={<ClassificationIcon className="size-3.5" strokeWidth={2.25} />}
              >
                {meta.label}
              </Tag>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface ring-1 ring-inset ring-line">
                <span
                  className={cn(
                    "block h-full rounded-full bg-gradient-to-r",
                    currentConfidence >= 0.85
                      ? "from-matched-500 to-matched-700"
                      : currentConfidence >= 0.7
                        ? "from-brand-400 to-brand-600"
                        : "from-review-500 to-review-700",
                  )}
                  style={{ width: `${Math.round(currentConfidence * 100)}%` }}
                />
              </span>
              <span className="tabular text-[12px] font-semibold text-ink-700">
                {Math.round(currentConfidence * 100)}% confidence
              </span>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
              {currentReasoning}
            </p>
          </section>

          {/* 1. DOCUMENT COMPARISON SECTION */}
          {meta.verifiable && (
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
                    {currentEmail.shipment ? ` for ${currentEmail.shipment}` : ""}. Ready for field-by-field
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
                {currentEmail.caseRef && (
                  <span className="font-mono text-[12px] font-medium opacity-80">
                    #{currentEmail.caseRef}
                  </span>
                )}
                <ArrowRight className="size-4" strokeWidth={2.25} />
              </button>
              <button
                type="button"
                onClick={() => void openComparison()}
                disabled={comparisonLoading}
                className="btn-glass mt-2 w-full justify-center"
              >
                <ScanSearch className="size-4" strokeWidth={2.25} />
                {comparisonLoading ? "Loading documents…" : "Compare source documents"}
              </button>
            </section>
          )}

          {/* 2. NEW SI REQUEST WORKFLOW SECTION */}
          {currentClassification === "new_si" && (
            <section className="mt-5 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50/70 via-surface to-brand-50/40 p-4 shadow-glass">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand">
                  <FileStack className="size-[18px]" strokeWidth={2.25} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-ink-900">
                      Shipping Instruction Pipeline
                    </h3>
                    <span className="rounded-md bg-brand-100/70 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-700">
                      {stage}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                    Extract structured fields, generate SI plain text (.txt) artifact, verify operational parameters, approve, and return to requester.
                  </p>
                </div>
              </div>

              {/* SI Artifact Display */}
              {currentEmail.siArtifact && (
                <div className="mt-4 rounded-xl border border-brand-200/80 bg-surface/80 p-3 shadow-glass">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="size-4 text-brand-600 shrink-0" />
                      <div className="min-w-0">
                        <span className="block font-mono text-[12px] font-semibold text-ink-900 truncate">
                          {currentEmail.siArtifact.filename}
                        </span>
                        <span className="block text-[11px] text-ink-400">
                          {bytesLabel(currentEmail.siArtifact.size_bytes)} · Generated SI Plain Text
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadSI(currentEmail.siArtifact!.document_id, currentEmail.siArtifact!.filename)}
                      disabled={downloading}
                      className="btn-glass px-2.5 py-1 text-[11.5px] shrink-0"
                    >
                      {downloading ? <Loader className="size-3 animate-spin" /> : <Download className="size-3" />}
                      Download .txt
                    </button>
                  </div>

                  {currentEmail.siArtifact.fields && (
                    <div className="mt-3 border-t border-line pt-2">
                      <button
                        type="button"
                        onClick={() => setShowFieldsPreview(!showFieldsPreview)}
                        className="flex items-center justify-between w-full text-[11.5px] font-medium text-ink-500 hover:text-ink-900"
                      >
                        <span>View Extracted SI Fields ({Object.keys(currentEmail.siArtifact.fields).length})</span>
                        {showFieldsPreview ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      </button>
                      {showFieldsPreview && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] bg-surface/90 rounded-lg p-2.5 border border-line">
                          {Object.entries(currentEmail.siArtifact.fields).map(([k, v]) => (
                            <div key={k} className="min-w-0">
                              <span className="block uppercase text-ink-400 font-semibold tracking-wider text-[10px]">{k.replace(/_/g, " ")}</span>
                              <span className="block font-medium text-ink-800 truncate">{String(v || "—")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons for SI */}
              <div className="mt-4 flex flex-col gap-2">
                {!currentEmail.siArtifact && (
                  <button
                    type="button"
                    onClick={() => handleAction("generate-si", () => generateSI(currentEmail.id, currentEmail.version), "SI Generated", "Extracted fields and created SI text document.")}
                    disabled={actionLoading !== null}
                    className="btn-primary w-full justify-center"
                  >
                    {actionLoading === "generate-si" ? <Loader className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Generate SI Document (.txt)
                  </button>
                )}

                {currentEmail.siArtifact && !currentEmail.workflowState?.si_verified && (
                  <button
                    type="button"
                    onClick={() => handleAction("verify-si", () => verifySI(currentEmail.id, currentEmail.version), "SI Verified", "Shipping instruction verified against operational parameters.")}
                    disabled={actionLoading !== null}
                    className="btn-primary w-full justify-center"
                  >
                    {actionLoading === "verify-si" ? <Loader className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    Verify SI Document
                  </button>
                )}

                {currentEmail.workflowState?.si_verified && !currentEmail.workflowState?.si_approved && (
                  <button
                    type="button"
                    onClick={() => handleAction("approve-si", () => approveSI(currentEmail.id, currentEmail.version), "SI Approved", "Shipping instruction approved for carrier transmission.")}
                    disabled={actionLoading !== null}
                    className="btn-primary w-full justify-center"
                  >
                    {actionLoading === "approve-si" ? <Loader className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Approve SI Document
                  </button>
                )}

                {currentEmail.workflowState?.si_approved && !currentEmail.workflowState?.si_returned && (
                  <button
                    type="button"
                    onClick={() => handleAction("return-si", () => returnSI(currentEmail.id, currentEmail.version), "SI Returned", "Created Gmail response draft with SI .txt attached.")}
                    disabled={actionLoading !== null}
                    className="btn-primary w-full justify-center"
                  >
                    {actionLoading === "return-si" ? <Loader className="size-4 animate-spin" /> : <Send className="size-4" />}
                    Return SI to Requester (Attach .txt)
                  </button>
                )}

                {currentEmail.workflowState?.si_returned && (
                  <div className="flex items-center gap-2 rounded-xl border border-matched-200 bg-matched-50/90 p-3 text-[12.5px] font-medium text-matched-700">
                    <CheckCircle2 className="size-4.5 text-matched-500 shrink-0" />
                    <span>Shipping instruction completed and returned to requester with attached .txt.</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 3. INVOICE QUERY WORKFLOW SECTION */}
          {currentClassification === "invoice_query" && (
            <section className="mt-5 rounded-xl border border-plum-200 bg-gradient-to-br from-plum-50/70 via-surface to-plum-50/40 p-4 shadow-glass">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-plum-500 to-plum-700 text-white shadow-brand">
                  <Receipt className="size-[18px]" strokeWidth={2.25} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-ink-900">
                      Invoice & Billing Workflow
                    </h3>
                    <span className="rounded-md bg-plum-100/70 px-2 py-0.5 font-mono text-[11px] font-semibold text-plum-700">
                      {stage}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                    Route inquiry to the Accounts department, draft explanatory response, and resolve billing case.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAction("route", () => routeCase(currentEmail.id, "Finance", currentEmail.version), "Routed", "Case assigned to Finance team.")}
                    disabled={actionLoading !== null || currentEmail.assignedTeam === "Finance"}
                    className={cn(
                      "btn-glass text-[12px]",
                      currentEmail.assignedTeam === "Finance" && "bg-plum-50 text-plum-700 border-plum-200"
                    )}
                  >
                    <Users className="size-3.5" />
                    {currentEmail.assignedTeam === "Finance" ? "Assigned to Finance" : "Route to Finance"}
                  </button>
                </div>

                <div className="rounded-xl border border-edge bg-surface/70 p-3">
                  <label className="block text-[11.5px] font-semibold text-ink-700 mb-1.5">
                    Response Draft (Gmail Draft Lifecycle)
                  </label>
                  <textarea
                    value={customResponse}
                    onChange={(e) => setCustomResponse(e.target.value)}
                    placeholder="Enter response notes for the customer regarding this billing query..."
                    rows={3}
                    className="field-glass p-2.5 text-[12.5px] mb-2"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleAction("draft-response", () => draftCategoryResponse(currentEmail.id, customResponse || "Thank you for reaching out regarding your invoice. Our accounts team has reviewed your inquiry and updated the statement.", currentEmail.version), "Draft Created", "Response email draft prepared in Gmail.")}
                      disabled={actionLoading !== null}
                      className="btn-primary text-[12px]"
                    >
                      {actionLoading === "draft-response" ? <Loader className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Create Gmail Draft
                    </button>
                  </div>
                </div>

                {stage !== "COMPLETED" ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Optional completion note..."
                      className="field-glass px-3 py-1.5 text-[12px] flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => handleAction("complete", () => completeCategoryCase(currentEmail.id, currentEmail.version, resolutionNote || "Invoice query reviewed and resolved."), "Case Completed", "Billing inquiry marked as completed.")}
                      disabled={actionLoading !== null}
                      className="btn-glass text-[12px] hover:border-matched-200 hover:text-matched-700 shrink-0"
                    >
                      {actionLoading === "complete" ? <Loader className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5 text-matched-600" />}
                      Complete Case
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-matched-200 bg-matched-50/90 p-3 text-[12.5px] font-medium text-matched-700">
                    <CheckCircle2 className="size-4 text-matched-500 shrink-0" />
                    <span>Inquiry resolved and completed.</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 4. GENERAL MESSAGE WORKFLOW SECTION */}
          {currentClassification === "general" && (
            <section className="mt-5 rounded-xl border border-line bg-surface/70 p-4 shadow-glass">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-ink-700 ring-1 ring-inset ring-line">
                  <Mail className="size-[18px]" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-ink-900">
                      General Inquiry Workflow
                    </h3>
                    <span className="rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-600 ring-1 ring-inset ring-line">
                      {stage}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                    Route message to Customer Service, draft response email, and mark resolved.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAction("route", () => routeCase(currentEmail.id, "Customer Service", currentEmail.version), "Routed", "Assigned to Customer Service.")}
                    disabled={actionLoading !== null || currentEmail.assignedTeam === "Customer Service"}
                    className={cn(
                      "btn-glass text-[12px]",
                      currentEmail.assignedTeam === "Customer Service" && "bg-brand-50 text-brand-700 border-brand-200"
                    )}
                  >
                    <Users className="size-3.5" />
                    {currentEmail.assignedTeam === "Customer Service" ? "Assigned: Customer Service" : "Route to Customer Service"}
                  </button>
                </div>

                <div className="rounded-xl border border-edge bg-surface/70 p-3">
                  <label className="block text-[11.5px] font-semibold text-ink-700 mb-1.5">
                    Customer Response Draft
                  </label>
                  <textarea
                    value={customResponse}
                    onChange={(e) => setCustomResponse(e.target.value)}
                    placeholder="Enter reply message..."
                    rows={3}
                    className="field-glass p-2.5 text-[12.5px] mb-2"
                  />
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => handleAction("draft-response", () => draftCategoryResponse(currentEmail.id, customResponse || "Thank you for reaching out. We have received your inquiry and our customer operations team is following up.", currentEmail.version), "Draft Created", "Draft response created in Gmail.")}
                      disabled={actionLoading !== null}
                      className="btn-primary text-[12px]"
                    >
                      {actionLoading === "draft-response" ? <Loader className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Create Gmail Draft
                    </button>
                  </div>
                </div>

                {stage !== "COMPLETED" ? (
                  <button
                    type="button"
                    onClick={() => handleAction("complete", () => completeCategoryCase(currentEmail.id, currentEmail.version, resolutionNote || "General inquiry addressed."), "Case Completed", "Inquiry marked as completed.")}
                    disabled={actionLoading !== null}
                    className="btn-glass justify-center text-[12.5px] hover:border-matched-200 hover:text-matched-700"
                  >
                    {actionLoading === "complete" ? <Loader className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5 text-matched-600" />}
                    Complete Inquiry
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-matched-200 bg-matched-50/90 p-3 text-[12.5px] font-medium text-matched-700">
                    <CheckCircle2 className="size-4 text-matched-500 shrink-0" />
                    <span>Case resolved and marked completed.</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 5. SPAM MODERATION WORKFLOW SECTION */}
          {currentClassification === "spam" && (
            <section className="mt-5 rounded-xl border border-failed-200 bg-gradient-to-br from-failed-50/70 via-surface to-failed-50/40 p-4 shadow-glass">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-failed-500 to-failed-700 text-white shadow-brand">
                  <ShieldAlert className="size-[18px]" strokeWidth={2.25} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-semibold text-ink-900">
                    Spam Moderation & Ingestion Filter
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                    Protect system intake by blocking suspicious senders across database and Gmail filter rules, or reclassify false positives.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {currentEmail.isSenderBlocked ? (
                  <div className="rounded-xl border border-failed-200 bg-failed-50/90 p-3.5">
                    <div className="flex items-center gap-2 font-semibold text-[13px] text-failed-700">
                      <Ban className="size-4 shrink-0 text-failed-600" />
                      <span>Sender is Permanently Blocked</span>
                    </div>
                    <p className="mt-1 text-[12px] text-failed-700/80 leading-relaxed">
                      Emails from <strong className="font-mono">{currentEmail.senderEmail}</strong> are dropped during ingestion and marked in Gmail filter rules.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleAction("not-spam", () => markNotSpam(currentEmail.id, currentEmail.version), "Sender Unblocked", "Sender unblocked and case reclassified.")}
                      disabled={actionLoading !== null}
                      className="btn-glass mt-3 text-[12px]"
                    >
                      {actionLoading === "not-spam" ? <Loader className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      Unblock & Mark as Not Spam
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-edge bg-surface/80 p-3.5">
                    <div className="flex items-center gap-2 font-medium text-[12.5px] text-ink-800">
                      <ShieldAlert className="size-4 text-failed-500" />
                      <span>Sender is currently not blocked.</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAction("block-sender", () => blockSender(currentEmail.id, currentEmail.version, "Blocked via inbox review"), "Sender Blocked", "Sender blocked in database and Gmail filter configured.")}
                        disabled={actionLoading !== null}
                        className="btn-glass text-[12px] text-failed-700 border-failed-200 hover:bg-failed-50"
                      >
                        {actionLoading === "block-sender" ? <Loader className="size-3.5 animate-spin" /> : <Ban className="size-3.5 text-failed-500" />}
                        Block Sender
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction("not-spam", () => markNotSpam(currentEmail.id, currentEmail.version), "Marked as Not Spam", "Case reclassified as general.")}
                        disabled={actionLoading !== null}
                        className="btn-glass text-[12px]"
                      >
                        {actionLoading === "not-spam" ? <Loader className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Mark as Not Spam
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Non-comparison attachments */}
          {!meta.verifiable && currentEmail.attachments.length > 0 && (
            <div className="mt-5 rounded-xl border border-line bg-surface/50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-ink-900">Attachments ({currentEmail.attachments.length})</h3>
              <ul className="flex flex-col gap-2">
                {currentEmail.attachments.map((file) => (
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
            </div>
          )}

          <section className="mt-6">
            <h3 className="text-sm font-semibold text-ink-900">Message</h3>
            <div className="mt-3 flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink-700">
              {currentEmail.body.map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>

          <Workflow email={currentEmail} />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface/60 px-6 py-4">
          <span className="text-[12px] text-ink-400 truncate max-w-[340px]">
            {meta.verifiable
              ? "Verification workflow active"
              : currentClassification === "new_si"
                ? `SI Workflow · Stage: ${stage}`
                : currentClassification === "invoice_query"
                  ? `Billing Workflow · ${currentEmail.assignedTeam ? `Assigned to ${currentEmail.assignedTeam}` : "Unassigned"}`
                  : currentClassification === "spam"
                    ? (currentEmail.isSenderBlocked ? "Spam · Sender Blocked" : "Spam · Action Required")
                    : `General Workflow · ${stage}`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
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
      {comparisonCase && (
        <DocumentComparison
          si={comparisonCase.si}
          bl={comparisonCase.bl}
          problemField={comparisonCase.problemField}
          open
          onClose={() => setComparisonCase(null)}
          heading={`Document comparison · ${currentEmail.shipment || currentEmail.id}`}
        />
      )}
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

/** Where this email sits in the intake and category workflow. */
function Workflow({ email }: { email: InboxEmail }) {
  const classification = email.classification;
  const stage = email.workflowState?.stage || "INITIAL";
  const isBlocked = email.isSenderBlocked;

  let steps: Array<{ label: string; state: "done" | "current" | "todo" }> = [];

  if (classification === "document_comparison") {
    steps = [
      { label: "Incoming email", state: "done" },
      {
        label: "AI classification",
        state: email.status === "processing" ? "current" : "done",
      },
      {
        label: "Verification case",
        state:
          email.status === "completed"
            ? "done"
            : email.status === "processing"
              ? "todo"
              : "current",
      },
      {
        label: "SI + BL comparison",
        state: email.status === "completed" ? "done" : "todo",
      },
    ];
  } else if (classification === "new_si") {
    const isGenerated = !!email.siArtifact || stage !== "RECEIVED" && stage !== "INITIAL";
    const isVerified = !!email.workflowState?.si_verified;
    const isApproved = !!email.workflowState?.si_approved;
    const isReturned = !!email.workflowState?.si_returned || stage === "RETURNED";

    steps = [
      { label: "Intake", state: "done" },
      { label: "AI Classify", state: "done" },
      {
        label: "Generate SI",
        state: isGenerated ? "done" : "current",
      },
      {
        label: "Verify",
        state: isVerified ? "done" : isGenerated ? "current" : "todo",
      },
      {
        label: "Approve",
        state: isApproved ? "done" : isVerified ? "current" : "todo",
      },
      {
        label: "Return",
        state: isReturned ? "done" : isApproved ? "current" : "todo",
      },
    ];
  } else if (classification === "invoice_query" || classification === "general") {
    const isRouted = !!email.assignedTeam || stage === "ROUTED" || stage === "DRAFTED" || stage === "COMPLETED";
    const isDrafted = stage === "DRAFTED" || stage === "COMPLETED";
    const isCompleted = stage === "COMPLETED";

    steps = [
      { label: "Intake", state: "done" },
      { label: "AI Classify", state: "done" },
      {
        label: "Route Team",
        state: isRouted ? "done" : "current",
      },
      {
        label: "Draft Reply",
        state: isDrafted ? "done" : isRouted ? "current" : "todo",
      },
      {
        label: "Complete",
        state: isCompleted ? "done" : isDrafted ? "current" : "todo",
      },
    ];
  } else if (classification === "spam") {
    steps = [
      { label: "Intake", state: "done" },
      { label: "AI Spam Flag", state: "done" },
      {
        label: isBlocked ? "Sender Blocked" : "Moderation",
        state: isBlocked ? "done" : "current",
      },
    ];
  }

  return (
    <section className="mt-6 rounded-xl border border-edge bg-surface/55 p-4">
      <h3 className="text-sm font-semibold text-ink-900">Workflow lifecycle</h3>
      <Steps
        aria-label="Email workflow lifecycle"
        className="mt-3"
        size="small"
        responsive
        items={steps.map((step) => ({
          title: step.label,
          status: step.state === "done" ? "finish" : step.state === "current" ? "process" : "wait",
        }))}
      />
    </section>
  );
}
