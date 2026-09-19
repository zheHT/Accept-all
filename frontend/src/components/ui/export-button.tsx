"use client";

import { Download } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { downloadCsv } from "@/lib/export-csv";
import { VERIFICATION_CASES } from "@/lib/case-data";
import { ATTENTION_CASES, PERIODS } from "@/lib/mock-data";

/** Downloads the current view as a CSV the operations team can circulate. */
export function ExportButton({ scope }: { scope: "cases" | "dashboard" }) {
  const toast = useToast();

  const onClick = () => {
    const stamp = new Date().toISOString().slice(0, 10);

    if (scope === "cases") {
      downloadCsv(
        `shipverify-verification-cases-${stamp}.csv`,
        VERIFICATION_CASES.map((item) => ({
          "Case ID": item.caseId,
          Shipment: item.shipment,
          "Carrier reference": item.carrierRef ?? "",
          "Source email": item.sourceEmailSubject,
          "Fields checked": item.fieldsChecked === null ? "—" : `${item.fieldsChecked}/7`,
          Result: item.result,
          Issue: item.issue ?? "No mismatch detected",
          Detail: item.issueDetail ?? "",
          Confidence: item.confidence ? `${Math.round(item.confidence * 100)}%` : "",
          Status: item.workflow,
          Updated: item.updated,
        })),
      );
      toast({
        title: "Verification cases exported",
        description: `${VERIFICATION_CASES.length} cases written to a CSV in your downloads folder.`,
        tone: "success",
      });
      return;
    }

    const week = PERIODS.week;
    downloadCsv(`shipverify-weekly-summary-${stamp}.csv`, [
      { Metric: "Total cases", Value: week.total, Period: week.rangeLabel },
      { Metric: "Matched", Value: week.matched, Period: week.rangeLabel },
      { Metric: "Mismatches", Value: week.mismatch, Period: week.rangeLabel },
      { Metric: "Needs review", Value: week.needsReview, Period: week.rangeLabel },
      { Metric: "Average turnaround", Value: week.avgTurnaround, Period: week.rangeLabel },
      { Metric: "Auto-cleared", Value: `${week.autoCleared}%`, Period: week.rangeLabel },
      ...ATTENTION_CASES.map((row) => ({
        Metric: `Open case ${row.reference}`,
        Value: row.status,
        Period: row.flaggedFields.join(" / ") || "—",
      })),
    ]);
    toast({
      title: "Weekly report exported",
      description: "Summary metrics and open cases written to a CSV in your downloads folder.",
      tone: "success",
    });
  };

  return (
    <button type="button" onClick={onClick} className="btn-primary">
      <Download className="size-4" strokeWidth={2} />
      Export report
    </button>
  );
}
