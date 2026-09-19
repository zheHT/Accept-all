import { cn } from "@/lib/cn";
import { STATUS_META, type VerificationStatus } from "@/lib/status";

export function StatusChip({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.hint}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium",
        meta.chip,
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          meta.dot,
          status === "processing" && "animate-pulse",
        )}
      />
      {meta.label}
    </span>
  );
}
