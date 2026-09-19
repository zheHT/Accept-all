import { cn } from "@/lib/cn";
import {
  CLASSIFICATION_META,
  EMAIL_STATUS_META,
  type EmailClassification,
  type EmailStatus,
} from "@/lib/inbox-data";

/**
 * Classification badge. "Document Comparison Request" is the only filled badge
 * because those emails are the ones that continue into the verification workflow.
 */
export function ClassificationBadge({
  classification,
  className,
}: {
  classification: EmailClassification;
  className?: string;
}) {
  const meta = CLASSIFICATION_META[classification];
  const Icon = meta.icon;

  return (
    <span
      title={meta.hint}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-2 pr-2.5 text-[11.5px] font-medium",
        meta.chip,
        className,
      )}
    >
      {meta.verifiable ? (
        <Icon className="size-3.5" strokeWidth={2.25} />
      ) : (
        <span className={cn("size-1.5 rounded-full", meta.dot)} />
      )}
      {meta.label}
    </span>
  );
}

export function EmailStatusBadge({
  status,
  className,
}: {
  status: EmailStatus;
  className?: string;
}) {
  const meta = EMAIL_STATUS_META[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium",
        meta.chip,
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", meta.dot, status === "processing" && "animate-pulse")}
      />
      {meta.label}
    </span>
  );
}
