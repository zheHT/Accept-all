"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  FileSearchOutlined,
  FileTextOutlined,
  MailOutlined,
  ReloadOutlined,
  ScanOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { Button, Card, Drawer, Progress, Table, Tag, type TableColumnsType } from "antd";
import { cn } from "@/lib/cn";
import { StatusChip } from "@/components/status-chip";
import { DocumentComparison } from "@/components/ui/document-comparison";
import { getCase } from "@/lib/api";
import { reviewDetail } from "@/lib/live-view-models";
import type { ReviewCase } from "@/lib/review-data";
import { DocumentPreview, type PreviewDocument } from "@/components/ui/document-preview";
import { useToast } from "@/components/ui/toast";
import { REQUIRED_FIELDS, type FieldComparison, type FieldResult, type VerificationCase } from "@/lib/case-data";

const FIELD_RESULT_TAG: Record<FieldResult, { color: string; label: string }> = {
  match: { color: "success", label: "Match" },
  mismatch: { color: "error", label: "Mismatch" },
  uncertain: { color: "warning", label: "Uncertain" },
  missing: { color: "volcano", label: "Missing" },
  pending: { color: "processing", label: "Pending" },
};

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
  const [comparisonCase, setComparisonCase] = useState<ReviewCase | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  const openComparison = async () => {
    if (!verificationCase) return;
    setComparisonLoading(true);
    try {
      const detail = await getCase(verificationCase.id);
      setComparisonCase(reviewDetail(detail));
    } catch (error) {
      toast({
        title: "Document comparison is unavailable",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setComparisonLoading(false);
    }
  };

  if (!verificationCase) return null;

  const item = verificationCase;
  const mismatches = item.fields.filter((field) => field.result === "mismatch");
  const unresolved = item.fields.filter(
    (field) => field.result === "uncertain" || field.result === "missing",
  );

  const fieldColumns: TableColumnsType<FieldComparison> = [
    {
      title: "FIELD",
      dataIndex: "field",
      key: "field",
      width: 170,
      render: (text: string, record: FieldComparison) => (
        <div>
          <span className="font-semibold text-xs text-ink-900">{text}</span>
          {record.note && (
            <span className="block text-[11px] text-ink-400 mt-0.5 leading-tight">{record.note}</span>
          )}
        </div>
      ),
    },
    {
      title: "SHIPPING INSTRUCTION",
      dataIndex: "si",
      key: "si",
      render: (val?: string | null) => (
        <span className="text-xs text-ink-700">{val ?? <span className="text-ink-300">—</span>}</span>
      ),
    },
    {
      title: "BILL OF LADING",
      dataIndex: "bl",
      key: "bl",
      render: (val?: string | null, record?: FieldComparison) => {
        const isMismatch = record?.result === "mismatch";
        const isUncertain = record?.result === "uncertain";
        if (!val) return <span className="text-ink-300">—</span>;
        return (
          <span
            className={cn(
              "inline-block text-xs rounded px-1.5 py-0.5",
              isMismatch
                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 font-medium"
                : isUncertain
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-medium"
                  : "text-ink-700",
            )}
          >
            {val}
          </span>
        );
      },
    },
    {
      title: "RESULT",
      dataIndex: "result",
      key: "result",
      align: "right",
      width: 100,
      render: (val: FieldResult) => {
        const meta = FIELD_RESULT_TAG[val];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
  ];

  return (
    <>
      <Drawer
        open={Boolean(verificationCase)}
        onClose={onClose}
        width={780}
        title={
          <div className="flex flex-col gap-1 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-ink-400">{item.caseId}</span>
              <StatusChip status={item.result} />
              {item.documents.bl?.scanned && (
                <Tag color="warning" icon={<ScanOutlined />}>
                  Scanned B/L
                </Tag>
              )}
            </div>
            <h2 className="text-lg font-bold text-ink-900 tracking-tight">{item.shipment}</h2>
            <p className="text-xs text-ink-400">
              {item.carrierRef ? `Carrier reference ${item.carrierRef} · ` : ""}
              Updated {item.updated.toLowerCase()}
            </p>
          </div>
        }
        footer={
          <div className="flex items-center justify-between py-1">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => onRetry(item.id)}
            >
              Reprocess Case
            </Button>
            {item.result === "needs_review" ? (
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                onClick={() => {
                  onClose();
                  router.push(`/review?case=${item.id}`);
                }}
              >
                Go to Review Queue
              </Button>
            ) : (
              <Button type="default" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {/* Verdict Card */}
          <VerdictCard item={item} mismatchCount={mismatches.length} unresolvedCount={unresolved.length} />

          {/* Source & Docs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card size="small" title={<span className="text-xs font-semibold text-ink-700">Source Email</span>} className="border-edge bg-surface/70">
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex items-start gap-1.5 font-medium text-ink-900">
                  <MailOutlined className="text-ink-400 mt-0.5" />
                  <span>{item.sourceEmailSubject}</span>
                </div>
                <div className="text-ink-500 pl-5">{item.sourceEmailSender}</div>
                <div className="text-ink-400 pl-5 text-[11px]">{item.sourceEmailReceived}</div>
              </div>
            </Card>

            <Card size="small" title={<span className="text-xs font-semibold text-ink-700">Documents</span>} className="border-edge bg-surface/70">
              <div className="flex flex-col gap-2">
                {(["SI", "BL"] as const).map((role) => {
                  const file = role === "SI" ? item.documents.si : item.documents.bl;
                  if (!file) return null;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => void openComparison()}
                      className="flex items-center gap-2 rounded-lg border border-line bg-surface/80 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-brand-300 hover:bg-surface"
                    >
                      <Tag color="blue" className="font-mono text-[10px] m-0">
                        {role}
                      </Tag>
                      <span className="flex-1 truncate font-medium text-ink-700">{file.name}</span>
                      <FileTextOutlined className="text-ink-400 text-xs" />
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <Button
            type="dashed"
            block
            icon={<FileSearchOutlined />}
            loading={comparisonLoading}
            onClick={() => void openComparison()}
          >
            Compare Source Documents (SI vs BL)
          </Button>

          {/* Field-by-Field Comparison Table */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-400">
                  Field-by-field comparison
                </h4>
                <p className="text-xs text-ink-500 mt-0.5">
                  {item.fieldsChecked === null
                    ? "No fields could be compared"
                    : `${item.fieldsChecked} of ${REQUIRED_FIELDS.length} required fields checked`}
                </p>
              </div>
              {item.confidence > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-400">Confidence:</span>
                  <Progress
                    percent={Math.round(item.confidence * 100)}
                    size="small"
                    style={{ width: 100 }}
                  />
                </div>
              )}
            </div>

            <Table<FieldComparison>
              rowKey="field"
              size="small"
              columns={fieldColumns}
              dataSource={item.fields}
              pagination={false}
              bordered
            />
          </div>
        </div>
      </Drawer>

      {/* Embedded Document Comparison Modal */}
      {comparisonCase && (
        <DocumentComparison
          si={comparisonCase.si}
          bl={comparisonCase.bl}
          problemField={comparisonCase.problemField}
          open={Boolean(comparisonCase)}
          onClose={() => setComparisonCase(null)}
          heading={`${item.shipment} · ${comparisonCase.problemField}`}
        />
      )}

      {/* Document Preview */}
      {preview && (
        <DocumentPreview document={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}

function VerdictCard({
  item,
  mismatchCount,
  unresolvedCount = 0,
}: {
  item: VerificationCase;
  mismatchCount: number;
  unresolvedCount?: number;
}) {
  if (item.result === "matched") {
    return (
      <Card size="small" className="border-matched-200 bg-matched-50/70">
        <div className="flex items-start gap-3">
          <CheckCircleFilled className="text-xl text-matched-500 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-matched-700">Documents Match</h3>
            <p className="text-xs text-ink-700 mt-1 leading-relaxed">
              All checked fields in the draft Bill of Lading match the customer&apos;s Shipping Instructions.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (item.result === "mismatch") {
    return (
      <Card size="small" className="border-mismatch-200 bg-mismatch-50/70">
        <div className="flex items-start gap-3">
          <CloseCircleFilled className="text-xl text-mismatch-500 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-mismatch-700">
              Discrepancies Detected ({mismatchCount})
            </h3>
            <p className="text-xs text-ink-700 mt-1 leading-relaxed">
              {item.issue ?? "Differences found between Shipping Instructions and draft Bill of Lading."}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (item.result === "needs_review") {
    return (
      <Card size="small" className="border-review-200 bg-review-50/70">
        <div className="flex items-start gap-3">
          <ExclamationCircleFilled className="text-xl text-review-500 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-review-700">
              Human Review Required {unresolvedCount > 0 ? `(${unresolvedCount})` : ""}
            </h3>
            <p className="text-xs text-ink-700 mt-1 leading-relaxed">
              {item.issue ?? "Automated verification flagged ambiguous fields that require specialist verification."}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card size="small" className="border-failed-200 bg-failed-50/70">
      <div className="flex items-start gap-3">
        <WarningFilled className="text-xl text-failed-500 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-failed-700">Processing Failed</h3>
          <p className="text-xs text-ink-700 mt-1 leading-relaxed">
            {item.issue ?? "The verification engine encountered an unrecoverable extraction fault."}
          </p>
        </div>
      </div>
    </Card>
  );
}
