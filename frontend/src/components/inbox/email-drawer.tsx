"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CheckOutlined,
  DownloadOutlined,
  DownOutlined,
  ExportOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  PaperClipOutlined,
  ScanOutlined,
  SendOutlined,
  StopOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UpOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { Button, Card, Drawer, Input, Progress, Steps, Tag } from "antd";
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
  type CaseDraft,
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

function buildGmailComposeUrl(to: string, subject: string, body: string): string {
  const cleanTo = to.includes("<") ? (to.match(/<([^>]+)>/)?.[1] || to) : to;
  const encodedTo = encodeURIComponent(cleanTo.trim());
  const formattedSubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
  const encodedSubject = encodeURIComponent(formattedSubject);
  const encodedBody = encodeURIComponent(body);
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`;
}

function getCategoryDraftTemplate(category: InboxEmail["classification"], email: InboxEmail): string {
  const senderName = email.sender || "Customer";
  if (category === "invoice_query") {
    return (
      `Dear ${senderName},\n\n` +
      `Thank you for contacting us regarding your invoice inquiry.\n\n` +
      `Your request has been routed to our Finance & Accounts Department for expedited review. ` +
      `Our accounts specialist is currently verifying the charges against the agreed tariff schedule and will provide a full breakdown within 1 business day.\n\n` +
      `Thank you for your patience.\n\n` +
      `Best regards,\n` +
      `Finance & Accounts Team\n` +
      `ShipVerify Platform`
    );
  }
  return (
    `Dear ${senderName},\n\n` +
    `Thank you for reaching out to us.\n\n` +
    `We have received your message regarding "${email.subject}" and forwarded it to our Customer Service team. ` +
    `A representative will review the details and get back to you shortly.\n\n` +
    `Best regards,\n` +
    `Customer Service Team\n` +
    `ShipVerify Platform`
  );
}

/**
 * Email detail view.
 *
 * Rendered within a standardized Ant Design Drawer matching the Verification Cases page.
 * Shows the email details plus automated classifications and category workflows.
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
  const [currentDraft, setCurrentDraft] = useState<CaseDraft | null>(email?.draft ?? null);
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const [comparisonCase, setComparisonCase] = useState<ReviewCase | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showFieldsPreview, setShowFieldsPreview] = useState(false);
  const [customResponse, setCustomResponse] = useState(email?.draft?.body || "");
  const [resolutionNote, setResolutionNote] = useState("");

  useEffect(() => {
    setCurrentEmail(email);
    const initialDraft = email?.draft ?? null;
    setCurrentDraft(initialDraft);
    setCustomResponse(initialDraft?.body || "");
    setResolutionNote("");
    setShowFieldsPreview(false);

    if (email?.id) {
      getCase(email.id)
        .then((detail) => {
          const updated = inboxDetail(detail);
          setCurrentEmail(updated);
          if (detail.draft) {
            setCurrentDraft(detail.draft);
            if (detail.draft.body) {
              setCustomResponse(detail.draft.body);
            }
          }
        })
        .catch(() => {});
    }
  }, [email?.id]);

  const handleAction = async (
    actionKey: string,
    apiCall: () => Promise<CaseDetail>,
    successTitle: string,
    successDescription: string,
    onSuccess?: (detail: CaseDetail) => void,
  ) => {
    if (!currentEmail) return;
    setActionLoading(actionKey);
    try {
      const detail = await apiCall();
      const updated = inboxDetail(detail);
      setCurrentEmail(updated);
      if (detail.draft) {
        setCurrentDraft(detail.draft);
      }
      onEmailUpdated?.(updated);
      onSuccess?.(detail);
      toast({ title: successTitle, description: successDescription, tone: "success" });
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please retry.",
        tone: "warning",
      });
      throw err;
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateAIDraft = async () => {
    if (!currentEmail) return;
    try {
      await handleAction(
        "draft-ai",
        () => draftCategoryResponse(currentEmail.id, "", currentEmail.version),
        "Draft Generated",
        "AI response draft inserted into the text box.",
        (detail) => {
          const bodyText = detail.draft?.body || getCategoryDraftTemplate(currentEmail.classification, currentEmail);
          setCustomResponse(bodyText);
          if (detail.draft) {
            setCurrentDraft(detail.draft);
          }
        },
      );
    } catch {
      const fallbackText = getCategoryDraftTemplate(currentEmail.classification, currentEmail);
      setCustomResponse(fallbackText);
      toast({
        title: "Draft Generated",
        description: "AI response draft inserted into the text box.",
        tone: "success",
      });
    }
  };

  const handleSendDraftToEmail = async () => {
    if (!currentEmail || !customResponse.trim()) return;
    const bodyToSend = customResponse.trim();
    try {
      await handleAction(
        "send-draft",
        () => draftCategoryResponse(currentEmail.id, bodyToSend, currentEmail.version),
        "Draft Created",
        "Redirecting to Gmail compose window...",
        (detail) => {
          const targetUrl =
            detail.draft?.gmail_url ||
            buildGmailComposeUrl(
              currentEmail.senderEmail || currentEmail.sender,
              detail.draft?.subject || currentEmail.subject,
              bodyToSend,
            );
          if (targetUrl) {
            window.open(targetUrl, "_blank");
          }
        },
      );
    } catch {
      const targetUrl = buildGmailComposeUrl(
        currentEmail.senderEmail || currentEmail.sender,
        currentEmail.subject,
        bodyToSend,
      );
      window.open(targetUrl, "_blank");
      toast({
        title: "Opening Gmail",
        description: "Redirecting to your Gmail compose window.",
        tone: "info",
      });
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

  const stage = currentEmail.workflowState?.stage || "INITIAL";

  return (
    <>
      <Drawer
        open={Boolean(email)}
        onClose={onClose}
        size={780}
        title={
          <div className="flex flex-col gap-1 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <Tag
                color={CLASSIFICATION_TAG_COLORS[currentClassification]}
                icon={<ClassificationIcon className="size-3.5 inline-block mr-1 align-[-2px]" />}
                title={meta.hint}
                className="m-0"
              >
                {meta.label}
              </Tag>
              <EmailStatusBadge status={currentEmail.status} />
              {currentEmail.assignedTeam && (
                <Tag icon={<TeamOutlined />} className="m-0">
                  {currentEmail.assignedTeam}
                </Tag>
              )}
              {currentEmail.isSenderBlocked && (
                <Tag color="error" icon={<StopOutlined />} className="m-0 font-semibold">
                  Sender Blocked
                </Tag>
              )}
            </div>
            <h2 className="text-lg font-bold text-ink-900 tracking-tight mt-0.5">
              {currentEmail.subject}
            </h2>
            <p className="text-xs text-ink-400">
              {currentEmail.sender} &lt;{currentEmail.senderEmail}&gt; · {currentEmail.receivedLabel}
            </p>
          </div>
        }
        footer={
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-ink-500 truncate max-w-[340px]">
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
              {meta.verifiable && (
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  onClick={openVerificationCase}
                >
                  Open Verification Case
                </Button>
              )}
              <Button type="default" onClick={onClose} className="min-w-[96px]">
                Close
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {/* Metadata Card */}
          <Card size="small" className="border-edge bg-surface/70 shadow-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 block">From</span>
                <span className="font-semibold text-ink-900 block mt-0.5">{currentEmail.sender}</span>
                <span className="text-ink-400 text-[11px] block truncate">{currentEmail.senderEmail}</span>
              </div>
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 block">To</span>
                <span className="font-semibold text-ink-900 block mt-0.5 truncate">{currentEmail.recipient}</span>
              </div>
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 block">Received</span>
                <span className="font-medium text-ink-800 block mt-0.5">{currentEmail.receivedLabel}</span>
              </div>
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 block">Attachments</span>
                <span className="font-medium text-ink-800 flex items-center gap-1 mt-0.5">
                  <PaperClipOutlined className="text-ink-400" />
                  {currentEmail.attachments.length === 0
                    ? "None"
                    : `${currentEmail.attachments.length} file${currentEmail.attachments.length === 1 ? "" : "s"}`}
                </span>
              </div>
            </div>
          </Card>

          {/* Classification Confidence Card */}
          <Card
            size="small"
            className="border-edge bg-surface/70 shadow-sm"
            title={
              <div className="flex items-center gap-2 text-ink-900 font-semibold text-xs">
                <ThunderboltOutlined className="text-brand-600" />
                <span>Production Classification</span>
              </div>
            }
            extra={
              <Tag color={CLASSIFICATION_TAG_COLORS[currentClassification]} className="m-0">
                {meta.label}
              </Tag>
            }
          >
            <div className="flex items-center gap-3">
              <Progress
                percent={Math.round(currentConfidence * 100)}
                size="small"
                className="flex-1 m-0"
                strokeColor={
                  currentConfidence >= 0.85
                    ? "#52c41a"
                    : currentConfidence >= 0.7
                      ? "#1677ff"
                      : "#faad14"
                }
              />
              <span className="tabular text-xs font-semibold text-ink-700">
                {Math.round(currentConfidence * 100)}%
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-600 leading-relaxed">
              {currentReasoning}
            </p>
          </Card>

          {/* 1. DOCUMENT COMPARISON SECTION */}
          {meta.verifiable && (
            <Card
              size="small"
              className="border-brand-200 bg-brand-50/40 shadow-sm"
              title={
                <div className="flex items-center gap-2 text-ink-900 font-semibold text-xs">
                  <FileSearchOutlined className="text-brand-600" />
                  <span>Document Verification Detected</span>
                </div>
              }
            >
              <p className="text-xs text-ink-600 leading-relaxed mb-3">
                Shipping Instruction and draft Bill of Lading identified
                {currentEmail.shipment ? ` for ${currentEmail.shipment}` : ""}. Ready for field-by-field
                comparison of the 7 required fields.
              </p>

              <div className="flex flex-col gap-2">
                <DocumentRow role="SI" file={si} onOpen={openAttachment} />
                <DocumentRow role="BL" file={bl} onOpen={openAttachment} />
              </div>

              <Button
                type="dashed"
                block
                icon={<FileSearchOutlined />}
                loading={comparisonLoading}
                onClick={() => void openComparison()}
                className="mt-3"
              >
                Compare Source Documents (SI vs BL)
              </Button>

              <Button
                type="primary"
                block
                icon={<ArrowRightOutlined />}
                onClick={openVerificationCase}
                className="mt-2"
              >
                Open Verification Case {currentEmail.caseRef ? `#${currentEmail.caseRef}` : ""}
              </Button>
            </Card>
          )}

          {/* 2. NEW SI REQUEST WORKFLOW SECTION */}
          {currentClassification === "new_si" && (
            <Card
              size="small"
              className="border-brand-200 bg-brand-50/40 shadow-sm"
              title={
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-semibold text-ink-900">
                    Shipping Instruction Pipeline
                  </span>
                  <Tag color="blue" className="font-mono text-[10px] m-0">
                    {stage}
                  </Tag>
                </div>
              }
            >
              <p className="text-xs text-ink-600 leading-relaxed mb-3">
                Extract structured fields, generate SI plain text (.txt) artifact, verify operational parameters, approve, and return to requester.
              </p>

              {/* SI Artifact Display */}
              {currentEmail.siArtifact && (
                <Card size="small" className="border-edge bg-surface/90 mb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileTextOutlined className="text-brand-600 text-sm shrink-0" />
                      <div className="min-w-0">
                        <span className="block font-mono text-xs font-semibold text-ink-900 truncate">
                          {currentEmail.siArtifact.filename}
                        </span>
                        <span className="block text-[11px] text-ink-400">
                          {bytesLabel(currentEmail.siArtifact.size_bytes)} · Generated SI Plain Text
                        </span>
                      </div>
                    </div>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => handleDownloadSI(currentEmail.siArtifact!.document_id, currentEmail.siArtifact!.filename)}
                      loading={downloading}
                    >
                      Download .txt
                    </Button>
                  </div>

                  {currentEmail.siArtifact.fields && (
                    <div className="mt-3 border-t border-line pt-2">
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setShowFieldsPreview(!showFieldsPreview)}
                        className="p-0 text-xs text-ink-500 hover:text-ink-900 flex items-center justify-between w-full"
                      >
                        <span>View Extracted SI Fields ({Object.keys(currentEmail.siArtifact.fields).length})</span>
                        {showFieldsPreview ? <UpOutlined className="text-[10px]" /> : <DownOutlined className="text-[10px]" />}
                      </Button>
                      {showFieldsPreview && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs bg-canvas rounded-lg p-2.5 border border-line">
                          {Object.entries(currentEmail.siArtifact.fields).map(([k, v]) => (
                            <div key={k} className="min-w-0">
                              <span className="block uppercase text-ink-400 font-semibold tracking-wider text-[10px]">
                                {k.replace(/_/g, " ")}
                              </span>
                              <span className="block font-medium text-ink-800 truncate">{String(v || "—")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {/* Action Buttons for SI */}
              <div className="flex flex-col gap-2">
                {!currentEmail.siArtifact && (
                  <Button
                    type="primary"
                    block
                    icon={<ThunderboltOutlined />}
                    loading={actionLoading === "generate-si"}
                    onClick={() => handleAction("generate-si", () => generateSI(currentEmail.id, currentEmail.version), "SI Generated", "Extracted fields and created SI text document.")}
                  >
                    Generate SI Document (.txt)
                  </Button>
                )}

                {currentEmail.siArtifact && !currentEmail.workflowState?.si_verified && (
                  <Button
                    type="primary"
                    block
                    icon={<CheckCircleOutlined />}
                    loading={actionLoading === "verify-si"}
                    onClick={() => handleAction("verify-si", () => verifySI(currentEmail.id, currentEmail.version), "SI Verified", "Shipping instruction verified against operational parameters.")}
                  >
                    Verify SI Document
                  </Button>
                )}

                {currentEmail.workflowState?.si_verified && !currentEmail.workflowState?.si_approved && (
                  <Button
                    type="primary"
                    block
                    icon={<CheckCircleFilled />}
                    loading={actionLoading === "approve-si"}
                    onClick={() => handleAction("approve-si", () => approveSI(currentEmail.id, currentEmail.version), "SI Approved", "Shipping instruction approved for carrier transmission.")}
                  >
                    Approve SI Document
                  </Button>
                )}

                {currentEmail.workflowState?.si_approved && !currentEmail.workflowState?.si_returned && (
                  <Button
                    type="primary"
                    block
                    icon={<SendOutlined />}
                    loading={actionLoading === "return-si"}
                    onClick={() =>
                      handleAction(
                        "return-si",
                        () => returnSI(currentEmail.id, currentEmail.version),
                        "SI Returned",
                        "Created Gmail response draft with SI .txt attached.",
                        (detail) => {
                          const targetUrl =
                            detail.draft?.gmail_url ||
                            buildGmailComposeUrl(
                              currentEmail.senderEmail || currentEmail.sender,
                              `Re: ${currentEmail.subject}`,
                              "Please find attached the approved Shipping Instruction document.",
                            );
                          if (targetUrl) {
                            window.open(targetUrl, "_blank");
                          }
                        },
                      )
                    }
                  >
                    Return SI to Requester (Attach .txt)
                  </Button>
                )}

                {currentEmail.workflowState?.si_returned && (
                  <div className="flex items-center gap-2 rounded-lg border border-matched-200 bg-matched-50/90 p-2.5 text-xs font-medium text-matched-700">
                    <CheckCircleFilled className="text-matched-500 text-sm shrink-0" />
                    <span>Shipping instruction completed and returned to requester with attached .txt.</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* 3. INVOICE QUERY WORKFLOW SECTION */}
          {currentClassification === "invoice_query" && (
            <Card
              size="small"
              className="border-purple-200 bg-purple-50/30 shadow-sm"
              title={
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-semibold text-ink-900">
                    Invoice & Billing Workflow
                  </span>
                  <Tag color="purple" className="font-mono text-[10px] m-0">
                    {stage}
                  </Tag>
                </div>
              }
            >
              <p className="text-xs text-ink-600 leading-relaxed mb-3">
                Route inquiry to the Accounts department, draft explanatory response, and resolve billing case.
              </p>

              <div className="flex flex-col gap-3">
                <div>
                  <Button
                    icon={<TeamOutlined />}
                    onClick={() => handleAction("route", () => routeCase(currentEmail.id, "Finance", currentEmail.version), "Routed", "Case assigned to Finance team.")}
                    disabled={actionLoading !== null || currentEmail.assignedTeam === "Finance"}
                  >
                    {currentEmail.assignedTeam === "Finance" ? "Assigned: Finance" : "Route to Finance"}
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-ink-700">
                      Response Draft (Gmail Draft Lifecycle)
                    </label>
                    {currentDraft?.gmail_url && (
                      <a
                        href={currentDraft.gmail_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium inline-flex items-center gap-1"
                      >
                        <ExportOutlined className="text-[10px]" />
                        <span>Open draft in Gmail</span>
                      </a>
                    )}
                  </div>
                  <Input.TextArea
                    value={customResponse}
                    onChange={(e) => setCustomResponse(e.target.value)}
                    placeholder="Enter response notes or click 'Draft Email' to generate..."
                    rows={4}
                    className="font-sans text-xs"
                  />
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={actionLoading === "draft-ai"}
                      onClick={handleGenerateAIDraft}
                    >
                      {customResponse.trim() ? "Regenerate AI Draft" : "Draft Email"}
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      icon={<SendOutlined />}
                      loading={actionLoading === "send-draft"}
                      disabled={actionLoading !== null || !customResponse.trim()}
                      onClick={handleSendDraftToEmail}
                    >
                      Send Draft to Email
                    </Button>
                  </div>
                </div>

                {stage !== "COMPLETED" ? (
                  <div className="flex items-center gap-2 pt-1 border-t border-line">
                    <Input
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Optional completion note..."
                      className="flex-1"
                      size="small"
                    />
                    <Button
                      size="small"
                      icon={<CheckCircleOutlined />}
                      loading={actionLoading === "complete"}
                      onClick={() => handleAction("complete", () => completeCategoryCase(currentEmail.id, currentEmail.version, resolutionNote || "Invoice query reviewed and resolved."), "Case Completed", "Billing inquiry marked as completed.")}
                    >
                      Complete Case
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-matched-200 bg-matched-50/90 p-2.5 text-xs font-medium text-matched-700">
                    <CheckCircleFilled className="text-matched-500 text-sm shrink-0" />
                    <span>Inquiry resolved and completed.</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* 4. GENERAL MESSAGE WORKFLOW SECTION */}
          {currentClassification === "general" && (
            <Card
              size="small"
              className="border-edge bg-surface/70 shadow-sm"
              title={
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-semibold text-ink-900">
                    General Inquiry Workflow
                  </span>
                  <Tag className="font-mono text-[10px] m-0">
                    {stage}
                  </Tag>
                </div>
              }
            >
              <p className="text-xs text-ink-600 leading-relaxed mb-3">
                Route message to Customer Service, draft response email, and mark resolved.
              </p>

              <div className="flex flex-col gap-3">
                <div>
                  <Button
                    icon={<TeamOutlined />}
                    onClick={() => handleAction("route", () => routeCase(currentEmail.id, "Customer Service", currentEmail.version), "Routed", "Assigned to Customer Service.")}
                    disabled={actionLoading !== null || currentEmail.assignedTeam === "Customer Service"}
                  >
                    {currentEmail.assignedTeam === "Customer Service" ? "Assigned: Customer Service" : "Route to Customer Service"}
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-ink-700">
                      Customer Response Draft
                    </label>
                    {currentDraft?.gmail_url && (
                      <a
                        href={currentDraft.gmail_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium inline-flex items-center gap-1"
                      >
                        <ExportOutlined className="text-[10px]" />
                        <span>Open draft in Gmail</span>
                      </a>
                    )}
                  </div>
                  <Input.TextArea
                    value={customResponse}
                    onChange={(e) => setCustomResponse(e.target.value)}
                    placeholder="Enter reply message or click 'Draft Email' to generate..."
                    rows={4}
                    className="font-sans text-xs"
                  />
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={actionLoading === "draft-ai"}
                      onClick={handleGenerateAIDraft}
                    >
                      {customResponse.trim() ? "Regenerate AI Draft" : "Draft Email"}
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      icon={<SendOutlined />}
                      loading={actionLoading === "send-draft"}
                      disabled={actionLoading !== null || !customResponse.trim()}
                      onClick={handleSendDraftToEmail}
                    >
                      Send Draft to Email
                    </Button>
                  </div>
                </div>

                {stage !== "COMPLETED" ? (
                  <Button
                    icon={<CheckCircleOutlined />}
                    loading={actionLoading === "complete"}
                    onClick={() => handleAction("complete", () => completeCategoryCase(currentEmail.id, currentEmail.version, resolutionNote || "General inquiry addressed."), "Case Completed", "Inquiry marked as completed.")}
                  >
                    Complete Inquiry
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-matched-200 bg-matched-50/90 p-2.5 text-xs font-medium text-matched-700">
                    <CheckCircleFilled className="text-matched-500 text-sm shrink-0" />
                    <span>Case resolved and marked completed.</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* 5. SPAM MODERATION WORKFLOW SECTION */}
          {currentClassification === "spam" && (
            <Card
              size="small"
              className="border-failed-200 bg-failed-50/30 shadow-sm"
              title={
                <div className="flex items-center gap-2 text-ink-900 font-semibold text-xs">
                  <StopOutlined className="text-failed-500" />
                  <span>Spam Moderation & Ingestion Filter</span>
                </div>
              }
            >
              <p className="text-xs text-ink-600 leading-relaxed mb-3">
                Protect system intake by blocking suspicious senders across database and Gmail filter rules, or reclassify false positives.
              </p>

              {currentEmail.isSenderBlocked ? (
                <div className="rounded-lg border border-failed-200 bg-failed-50/90 p-3">
                  <div className="flex items-center gap-2 font-semibold text-xs text-failed-700">
                    <StopOutlined className="text-failed-600" />
                    <span>Sender is Permanently Blocked</span>
                  </div>
                  <p className="mt-1 text-xs text-failed-700/80 leading-relaxed">
                    Emails from <strong className="font-mono">{currentEmail.senderEmail}</strong> are dropped during ingestion and marked in Gmail filter rules.
                  </p>
                  <Button
                    size="small"
                    className="mt-2.5"
                    icon={<CheckOutlined />}
                    loading={actionLoading === "not-spam"}
                    onClick={() => handleAction("not-spam", () => markNotSpam(currentEmail.id, currentEmail.version), "Sender Unblocked", "Sender unblocked and case reclassified.")}
                  >
                    Unblock & Mark as Not Spam
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-edge bg-surface/80 p-3">
                  <div className="flex items-center gap-2 font-medium text-xs text-ink-800">
                    <WarningFilled className="text-failed-500 text-sm" />
                    <span>Sender is currently not blocked.</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      danger
                      size="small"
                      icon={<StopOutlined />}
                      loading={actionLoading === "block-sender"}
                      onClick={() => handleAction("block-sender", () => blockSender(currentEmail.id, currentEmail.version, "Blocked via inbox review"), "Sender Blocked", "Sender blocked in database and Gmail filter configured.")}
                    >
                      Block Sender
                    </Button>
                    <Button
                      size="small"
                      icon={<CheckOutlined />}
                      loading={actionLoading === "not-spam"}
                      onClick={() => handleAction("not-spam", () => markNotSpam(currentEmail.id, currentEmail.version), "Marked as Not Spam", "Case reclassified as general.")}
                    >
                      Mark as Not Spam
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Non-comparison attachments */}
          {!meta.verifiable && currentEmail.attachments.length > 0 && (
            <Card
              size="small"
              className="border-edge bg-surface/70 shadow-sm"
              title={
                <span className="text-xs font-semibold text-ink-700">
                  Attachments ({currentEmail.attachments.length})
                </span>
              }
            >
              <div className="flex flex-col gap-2">
                {currentEmail.attachments.map((file) => (
                  <button
                    key={file.name}
                    type="button"
                    onClick={() => openAttachment(file)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface/80 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-brand-300 hover:bg-surface"
                  >
                    <FileTextOutlined className="text-ink-400 text-xs" />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink-700">
                      {file.name}
                    </span>
                    <span className="tabular text-[11px] text-ink-400">{file.sizeLabel}</span>
                    <ExportOutlined className="text-ink-400 text-xs" />
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Message Body Card */}
          <Card
            size="small"
            className="border-edge bg-surface/70 shadow-sm"
            title={<span className="text-xs font-semibold text-ink-700">Message</span>}
          >
            <div className="flex flex-col gap-2.5 text-xs leading-relaxed text-ink-700">
              {currentEmail.body.map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          </Card>

          {/* Workflow Lifecycle */}
          <Workflow email={currentEmail} />
        </div>
      </Drawer>

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
    </>
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
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-review-200 bg-review-50/60 px-2.5 py-1.5 text-xs text-review-700">
        <Tag color="warning" className="font-mono text-[10px] m-0">
          {role}
        </Tag>
        <span className="flex-1">{roleLabel} still being extracted</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface/80 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-brand-300 hover:bg-surface"
    >
      <Tag color="blue" className="font-mono text-[10px] m-0">
        {role}
      </Tag>
      <span className="min-w-0 flex-1 truncate font-medium text-ink-700">{file.name}</span>
      <span className="text-[11px] text-ink-400">
        {file.pages} {file.pages === 1 ? "page" : "pages"} · {file.sizeLabel}
      </span>
      {file.scanned && (
        <Tag color="warning" icon={<ScanOutlined />} className="m-0 text-[10px]">
          Scanned
        </Tag>
      )}
      <FileTextOutlined className="text-ink-400 text-xs" />
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
    <Card
      size="small"
      className="border-edge bg-surface/70 shadow-sm"
      title={<span className="text-xs font-semibold text-ink-700">Workflow Lifecycle</span>}
    >
      <Steps
        aria-label="Email workflow lifecycle"
        className="mt-1"
        size="small"
        responsive
        items={steps.map((step) => ({
          title: step.label,
          status: step.state === "done" ? "finish" : step.state === "current" ? "process" : "wait",
        }))}
      />
    </Card>
  );
}
