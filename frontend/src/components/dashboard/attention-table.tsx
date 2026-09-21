"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightOutlined,
  ReloadOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Button, Card, Empty, Progress, Segmented, Skeleton, Table, Tag, type TableColumnsType } from "antd";
import { cn } from "@/lib/cn";
import { ErrorState, StaleNotice } from "@/components/ui/live-state";
import { useWorkspaceCounts } from "@/components/workspace/workspace-counts";
import { attentionRow } from "@/lib/live-view-models";
import { type CaseRow } from "@/lib/dashboard-data";
import type { VerificationStatus } from "@/lib/status";
import { readParam, writeParam } from "@/lib/url-state";

type CaseFilter = "all" | Extract<VerificationStatus, "mismatch" | "needs_review" | "failed">;

const FILTERS: Array<{ id: CaseFilter; label: string }> = [
  { id: "all", label: "All open" },
  { id: "mismatch", label: "Mismatch" },
  { id: "needs_review", label: "Needs Review" },
  { id: "failed", label: "Failed" },
];

const STATUS_TAG_PROPS: Record<
  CaseRow["status"],
  { color: "error" | "warning" | "red" | "processing" | "success"; label: string }
> = {
  mismatch: { color: "error", label: "Mismatch" },
  needs_review: { color: "warning", label: "Needs Review" },
  failed: { color: "red", label: "Failed" },
  processing: { color: "processing", label: "Processing" },
  matched: { color: "success", label: "Matched" },
};

export function AttentionTable() {
  const router = useRouter();
  const [filter, setFilter] = useState<CaseFilter>("all");
  const { dashboard: query } = useWorkspaceCounts();

  const attentionCases = useMemo(
    () => (query.data?.attention_items || []).map(attentionRow),
    [query.data],
  );

  const openCase = (row: CaseRow) =>
    router.push(row.status === "needs_review" ? `/review?case=${row.id}` : `/cases?case=${row.id}`);

  useEffect(() => {
    const requested = readParam("cases");
    if (requested && FILTERS.some((f) => f.id === requested)) {
      setFilter(requested as CaseFilter);
    }
  }, []);

  const changeFilter = (next: CaseFilter) => {
    setFilter(next);
    writeParam("cases", next === "all" ? null : next);
  };

  const counts = useMemo(() => {
    const byStatus = (status: CaseFilter) =>
      status === "all"
        ? attentionCases.length
        : attentionCases.filter((row) => row.status === status).length;
    return Object.fromEntries(FILTERS.map(({ id }) => [id, byStatus(id)])) as Record<
      CaseFilter,
      number
    >;
  }, [attentionCases]);

  const rows = useMemo(
    () => (filter === "all" ? attentionCases : attentionCases.filter((row) => row.status === filter)),
    [attentionCases, filter],
  );

  if (query.loading && !query.data) {
    return (
      <Card className="shadow-sm border-edge bg-surface/80" styles={{ body: { padding: "24px" } }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }
  if (query.error && !query.data) {
    return <ErrorState message={query.error} retry={() => void query.refresh()} />;
  }

  const columns: TableColumnsType<CaseRow> = [
    {
      title: "SHIPMENT",
      key: "shipment",
      render: (_, record) => (
        <div>
          <span className="font-mono text-[13px] font-medium tracking-tight text-ink-900">
            {record.reference}
          </span>
          <span className="mt-0.5 block max-w-[200px] truncate text-[12px] text-ink-500">
            {record.counterparty}
          </span>
        </div>
      ),
    },
    {
      title: "SOURCE CONTEXT",
      key: "source",
      render: (_, record) => (
        <div>
          <span className="text-[13px] font-medium text-ink-700">Gmail</span>
          <span className="mt-0.5 block max-w-[220px] truncate text-[12px] text-ink-400">
            {record.vessel}
          </span>
        </div>
      ),
    },
    {
      title: "STATUS",
      key: "status",
      width: 140,
      render: (_, record) => {
        const meta = STATUS_TAG_PROPS[record.status];
        return (
          <Tag color={meta.color} className="font-medium">
            {meta.label}
          </Tag>
        );
      },
    },
    {
      title: "FINDINGS",
      key: "findings",
      render: (_, record) => (
        record.flaggedFields.length === 0 ? (
          <span className="text-xs text-ink-300">Awaiting extraction</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {record.flaggedFields.map((field) => (
              <Tag key={field} variant="filled" color={record.status === "mismatch" ? "volcano" : "gold"}>
                {field}
              </Tag>
            ))}
          </div>
        )
      ),
    },
    {
      title: "CONFIDENCE",
      key: "confidence",
      width: 130,
      render: (_, record) => (
        <div className="flex items-center gap-2">
          <Progress
            percent={Math.round(record.confidence * 100)}
            size="small"
            showInfo={false}
            strokeColor={
              record.confidence >= 0.9
                ? "#52c41a"
                : record.confidence >= 0.7
                  ? "#1677ff"
                  : "#faad14"
            }
          />
          <span className="text-xs font-semibold tabular text-ink-700">
            {Math.round(record.confidence * 100)}%
          </span>
        </div>
      ),
    },
    {
      title: "RECEIVED",
      dataIndex: "received",
      key: "received",
      align: "right",
      width: 120,
      render: (val: string) => <span className="text-xs text-ink-500">{val}</span>,
    },
    {
      title: "",
      key: "action",
      width: 40,
      render: () => <RightOutlined className="text-xs text-ink-300" />,
    },
  ];

  return (
    <Card
      className="shadow-sm border-edge bg-surface/80 backdrop-blur overflow-hidden"
      styles={{
        body: { padding: 0 },
        header: { padding: "16px 24px" },
      }}
      title={
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
            Cases requiring attention
          </h2>
          <p className="mt-0.5 text-[12px] font-normal text-ink-500">
            Ranked by discrepancy severity, then by documentation cut-off.
          </p>
        </div>
      }
      extra={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            icon={<ReloadOutlined className={cn(query.loading && "animate-spin")} />}
            onClick={() => void query.refresh()}
            disabled={query.loading}
          >
            Refresh
          </Button>
          <Segmented
            size="small"
            value={filter}
            options={FILTERS.map((f) => ({
              label: (
                <span className="flex items-center gap-1">
                  {f.label}
                  <span className="text-[10px] font-semibold opacity-75">({counts[f.id]})</span>
                </span>
              ),
              value: f.id,
            }))}
            onChange={(val) => changeFilter(val as CaseFilter)}
          />
        </div>
      }
    >
      {query.stale && <div className="px-6 pt-3"><StaleNotice /></div>}

      <Table<CaseRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        onRow={(record) => ({
          onClick: () => openCase(record),
          className: "cursor-pointer hover:bg-surface/90 transition-colors",
        })}
        locale={{
          emptyText: (
            <div className="py-12 text-center">
              <Empty
                description={
                  <span className="text-ink-500 text-sm">
                    No cases flagged as {FILTERS.find((f) => f.id === filter)?.label}.
                  </span>
                }
              />
            </div>
          ),
        }}
      />

      <div className="flex items-center justify-between border-t border-line px-6 py-3.5 bg-surface/40">
        <span className="text-xs text-ink-400">
          Showing {rows.length} of {query.data?.metrics.unresolved ?? rows.length} open cases
        </span>
        <Link
          href="/cases"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
        >
          View all verification cases
          <ArrowRightOutlined className="text-[10px]" />
        </Link>
      </div>
    </Card>
  );
}
