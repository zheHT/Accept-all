"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClearOutlined,
  ReloadOutlined,
  SearchOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import { Button, Card, Empty, Input, Progress, Select, Skeleton, Table, Tag, Tooltip, type TableColumnsType } from "antd";
import { cn } from "@/lib/cn";
import { StatBar, type StatSegment } from "@/components/ui/stat-bar";
import { useToast } from "@/components/ui/toast";
import { ErrorState, StaleNotice } from "@/components/ui/live-state";
import { ReviewDetail } from "./review-detail";
import {
  REVIEW_REASON_LABELS,
  type ReviewCase,
  type ReviewDecision,
  type ReviewReasonCode,
} from "@/lib/review-data";
import { readParam, writeParam } from "@/lib/url-state";
import {
  ApiError,
  confirmSentDraft,
  getCase,
  getReviews,
  prepareDraft,
  reviewField,
  reviewCase as reviewApiCase,
  sendDraft,
  updateDraft,
  type CaseDetail,
} from "@/lib/api";
import { reviewDetail, reviewSummary } from "@/lib/live-view-models";
import { useLiveQuery } from "@/lib/use-live-query";

type ReasonFilter = "all" | ReviewReasonCode;
type GroupFilter = "none" | "pending" | "unreadable_missing" | "ambiguous";
type SortOrder = "oldest" | "newest";

const REASON_OPTIONS: Array<{ value: ReasonFilter; label: string }> = [
  { value: "all", label: "All Reasons" },
  ...(Object.keys(REVIEW_REASON_LABELS) as ReviewReasonCode[]).map((value) => ({
    value,
    label: REVIEW_REASON_LABELS[value],
  })),
];

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  { value: "oldest", label: "Oldest First" },
  { value: "newest", label: "Newest First" },
];

const GROUP_REASONS: Record<Exclude<GroupFilter, "none" | "pending">, ReviewReasonCode[]> = {
  unreadable_missing: ["unreadable_document", "missing_information"],
  ambiguous: ["ambiguous_value", "low_confidence", "processing_issue"],
};

export function ReviewView() {
  const toast = useToast();
  const liveReviews = useLiveQuery((signal) => getReviews(signal), []);
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<CaseDetail | null>(null);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState<ReasonFilter>("all");
  const [group, setGroup] = useState<GroupFilter>("none");
  const [sort, setSort] = useState<SortOrder>("oldest");
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [isConfirmingSent, setIsConfirmingSent] = useState(false);

  useEffect(() => {
    if (!liveReviews.data) return;
    const incoming = liveReviews.data.items.map(reviewSummary);
    setCases((current) => {
      const activeResolved = current.find((item) => item.id === openId && item.status === "resolved");
      const currentActiveDetail = current.find(
        (item) => item.id === openId && item.comparisonFields?.length,
      );
      const merged = incoming.map((item) =>
        item.id === currentActiveDetail?.id ? currentActiveDetail : item,
      );
      return activeResolved && !merged.some((item) => item.id === activeResolved.id)
        ? [activeResolved, ...merged]
        : merged;
    });
  }, [liveReviews.data, openId]);

  useEffect(() => {
    const requested = readParam("case");
    if (requested && liveReviews.data?.items.some((item) => item.case_id === requested)) {
      setOpenId(requested);
      void getCase(requested)
        .then((detail) => {
          setActiveDetail(detail);
          setCases((current) =>
            current.some((item) => item.id === requested)
              ? current.map((item) => (item.id === requested ? reviewDetail(detail) : item))
              : [reviewDetail(detail), ...current],
          );
        })
        .catch(() => {});
    }
  }, [liveReviews.data]);

  const openCase = useCallback(
    (item: ReviewCase) => {
      setOpenId(item.id);
      setActiveDetail(null);
      writeParam("case", item.id);
      void getCase(item.id)
        .then((detail) => {
          setActiveDetail(detail);
          setCases((current) =>
            current.map((entry) => (entry.id === item.id ? reviewDetail(detail) : entry)),
          );
        })
        .catch((error: unknown) =>
          toast({
            title: "Review evidence is temporarily unavailable",
            description: error instanceof Error ? error.message : "Please retry.",
            tone: "warning",
          }),
        );
    },
    [toast],
  );

  const closeCase = useCallback(() => {
    setOpenId(null);
    setActiveDetail(null);
    writeParam("case", null);
    void liveReviews.refresh();
  }, [liveReviews]);

  const submitDecision = useCallback(
    async (id: string, decision: ReviewDecision) => {
      const source =
        activeDetail?.case_id === id
          ? activeDetail
          : liveReviews.data?.items.find((item) => item.case_id === id);
      if (!source) return;
      const field =
        decision.field ||
        source.low_confidence_fields[0] ||
        source.defect_fields[0] ||
        activeDetail?.comparisons[0]?.field;
      if (!field) return;
      const note = decision.notes;
      try {
        const updated = await reviewField(
          source.case_id,
          field,
          source.version,
          decision.type,
          note,
          decision.type === "correct" ? decision.value || undefined : undefined,
          decision.documentRole || "BL",
        );
        setActiveDetail(updated);
        setCases((current) => current.map((item) => (item.id === id ? reviewDetail(updated) : item)));
        await liveReviews.refresh();
        toast({
          title: `${field} decision saved`,
          description:
            decision.type === "unreadable"
              ? "The field remains visible as unresolved for follow-up."
              : "The structured review decision was recorded; the case verdict is unchanged.",
          tone: "success",
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const refreshed = await getCase(id);
          setActiveDetail(refreshed);
          setCases((current) => current.map((item) => (item.id === id ? reviewDetail(refreshed) : item)));
          await liveReviews.refresh();
        }
        toast({
          title: error instanceof ApiError && error.status === 409 ? "Case changed while it was open" : "Field review failed",
          description:
            error instanceof ApiError && error.status === 409
              ? "The queue was refreshed. Please inspect the case and repeat the action."
              : error instanceof Error
                ? error.message
                : "Please retry.",
          tone: "warning",
        });
      }
    },
    [activeDetail, liveReviews, toast],
  );

  const finalizeCase = useCallback(async () => {
    if (!activeDetail || (activeDetail.unresolved_fields?.length ?? 1) > 0) return;
    try {
      await reviewApiCase(activeDetail, "APPROVE", "All structured field reviews completed.");
      const refreshed = await getCase(activeDetail.case_id);
      setActiveDetail(refreshed);
      setCases((current) =>
        current.map((item) => (item.id === activeDetail.case_id ? reviewDetail(refreshed) : item)),
      );
      await liveReviews.refresh();
      toast({
        title: "Case finalized",
        description: "The verification result was approved after all field reviews were completed.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title:
          error instanceof ApiError && error.status === 404
            ? "Route not found (backend version mismatch)"
            : "Case finalization failed",
        description: error instanceof Error ? error.message : "Resolve every field and retry.",
        tone: "warning",
      });
    }
  }, [activeDetail, liveReviews, toast]);

  const saveDraft = useCallback(
    async (subject: string, body: string) => {
      if (!activeDetail) return;
      try {
        const updated = await updateDraft(
          activeDetail.case_id,
          activeDetail.version,
          subject,
          body,
        );
        setActiveDetail(updated);
        toast({ title: "Correction draft saved", tone: "success" });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const refreshed = await getCase(activeDetail.case_id);
          setActiveDetail(refreshed);
        }
        toast({
          title:
            error instanceof ApiError && error.status === 409
              ? "Draft changed while it was open"
              : "Draft save failed",
          description:
            error instanceof ApiError && error.status === 409
              ? "The latest draft was loaded. Review it and repeat your edit."
              : error instanceof Error
                ? error.message
                : "Please retry.",
          tone: "warning",
        });
      }
    },
    [activeDetail, toast],
  );

  const deliverDraft = useCallback(async () => {
    if (!activeDetail?.draft) return;
    try {
      const updated = await sendDraft(
        activeDetail.case_id,
        activeDetail.version,
        activeDetail.draft.content_hash,
      );
      setActiveDetail(updated);
      setCases((current) =>
        current.map((item) => (item.id === activeDetail.case_id ? reviewDetail(updated) : item)),
      );
      await liveReviews.refresh();
      toast({
        title: "Correction email sent",
        description: "Draft delivered via live Gmail. Case marked as DECLINE with SENT status.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title:
          error instanceof ApiError && error.status === 404
            ? "Route not found (backend version mismatch)"
            : error instanceof ApiError && error.status === 409
              ? "Draft changed before sending"
              : "Draft send failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    }
  }, [activeDetail, liveReviews, toast]);

  const prepareCorrectionDraft = useCallback(async () => {
    if (!activeDetail) return;
    setIsPreparingDraft(true);
    try {
      const updated = await prepareDraft(activeDetail.case_id, activeDetail.version);
      setActiveDetail(updated);
      setCases((current) =>
        current.map((item) => (item.id === activeDetail.case_id ? reviewDetail(updated) : item)),
      );
      await liveReviews.refresh();
      toast({
        title: "Correction draft prepared",
        description: "Generated draft based on identified discrepancies.",
        tone: "info",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title: "Correction draft failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setIsPreparingDraft(false);
    }
  }, [activeDetail, liveReviews, toast]);

  const confirmSentCorrectionDraft = useCallback(async () => {
    if (!activeDetail) return;
    setIsConfirmingSent(true);
    try {
      const updated = await confirmSentDraft(activeDetail.case_id, activeDetail.version);
      setActiveDetail(updated);
      setCases((current) =>
        current.map((item) => (item.id === activeDetail.case_id ? reviewDetail(updated) : item)),
      );
      await liveReviews.refresh();
      toast({
        title: "Sent status confirmed",
        description: "Case marked as DECLINE with SENT status.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await getCase(activeDetail.case_id);
        setActiveDetail(refreshed);
      }
      toast({
        title: "Confirmation failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setIsConfirmingSent(false);
    }
  }, [activeDetail, liveReviews, toast]);

  const filtersActive = query.trim() !== "" || reason !== "all" || group !== "none" || sort !== "oldest";

  const clearFilters = () => {
    setQuery("");
    setReason("all");
    setGroup("none");
    setSort("oldest");
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = cases.filter((item) => {
      if (reason !== "all" && item.reasonCode !== reason) return false;
      if (group === "pending" && item.status === "resolved") return false;
      if (
        group !== "none" &&
        group !== "pending" &&
        !GROUP_REASONS[group].includes(item.reasonCode)
      ) {
        return false;
      }
      if (!needle) return true;
      return [item.caseId, item.shipment, item.problemField, item.reason]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    return filtered.sort((a, b) => {
      const resolvedDiff = Number(a.status === "resolved") - Number(b.status === "resolved");
      if (resolvedDiff !== 0) return resolvedDiff;
      return sort === "oldest" ? b.createdOrder - a.createdOrder : a.createdOrder - b.createdOrder;
    });
  }, [cases, query, reason, group, sort]);

  const summarySegments = useMemo<StatSegment[]>(() => {
    const pending = cases.filter((item) => item.status !== "resolved");
    const incomplete = pending.filter((item) =>
      ["unreadable_document", "missing_information"].includes(item.reasonCode),
    ).length;
    const ambiguous = pending.length - incomplete;
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
      share: pending.length ? Math.round((value / pending.length) * 100) : 0,
    });
    return [
      segment("pending", "Pending Review", pending.length, "Cases waiting for human action", "bg-review-500"),
      segment(
        "unreadable_missing",
        "Unreadable / Missing",
        incomplete,
        "Cases with incomplete document information",
        "bg-failed-500",
      ),
      segment(
        "ambiguous",
        "Ambiguous",
        ambiguous,
        "Cases where extracted information is uncertain",
        "bg-processing-500",
      ),
    ];
  }, [cases]);

  const activeCase = openId ? (cases.find((item) => item.id === openId) ?? null) : null;

  if (liveReviews.loading && !liveReviews.data) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="shadow-sm border-edge bg-surface/80" styles={{ body: { padding: "24px" } }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </div>
    );
  }
  if (liveReviews.error && !liveReviews.data) {
    return <ErrorState message={liveReviews.error} retry={() => void liveReviews.refresh()} />;
  }

  if (activeCase) {
    return (
      <ReviewDetail
        reviewCase={activeCase}
        caseDetail={activeDetail}
        onBack={closeCase}
        onSubmit={(decision) => void submitDecision(activeCase.id, decision)}
        onFinalize={() => void finalizeCase()}
        onPrepareDraft={() => void prepareCorrectionDraft()}
        onDeclineCase={() => void prepareCorrectionDraft()}
        onConfirmSentDraft={() => void confirmSentCorrectionDraft()}
        preparingDraft={isPreparingDraft}
        confirmingSent={isConfirmingSent}
        onSaveDraft={(subject, body) => void saveDraft(subject, body)}
        onSendDraft={() => void deliverDraft()}
      />
    );
  }

  const columns: TableColumnsType<ReviewCase> = [
    {
      title: "SHIPMENT",
      key: "shipment",
      render: (_, item) => (
        <div>
          <button
            type="button"
            onClick={() => openCase(item)}
            className="text-left font-semibold text-ink-900 hover:text-brand-600 transition-colors block"
          >
            {item.shipment}
          </button>
          <span className="font-mono text-[11px] text-ink-400 mt-0.5 block">{item.caseId}</span>
        </div>
      ),
    },
    {
      title: "PROBLEM FIELD",
      dataIndex: "problemField",
      key: "problemField",
      render: (val: string) => (
        <Tag color="gold" className="font-semibold text-xs m-0">
          {val}
        </Tag>
      ),
    },
    {
      title: "REASON",
      key: "reason",
      render: (_, item) => (
        <Tooltip title={item.reasonDetail}>
          <span className="text-xs font-medium text-ink-700 cursor-help">
            {REVIEW_REASON_LABELS[item.reasonCode]}
          </span>
        </Tooltip>
      ),
    },
    {
      title: "STATUS",
      key: "status",
      width: 120,
      render: (_, item) => (
        item.status === "resolved" ? (
          <Tag color="success">Resolved</Tag>
        ) : (
          <Tag color="warning">Pending Review</Tag>
        )
      ),
    },
    {
      title: "CONFIDENCE",
      key: "confidence",
      width: 130,
      render: (_, item) => (
        <div className="flex items-center gap-2">
          <Progress
            percent={Math.round(item.confidence * 100)}
            size="small"
            showInfo={false}
            strokeColor="#faad14"
          />
          <span className="text-xs font-semibold tabular text-ink-700">
            {Math.round(item.confidence * 100)}%
          </span>
        </div>
      ),
    },
    {
      title: "CREATED",
      dataIndex: "created",
      key: "created",
      width: 120,
      render: (val: string) => <span className="text-xs text-ink-500">{val}</span>,
    },
    {
      title: "ACTION",
      key: "action",
      align: "right",
      width: 120,
      render: (_, item) => (
        <Button
          type="primary"
          size="small"
          icon={<SolutionOutlined />}
          onClick={() => openCase(item)}
          style={{ backgroundColor: item.status === "resolved" ? "#52c41a" : "#faad14" }}
        >
          {item.status === "resolved" ? "View Case" : "Review"}
        </Button>
      ),
    },
  ];

  return (
    <>
      {liveReviews.stale && <StaleNotice />}

      {/* Top Stat Bar */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink-900">
          Review workload — select a category to filter
        </h2>
        <StatBar
          segments={summarySegments}
          activeId={group}
          onSelect={(id) => setGroup(group === id ? "none" : (id as GroupFilter))}
        />
      </section>

      {/* Filter and Search Bar */}
      <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "16px 20px" } }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            placeholder="Search shipment, case ID, or field..."
            prefix={<SearchOutlined className="text-ink-400" />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
            allowClear
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select
              style={{ width: 200 }}
              value={reason}
              options={REASON_OPTIONS}
              onChange={setReason}
            />
            <Select
              style={{ width: 140 }}
              value={sort}
              options={SORT_OPTIONS}
              onChange={setSort}
            />
            <Button
              icon={<ReloadOutlined className={cn(liveReviews.loading && "animate-spin")} />}
              onClick={() => void liveReviews.refresh()}
              disabled={liveReviews.loading}
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

      {/* Queue Table */}
      <Card
        className="border-edge bg-surface/80 shadow-sm overflow-hidden"
        styles={{
          header: { padding: "16px 24px" },
          body: { padding: 0 },
        }}
        title={
          <div>
            <h2 className="text-base font-bold text-ink-900">Cases Awaiting Review</h2>
            <p className="text-xs font-normal text-ink-500 mt-0.5">
              The engine stopped on these cases rather than guessing a value.
            </p>
          </div>
        }
        extra={
          <span className="text-xs text-ink-400">
            {rows.length} of {cases.filter((c) => c.status !== "resolved").length} pending cases
          </span>
        }
      >
        <Table<ReviewCase>
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
                <Empty description={<span className="text-ink-500">No review cases match these filters.</span>}>
                  <Button type="primary" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                </Empty>
              </div>
            ),
          }}
        />
      </Card>
    </>
  );
}
