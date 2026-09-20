"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightOutlined,
  ClearOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import { Button, Card, Empty, Input, Select, Skeleton, Table, Tag, Tooltip, type TableColumnsType } from "antd";
import { cn } from "@/lib/cn";
import { StatusChip } from "@/components/status-chip";
import { StatBar, type StatSegment } from "@/components/ui/stat-bar";
import { useToast } from "@/components/ui/toast";
import { ErrorState, StaleNotice } from "@/components/ui/live-state";
import { CaseDrawer } from "./case-drawer";
import { type VerificationCase } from "@/lib/case-data";
import { type VerificationStatus } from "@/lib/status";
import { readParam, writeParam } from "@/lib/url-state";
import { ApiError, getCase, getCases, retryCase as retryApiCase } from "@/lib/api";
import { caseDetail, caseSummary } from "@/lib/live-view-models";
import { useLiveQuery } from "@/lib/use-live-query";

type ResultFilter = "all" | VerificationStatus;
type WorkflowFilter = "all" | "open" | "in_review" | "resolved";
type DateFilter = "all" | "today" | "week";
type SortOrder = "newest" | "oldest";

const RESULT_OPTIONS: Array<{ value: ResultFilter; label: string }> = [
  { value: "all", label: "All Results" },
  { value: "matched", label: "Matched" },
  { value: "mismatch", label: "Mismatch" },
  { value: "needs_review", label: "Needs Review" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

const WORKFLOW_OPTIONS: Array<{ value: WorkflowFilter; label: string }> = [
  { value: "all", label: "All Status" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In Review" },
  { value: "resolved", label: "Resolved" },
];

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "All Dates" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
];

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

export function CasesView() {
  const router = useRouter();
  const toast = useToast();
  const liveCases = useLiveQuery((signal) => getCases(signal), []);

  const [cases, setCases] = useState<VerificationCase[]>([]);
  const [result, setResult] = useState<ResultFilter>("all");
  const [workflow, setWorkflow] = useState<WorkflowFilter>("all");
  const [date, setDate] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [query, setQuery] = useState("");
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  useEffect(() => {
    if (liveCases.data) setCases(liveCases.data.items.map(caseSummary));
  }, [liveCases.data]);

  useEffect(() => {
    const requestedCase = readParam("case");
    if (requestedCase && liveCases.data?.items.some((item) => item.case_id === requestedCase)) {
      setOpenCaseId(requestedCase);
      void getCase(requestedCase)
        .then((detail) => {
          setCases((current) =>
            current.some((item) => item.id === requestedCase)
              ? current.map((item) => (item.id === requestedCase ? caseDetail(detail) : item))
              : [caseDetail(detail), ...current],
          );
        })
        .catch(() => {});
    }
    const requestedResult = readParam("result");
    if (requestedResult && RESULT_OPTIONS.some((option) => option.value === requestedResult)) {
      setResult(requestedResult as ResultFilter);
    }
  }, [liveCases.data]);

  const changeResult = useCallback((next: ResultFilter) => {
    setResult(next);
    writeParam("result", next === "all" ? null : next);
  }, []);

  const openCase = useCallback(
    (item: VerificationCase) => {
      setOpenCaseId(item.id);
      writeParam("case", item.id);
      void getCase(item.id)
        .then((detail) =>
          setCases((current) =>
            current.map((entry) => (entry.id === item.id ? caseDetail(detail) : entry)),
          ),
        )
        .catch((error: unknown) =>
          toast({
            title: "Case detail is temporarily unavailable",
            description: error instanceof Error ? error.message : "Please retry.",
            tone: "warning",
          }),
        );
    },
    [toast],
  );

  const closeCase = useCallback(() => {
    setOpenCaseId(null);
    writeParam("case", null);
  }, []);

  const retryCase = useCallback(
    async (id: string) => {
      const source = liveCases.data?.items.find((item) => item.case_id === id);
      if (!source) return;
      try {
        await retryApiCase(source);
        await liveCases.refresh();
        setOpenCaseId(null);
        toast({
          title: `Reprocessing ${id}`,
          description: "The case was safely queued for another processing pass.",
          tone: "info",
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) await liveCases.refresh();
        toast({
          title:
            error instanceof ApiError && error.status === 409
              ? "Case changed while it was open"
              : "Retry failed",
          description:
            error instanceof ApiError && error.status === 409
              ? "The live case was refreshed. Please review it and repeat the action."
              : error instanceof Error
                ? error.message
                : "Please retry.",
          tone: "warning",
        });
      }
    },
    [liveCases, toast],
  );

  const reviewCase = useCallback(
    (item: VerificationCase) => {
      router.push(`/review?case=${item.id}`);
    },
    [router],
  );

  const filtersActive =
    query.trim() !== "" ||
    result !== "all" ||
    workflow !== "all" ||
    date !== "all" ||
    sort !== "newest";

  const clearFilters = () => {
    setQuery("");
    setWorkflow("all");
    setDate("all");
    setSort("newest");
    changeResult("all");
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = cases.filter((item) => {
      if (result !== "all" && item.result !== result) return false;
      if (workflow !== "all" && item.workflow !== workflow) return false;
      if (date !== "all" && item.dateBucket !== date) return false;
      if (!needle) return true;
      return [
        item.caseId,
        item.shipment,
        item.carrierRef ?? "",
        item.sourceEmailSubject,
        item.issue ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    return filtered.sort((a, b) =>
      sort === "oldest" ? b.updatedOrder - a.updatedOrder : a.updatedOrder - b.updatedOrder,
    );
  }, [cases, query, result, workflow, date, sort]);

  const attention = useMemo(() => {
    const unresolved = cases
      .filter((item) => item.workflow !== "resolved")
      .sort((a, b) => a.updatedOrder - b.updatedOrder);

    const picked: VerificationCase[] = [];
    for (const res of ["needs_review", "mismatch", "failed"] as const) {
      const match = unresolved.find((item) => item.result === res);
      if (match) picked.push(match);
    }
    return picked;
  }, [cases]);

  const summarySegments = useMemo<StatSegment[]>(() => {
    const total = cases.length;
    const count = (status: VerificationStatus) =>
      cases.filter((item) => item.result === status).length;
    const segment = (
      id: string,
      label: string,
      value: number,
      support: string,
      accent: string,
    ): StatSegment => ({
      id,
      label,
      value,
      support,
      accent,
      share: total ? Math.round((value / total) * 100) : 0,
    });
    return [
      segment("all", "All Cases", total, "Verification cases", "bg-brand-500"),
      segment("matched", "Matched", count("matched"), "No mismatch detected", "bg-matched-500"),
      segment("mismatch", "Mismatch", count("mismatch"), "Discrepancy detected", "bg-mismatch-500"),
      segment(
        "needs_review",
        "Needs Review",
        count("needs_review"),
        "Human verification required",
        "bg-review-500",
      ),
    ];
  }, [cases]);

  const activeCase = openCaseId ? (cases.find((item) => item.id === openCaseId) ?? null) : null;

  if (liveCases.loading && !liveCases.data) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="shadow-sm border-edge bg-surface/80" styles={{ body: { padding: "24px" } }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </div>
    );
  }
  if (liveCases.error && !liveCases.data) {
    return <ErrorState message={liveCases.error} retry={() => void liveCases.refresh()} />;
  }

  const columns: TableColumnsType<VerificationCase> = [
    {
      title: "CASE",
      dataIndex: "caseId",
      key: "caseId",
      width: 100,
      render: (text: string) => <span className="font-mono text-xs text-ink-400">{text}</span>,
    },
    {
      title: "SHIPMENT",
      key: "shipment",
      render: (_, item) => (
        <div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openCase(item);
            }}
            className="text-left font-semibold text-ink-900 hover:text-brand-600 transition-colors"
          >
            {item.shipment}
          </button>
          {item.carrierRef && (
            <span className="block font-mono text-[11px] text-ink-400 mt-0.5">{item.carrierRef}</span>
          )}
        </div>
      ),
    },
    {
      title: "SOURCE EMAIL",
      key: "email",
      render: (_, item) => (
        <div className="max-w-[200px]">
          <span className="block truncate text-xs font-medium text-ink-700">
            {item.sourceEmailSubject}
          </span>
          <span className="block truncate text-[11px] text-ink-400 mt-0.5">
            {item.sourceEmailSender}
          </span>
        </div>
      ),
    },
    {
      title: "DOCS",
      key: "docs",
      width: 90,
      render: () => (
        <div className="flex items-center gap-1 font-mono text-[10px]">
          <Tag color="default" className="m-0 px-1 py-0 font-mono">
            SI
          </Tag>
          <span className="text-ink-400">+</span>
          <Tag color="default" className="m-0 px-1 py-0 font-mono">
            BL
          </Tag>
        </div>
      ),
    },
    {
      title: "RESULT",
      dataIndex: "result",
      key: "result",
      width: 130,
      render: (status: VerificationStatus) => <StatusChip status={status} />,
    },
    {
      title: "ISSUE",
      key: "issue",
      render: (_, item) => (
        item.issue ? (
          <Tooltip title={item.issueContext}>
            <div className="cursor-help max-w-[220px]">
              <span
                className={cn(
                  "block text-xs font-semibold truncate",
                  item.result === "mismatch" && "text-mismatch-700",
                  item.result === "needs_review" && "text-review-700",
                  item.result === "failed" && "text-failed-700",
                  item.result === "processing" && "text-processing-700",
                )}
              >
                {item.issue}
              </span>
              {item.issueDetail && (
                <span className="block truncate font-mono text-[10px] text-ink-400 mt-0.5">
                  {item.issueDetail}
                </span>
              )}
            </div>
          </Tooltip>
        ) : (
          <span className="text-xs text-ink-300">—</span>
        )
      ),
    },
    {
      title: "UPDATED",
      dataIndex: "updated",
      key: "updated",
      width: 110,
      render: (val: string) => <span className="text-xs text-ink-500">{val}</span>,
    },
    {
      title: "ACTION",
      key: "action",
      align: "right",
      width: 110,
      render: (_, item) => {
        if (item.action === "review") {
          return (
            <Button
              type="primary"
              size="small"
              icon={<SolutionOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                reviewCase(item);
              }}
              style={{ backgroundColor: "#faad14" }}
            >
              Review
            </Button>
          );
        }
        if (item.action === "retry") {
          return (
            <Button
              danger
              size="small"
              icon={<ReloadOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                void retryCase(item.id);
              }}
            >
              Retry
            </Button>
          );
        }
        return (
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              openCase(item);
            }}
          >
            View
          </Button>
        );
      },
    },
  ];

  return (
    <>
      {liveCases.stale && <StaleNotice />}

      {/* Top Stat Bar */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink-900">
          Overview — select a status to filter
        </h2>
        <StatBar
          segments={summarySegments}
          activeId={result}
          onSelect={(id) =>
            changeResult(id === result && id !== "all" ? "all" : (id as ResultFilter))
          }
        />
      </section>

      {/* Attention Required Cards */}
      {attention.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-semibold tracking-tight text-ink-900">Attention required</h2>
            <span className="text-xs text-ink-400">
              {attention.length} unresolved case{attention.length === 1 ? "" : "s"} ranked by impact
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {attention.map((item) => (
              <Card
                key={item.id}
                size="small"
                className={cn(
                  "border-edge bg-surface/80 shadow-sm",
                  item.result === "mismatch" && "border-mismatch-200",
                  item.result === "needs_review" && "border-review-200",
                  item.result === "failed" && "border-failed-200",
                )}
                styles={{ body: { display: "flex", flexDirection: "column", gap: "12px", height: "100%" } }}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openCase(item)}
                    className="font-bold text-sm text-ink-900 hover:text-brand-600 transition-colors cursor-pointer"
                  >
                    {item.shipment}
                  </button>
                  <StatusChip status={item.result} />
                </div>

                <div className="flex-1">
                  <p className="text-xs font-semibold text-ink-800">
                    {item.result === "mismatch"
                      ? `${item.fields.filter((f) => f.result === "mismatch").length} discrepancy detected — ${item.issue}`
                      : item.result === "needs_review"
                        ? `Human review required — ${item.issue}`
                        : `Processing failed — ${item.issue}`}
                  </p>
                  {item.issueDetail && (
                    <p className="font-mono text-[11px] text-ink-500 mt-1">{item.issueDetail}</p>
                  )}
                </div>

                <Button
                  type={item.result === "needs_review" ? "primary" : "default"}
                  block
                  icon={<ArrowRightOutlined />}
                  onClick={() =>
                    item.result === "needs_review" ? reviewCase(item) : openCase(item)
                  }
                  style={item.result === "needs_review" ? { backgroundColor: "#faad14" } : undefined}
                >
                  {item.result === "needs_review" ? "Review Case" : "Open Case"}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Filter and Search Bar */}
      <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "16px 20px" } }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            placeholder="Search shipment, case ID, or email subject..."
            prefix={<SearchOutlined className="text-ink-400" />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
            allowClear
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select
              style={{ width: 130 }}
              value={result}
              options={RESULT_OPTIONS}
              onChange={changeResult}
            />
            <Select
              style={{ width: 120 }}
              value={workflow}
              options={WORKFLOW_OPTIONS}
              onChange={setWorkflow}
            />
            <Select
              style={{ width: 120 }}
              value={date}
              options={DATE_OPTIONS}
              onChange={setDate}
            />
            <Select
              style={{ width: 140 }}
              value={sort}
              options={SORT_OPTIONS}
              onChange={setSort}
            />
            <Button
              icon={<ReloadOutlined className={cn(liveCases.loading && "animate-spin")} />}
              onClick={() => void liveCases.refresh()}
              disabled={liveCases.loading}
            >
              Refresh
            </Button>
            <Button
              icon={<ClearOutlined />}
              onClick={clearFilters}
              disabled={!filtersActive}
            >
              Clear
            </Button>
          </div>
        </div>
      </Card>

      {/* Main Cases Table */}
      <Card
        className="border-edge bg-surface/80 shadow-sm overflow-hidden"
        styles={{
          header: { padding: "16px 24px" },
          body: { padding: 0 },
        }}
        title={
          <div>
            <h2 className="text-base font-bold text-ink-900">Verification Cases</h2>
            <p className="text-xs font-normal text-ink-500 mt-0.5">
              Document comparison requests processed by the verification engine.
            </p>
          </div>
        }
        extra={
          <span className="text-xs text-ink-400">
            {rows.length} of {cases.length} cases
          </span>
        }
      >
        <Table<VerificationCase>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ["10", "25", "50"],
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} cases`,
          }}
          onRow={(record) => ({
            onClick: () => openCase(record),
            className: "cursor-pointer hover:bg-surface/90 transition-colors",
          })}
          locale={{
            emptyText: (
              <div className="py-12 text-center">
                <Empty description={<span className="text-ink-500">No cases match these filters.</span>}>
                  <Button type="primary" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                </Empty>
              </div>
            ),
          }}
        />
      </Card>

      {/* Case Detail Drawer */}
      <CaseDrawer
        verificationCase={activeCase}
        onClose={closeCase}
        onRetry={retryCase}
      />
    </>
  );
}
