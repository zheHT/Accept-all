"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClearOutlined,
  EyeOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Card, Checkbox, Empty, Input, Select, Table, Tag, Tooltip, type TableColumnsType } from "antd";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState, StaleNotice } from "@/components/ui/live-state";
import { useWorkspaceCounts } from "@/components/workspace/workspace-counts";
import { EmailDrawer } from "./email-drawer";
import { IntakeBreakdown, type IntakeGroup } from "./intake-breakdown";
import {
  CLASSIFICATION_META,
  EMAIL_STATUS_META,
  type EmailClassification,
  type EmailStatus,
  type InboxEmail,
} from "@/lib/inbox-data";
import { getCase, getInbox } from "@/lib/api";
import { inboxDetail, inboxSummary } from "@/lib/live-view-models";
import { useLiveQuery } from "@/lib/use-live-query";
import {
  filterInboxEmails,
  OTHER_REQUEST_TYPES,
  type InboxDateFilter,
  type InboxSortOrder,
  type InboxStatusFilter,
  type InboxTypeFilter,
} from "./inbox-filter";

type TypeFilter = InboxTypeFilter;
type StatusFilter = InboxStatusFilter;
type DateFilter = InboxDateFilter;
type SortOrder = InboxSortOrder;

const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All Types" },
  ...(Object.keys(CLASSIFICATION_META) as EmailClassification[]).map((value) => ({
    value: value as TypeFilter,
    label: CLASSIFICATION_META[value].label,
  })),
  { value: "other_requests", label: "Other Requests (SI, invoice, general)" },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All Status" },
  ...(Object.keys(EMAIL_STATUS_META) as EmailStatus[]).map((value) => ({
    value,
    label: EMAIL_STATUS_META[value].label,
  })),
];

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "Date: Any" },
  { value: "today", label: "Date: Today" },
  { value: "yesterday", label: "Date: Yesterday" },
];

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "confidence", label: "Lowest Confidence" },
];

const CLASSIFICATION_TAG_COLORS: Record<EmailClassification, string> = {
  document_comparison: "blue",
  new_si: "cyan",
  invoice_query: "purple",
  general: "geekblue",
  spam: "default",
};

export function InboxView() {
  const toast = useToast();
  const { markEmailRead, isEmailRead } = useWorkspaceCounts();
  const inbox = useLiveQuery((signal) => getInbox(signal), []);

  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [date, setDate] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [includeSpam, setIncludeSpam] = useState(false);
  const [selected, setSelected] = useState<InboxEmail | null>(null);
  const [intakeGroup, setIntakeGroup] = useState<IntakeGroup>("all");

  useEffect(() => {
    if (inbox.data) setEmails(inbox.data.items.map(inboxSummary));
  }, [inbox.data]);

  const totals = useMemo(
    () => ({
      total: emails.length,
      checks: emails.filter((email) => email.classification === "document_comparison").length,
      spam: emails.filter((email) => email.classification === "spam").length,
      other: emails.filter((email) => OTHER_REQUEST_TYPES.includes(email.classification)).length,
    }),
    [emails],
  );

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("email");
    const match = emails.find((email) => email.id === id);
    if (match) {
      setSelected(match);
      markEmailRead(match.id);
    }
  }, [emails, markEmailRead]);

  const openEmail = useCallback(
    (item: InboxEmail) => {
      setSelected(item);
      markEmailRead(item.id);
      const url = new URL(window.location.href);
      url.searchParams.set("email", item.id);
      window.history.replaceState({}, "", url.toString());

      if (item.caseRef) {
        void getCase(item.caseRef)
          .then((detail) => {
            setEmails((current) =>
              current.map((entry) => (entry.id === item.id ? inboxDetail(detail) : entry)),
            );
          })
          .catch(() => {});
      }
    },
    [markEmailRead],
  );

  const closeEmail = useCallback(() => {
    setSelected(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    url.searchParams.delete("doc");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const handleGroupSelect = useCallback((group: IntakeGroup) => {
    setIntakeGroup(group);
    if (group === "all") {
      setType("all");
      setIncludeSpam(true);
    } else if (group === "checks") {
      setType("document_comparison");
      setIncludeSpam(false);
    } else if (group === "other") {
      setType("other_requests");
      setIncludeSpam(false);
    } else if (group === "spam") {
      setType("spam");
      setIncludeSpam(true);
    }
  }, []);

  const clearFilters = () => {
    setQuery("");
    setType("all");
    setStatus("all");
    setDate("all");
    setSort("newest");
    setIncludeSpam(false);
    setIntakeGroup("all");
  };

  const filtersActive =
    query.trim() !== "" ||
    type !== "all" ||
    status !== "all" ||
    date !== "all" ||
    sort !== "newest" ||
    includeSpam;

  const filtered = useMemo(
    () =>
      filterInboxEmails(emails, {
        query,
        type,
        status,
        date,
        sort,
        includeSpam,
      }),
    [emails, query, type, status, date, sort, includeSpam],
  );

  const sync = async () => {
    await inbox.refresh();
    const now = new Date();
    setLastSync(
      `just now (${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`,
    );
    toast({
      title: "Inbox updated",
      description: "Fetched the latest batch of verification emails.",
      tone: "info",
    });
  };

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  if (inbox.loading && !inbox.data) return <LoadingState label="Loading intake queue" />;
  if (inbox.error && !inbox.data) {
    return <ErrorState message={inbox.error} retry={() => void inbox.refresh()} />;
  }

  const columns: TableColumnsType<InboxEmail> = [
    {
      title: "SENDER",
      key: "sender",
      render: (_, email) => {
        const read = isEmailRead(email.id);
        const meta = CLASSIFICATION_META[email.classification];
        const isSpam = email.classification === "spam";

        return (
          <div className="flex items-center gap-3">
            <span
              className={cn("size-2 shrink-0 rounded-full", read ? "bg-transparent" : "bg-brand-500")}
            />
            <Avatar
              size={34}
              style={{
                backgroundColor: meta.verifiable ? "#1677ff" : isSpam ? "#8c8c8c" : "#595959",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {initials(email.sender)}
            </Avatar>
            <div className="min-w-0">
              <span
                className={cn(
                  "block truncate text-xs",
                  read ? "font-normal text-ink-700" : "font-bold text-ink-900",
                )}
              >
                {email.sender}
              </span>
              <span className="block max-w-[140px] truncate text-[11px] text-ink-400">
                {email.senderEmail}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      title: "SUBJECT",
      key: "subject",
      render: (_, email) => {
        const read = isEmailRead(email.id);
        const isSpam = email.classification === "spam";

        return (
          <div className="max-w-[280px]">
            <span
              className={cn(
                "block truncate text-xs",
                read ? "font-normal text-ink-700" : "font-semibold text-ink-900",
                isSpam && "text-ink-400",
              )}
            >
              {email.subject}
            </span>
            <span className="block truncate text-[11px] text-ink-400 mt-0.5">{email.preview}</span>
          </div>
        );
      },
    },
    {
      title: "RECEIVED",
      key: "received",
      width: 120,
      render: (_, email) => (
        <div>
          <span className="block text-xs font-semibold text-ink-700">{email.receivedTime}</span>
          <span className="block text-[11px] capitalize text-ink-400">{email.receivedDay}</span>
        </div>
      ),
    },
    {
      title: "CLASSIFICATION",
      dataIndex: "classification",
      key: "classification",
      width: 160,
      render: (classification: EmailClassification) => {
        const meta = CLASSIFICATION_META[classification];
        const color = CLASSIFICATION_TAG_COLORS[classification];
        return <Tag color={color}>{meta.label}</Tag>;
      },
    },
    {
      title: "FILES",
      key: "files",
      align: "center",
      width: 80,
      render: (_, email) => (
        email.attachments.length === 0 ? (
          <span className="text-xs text-ink-300">—</span>
        ) : (
          <Tooltip title={email.attachments.map((f) => f.name).join(", ")}>
            <Tag icon={<PaperClipOutlined />} className="cursor-help m-0">
              {email.attachments.length}
            </Tag>
          </Tooltip>
        )
      ),
    },
    {
      title: "STATUS",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (status: EmailStatus) => {
        const meta = EMAIL_STATUS_META[status];
        const color =
          status === "completed"
            ? "success"
            : status === "ready_for_verification"
              ? "blue"
              : status === "needs_review"
                ? "warning"
                : status === "processing"
                  ? "processing"
                  : "default";
        return <Tag color={color}>{meta.label}</Tag>;
      },
    },
    {
      title: "ACTION",
      key: "action",
      align: "right",
      width: 90,
      render: (_, email) => (
        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            openEmail(email);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {inbox.stale && <StaleNotice />}

      <IntakeBreakdown
        totals={totals}
        active={intakeGroup}
        onSelect={handleGroupSelect}
        syncing={inbox.loading}
        lastSync={lastSync}
        onSync={() => void sync()}
      />

      {/* Filter and Search Card */}
      <Card className="border-edge bg-surface/80 shadow-sm" styles={{ body: { padding: "16px 20px" } }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            placeholder="Search sender, subject, or email body..."
            prefix={<SearchOutlined className="text-ink-400" />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
            allowClear
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select
              style={{ width: 170 }}
              value={type}
              options={TYPE_OPTIONS}
              onChange={setType}
            />
            <Select
              style={{ width: 130 }}
              value={status}
              options={STATUS_OPTIONS}
              onChange={setStatus}
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
            <Checkbox
              checked={includeSpam}
              onChange={(e) => setIncludeSpam(e.target.checked)}
              className="text-xs text-ink-700"
            >
              Include spam
            </Checkbox>
            <Button
              icon={<ReloadOutlined className={cn(inbox.loading && "animate-spin")} />}
              onClick={() => void sync()}
              disabled={inbox.loading}
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

      {/* Emails Table */}
      <Card
        className="border-edge bg-surface/80 shadow-sm overflow-hidden"
        styles={{
          header: { padding: "16px 24px" },
          body: { padding: 0 },
        }}
        title={
          <div>
            <h2 className="text-base font-bold text-ink-900">Incoming Email</h2>
            <p className="text-xs font-normal text-ink-500 mt-0.5">
              Click an email to inspect its AI classification and attachments.
            </p>
          </div>
        }
        extra={
          <span className="text-xs text-ink-400">
            {filtered.length} of {totals.total} emails
          </span>
        }
      >
        <Table<InboxEmail>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ["10", "25", "50"],
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} emails`,
          }}
          onRow={(record) => ({
            onClick: () => openEmail(record),
            className: "cursor-pointer hover:bg-surface/90 transition-colors",
          })}
          locale={{
            emptyText: (
              <div className="py-12 text-center">
                <Empty description={<span className="text-ink-500">No emails match these filters.</span>}>
                  <Button type="primary" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                </Empty>
              </div>
            ),
          }}
        />
      </Card>

      {/* Email Drawer */}
      <EmailDrawer
        email={selected}
        onClose={closeEmail}
        onEmailUpdated={(updated) =>
          setEmails((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
        }
      />
    </div>
  );
}
