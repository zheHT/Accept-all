"use client";

import { useMemo, useState } from "react";
import {
  CalendarOutlined,
  ClockCircleOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Button, Card, Empty, Input, Segmented, Skeleton, Statistic, Tag } from "antd";
import { PageHeading } from "@/components/app-shell/page-heading";
import { ErrorState, StaleNotice } from "@/components/ui/live-state";
import { useToast } from "@/components/ui/toast";
import {
  fetchAssumptionRegistry,
  fetchKnowledgeBaseWeeks,
  publishWeeklySnapshot,
  type AssumptionRecord,
  type KnowledgeBaseWeek,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, sanitizeBranding } from "@/lib/format";
import { useLiveQuery } from "@/lib/use-live-query";

type RegistryFilter = "all" | "accepted" | "proposed";

const REGISTRY_FILTERS: Array<{ value: RegistryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "accepted", label: "Accepted" },
  { value: "proposed", label: "Proposed" },
];

export default function KnowledgeBasePage() {
  const toast = useToast();
  const weeks = useLiveQuery((signal) => fetchKnowledgeBaseWeeks(signal), []);
  const registry = useLiveQuery((signal) => fetchAssumptionRegistry(signal), []);
  const [publishing, setPublishing] = useState(false);
  const [registryFilter, setRegistryFilter] = useState<RegistryFilter>("all");
  const [registryQuery, setRegistryQuery] = useState("");

  const publications = weeks.data || [];
  const assumptions = useMemo(() => registry.data || [], [registry.data]);
  const latest = publications[0];
  const totalCases = publications.reduce((sum, item) => sum + item.cases_analyzed, 0);
  const acceptedCount = assumptions.filter((item) => item.status === "accepted").length;

  const visibleAssumptions = useMemo(() => {
    const needle = registryQuery.trim().toLowerCase();
    return assumptions.filter((item) => {
      if (registryFilter !== "all" && item.status !== registryFilter) return false;
      if (!needle) return true;
      return [item.field, sanitizeBranding(item.normalized_value), item.status]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [assumptions, registryFilter, registryQuery]);

  const publish = async () => {
    setPublishing(true);
    try {
      const published = await publishWeeklySnapshot();
      await Promise.all([weeks.refresh(), registry.refresh()]);
      toast({
        title: `${formatWeek(published.week)} published`,
        description: `${published.cases_analyzed} cases were included in the weekly knowledge document.`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Knowledge publication failed",
        description: error instanceof Error ? error.message : "Please retry.",
        tone: "warning",
      });
    } finally {
      setPublishing(false);
    }
  };

  if (weeks.loading && !weeks.data) {
    return (
      <div className="flex flex-col gap-7">
        <PageHeading
          title="Knowledge Base"
          subtitle="Weekly operational briefings, verified patterns, and the assumptions reviewers have governed over time."
        />
        <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "24px" } }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </div>
    );
  }
  if (weeks.error && !weeks.data) {
    return <ErrorState message={weeks.error} retry={() => void weeks.refresh()} />;
  }

  return (
    <div className="flex flex-col gap-7">
      <PageHeading
        title="Knowledge Base"
        subtitle="Weekly operational briefings, verified patterns, and the assumptions reviewers have governed over time."
        actions={
          <div className="flex items-center gap-2">
            <Button
              icon={<ReloadOutlined className={cn((weeks.loading || registry.loading) && "animate-spin")} />}
              disabled={weeks.loading || registry.loading}
              onClick={() => {
                void Promise.all([weeks.refresh(), registry.refresh()]);
                toast({ title: "Knowledge base refreshed", tone: "info" });
              }}
            >
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined className={cn(publishing && "animate-spin")} />}
              loading={publishing}
              onClick={() => void publish()}
            >
              Publish current week
            </Button>
          </div>
        }
      />

      {(weeks.stale || registry.stale) && <StaleNotice />}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "20px 24px" } }}>
          <Statistic
            title="Published weeks"
            value={publications.length}
            prefix={<CalendarOutlined className="text-blue-500 mr-1" />}
          />
          <p className="text-xs text-ink-400 mt-2">Immutable weekly snapshots</p>
        </Card>

        <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "20px 24px" } }}>
          <Statistic
            title="Cases summarized"
            value={totalCases}
            prefix={<FileTextOutlined className="text-indigo-500 mr-1" />}
          />
          <p className="text-xs text-ink-400 mt-2">Across published periods</p>
        </Card>

        <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "20px 24px" } }}>
          <Statistic
            title="Governed assumptions"
            value={assumptions.length}
            prefix={<DatabaseOutlined className="text-amber-500 mr-1" />}
          />
          <p className="text-xs text-ink-400 mt-2">{acceptedCount} accepted by reviewers</p>
        </Card>

        <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "20px 24px" } }}>
          <Statistic
            title="Latest briefing"
            value={latest ? shortWeek(latest.week) : "None"}
            prefix={<SafetyCertificateOutlined className="text-emerald-500 mr-1" />}
          />
          <p className="text-xs text-ink-400 mt-2">
            {latest ? formatDate(latest.published_at) : "Publish the first report"}
          </p>
        </Card>
      </div>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
        {/* Weekly Briefings Card */}
        <Card
          className="border-edge bg-surface/80 shadow-sm overflow-hidden"
          styles={{
            header: { padding: "16px 24px" },
            body: { padding: 0 },
          }}
          title={
            <div>
              <h2 className="text-[15px] font-bold text-ink-900">Weekly Briefings</h2>
              <p className="text-xs font-normal text-ink-500 mt-0.5">
                Each publication summarizes the requested ISO week and preserves its source watermark.
              </p>
            </div>
          }
          extra={<Tag color="blue">{publications.length} published</Tag>}
        >
          {!publications.length ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <Empty description="No weekly briefings yet. Publish the current week after reviewed cases are available." />
            </div>
          ) : (
            <ol className="divide-y divide-line overflow-y-auto max-h-[650px]">
              {publications.map((week, index) => (
                <WeeklyBriefing key={week.week} week={week} latest={index === 0} />
              ))}
            </ol>
          )}
        </Card>

        {/* Assumption Registry Card */}
        <Card
          className="border-edge bg-surface/80 shadow-sm overflow-hidden"
          styles={{
            header: { padding: "16px 20px" },
            body: { padding: 0 },
          }}
          title={
            <div>
              <h2 className="text-[15px] font-bold text-ink-900">Assumption Registry</h2>
              <p className="text-xs font-normal text-ink-500 mt-0.5">
                Evidence-backed operational interpretations.
              </p>
            </div>
          }
          extra={<span className="text-xs font-semibold text-ink-500">{assumptions.length} total</span>}
        >
          <div className="border-b border-line p-4 flex flex-col gap-3">
            <Input
              placeholder="Search field or interpretation…"
              prefix={<SearchOutlined className="text-ink-400" />}
              value={registryQuery}
              onChange={(e) => setRegistryQuery(e.target.value)}
              allowClear
            />

            <Segmented
              block
              value={registryFilter}
              options={REGISTRY_FILTERS}
              onChange={(val) => setRegistryFilter(val as RegistryFilter)}
            />
          </div>

          <div className="overflow-y-auto max-h-[550px]">
            {registry.error && !registry.data ? (
              <div className="p-6">
                <ErrorState message={registry.error} retry={() => void registry.refresh()} />
              </div>
            ) : registry.loading && !registry.data ? (
              <div className="p-6">
                <Skeleton active paragraph={{ rows: 4 }} />
              </div>
            ) : !visibleAssumptions.length ? (
              <div className="py-12">
                <Empty
                  description={
                    assumptions.length ? "No assumptions match filter" : "No governed assumptions yet"
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {visibleAssumptions.map((item) => (
                  <AssumptionItem key={item.assumption_id} item={item} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}

function WeeklyBriefing({
  week,
  latest,
}: {
  week: KnowledgeBaseWeek;
  latest: boolean;
}) {
  const outcomes = [
    { label: "Matched", value: week.status_counts.OK || 0, color: "#52c41a" },
    { label: "Mismatch", value: week.status_counts.MISMATCH || 0, color: "#ff4d4f" },
    { label: "Review", value: week.status_counts.NEEDS_REVIEW || 0, color: "#faad14" },
  ];
  const outcomeTotal = outcomes.reduce((sum, item) => sum + item.value, 0);
  const categories = Object.entries(week.category_counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);

  return (
    <li className="px-6 py-5 hover:bg-surface/50 transition-colors">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-ink-900">{formatWeek(week.week)}</span>
            {latest && <Tag color="blue">Latest</Tag>}
            <Tag color="success">{week.status}</Tag>
          </div>
          <span className="text-xs text-ink-400 flex items-center gap-1.5 font-mono">
            <ClockCircleOutlined />
            {formatDate(week.published_at)} · {week.content_hash.slice(0, 8)}
          </span>
        </div>

        <p className="text-xs text-ink-600 leading-relaxed max-w-3xl">
          {sanitizeBranding(week.summary_narrative) ||
            "This weekly snapshot contains deterministic operational counts and governed reviewer assumptions."}
        </p>

        <div className="mt-2 flex flex-col gap-2">
          {/* Multi-segment progress */}
          <div className="flex h-2 overflow-hidden rounded-full bg-line">
            {outcomes.map((outcome) => (
              <span
                key={outcome.label}
                style={{
                  width: `${outcomeTotal ? (outcome.value / outcomeTotal) * 100 : 0}%`,
                  backgroundColor: outcome.color,
                }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-4">
              {outcomes.map((outcome) => (
                <span key={outcome.label} className="inline-flex items-center gap-1.5 text-ink-600">
                  <span className="size-2 rounded-full" style={{ backgroundColor: outcome.color }} />
                  {outcome.label}: <strong className="text-ink-900">{outcome.value}</strong>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-4 text-ink-700">
              <span>
                Cases: <strong className="text-ink-900">{week.cases_analyzed}</strong>
              </span>
              <span>
                Assumptions: <strong className="text-ink-900">{week.assumptions_count}</strong>
              </span>
            </div>
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {categories.map(([category, count]) => (
                <Tag key={category} color="default" className="text-[11px] font-mono m-0">
                  {category.replaceAll("_", " ")} · {count}
                </Tag>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function AssumptionItem({ item }: { item: AssumptionRecord }) {
  const accepted = item.status === "accepted";
  return (
    <li className="px-5 py-3.5 hover:bg-surface/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-ink-900">{humanize(item.field)}</p>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{sanitizeBranding(item.normalized_value)}</p>
        </div>
        <Tag color={accepted ? "success" : "warning"} className="m-0 uppercase text-[10px] font-bold">
          {item.status}
        </Tag>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 text-[11px] text-ink-400">
        <span>{item.evidence_count} linked case{item.evidence_count === 1 ? "" : "s"}</span>
        <span>{Math.round(item.confidence * 100)}% confidence</span>
        {item.last_confirmed_by && <span>Confirmed by {item.last_confirmed_by}</span>}
      </div>
    </li>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWeek(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  return match ? `Week ${Number(match[2])}, ${match[1]}` : value;
}

function shortWeek(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  return match ? `W${Number(match[2])} · ${match[1]}` : value;
}
