"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { downloadCsv } from "@/lib/export-csv";
import { getCases, getDashboard, type DashboardResponse } from "@/lib/api";
import { fieldLabel, relativeTime, verificationStatus } from "@/lib/live-view-models";

/** Downloads the current view as a CSV the operations team can circulate. */
export function ExportButton({ scope }: { scope: "cases" | "dashboard" }) {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const onClick = async () => {
    if (exporting) return;
    setExporting(true);
    const stamp = new Date().toISOString().slice(0, 10);

    try {
      if (scope === "cases") {
        const response = await getCases();
        downloadCsv(
          `shipverify-verification-cases-${stamp}.csv`,
          response.items.map((item) => ({
            "Case ID": item.case_id,
            Source: item.source_type,
            Sender: item.sender,
            Subject: item.subject,
            Result: verificationStatus(item),
            "Flagged fields": [...item.defect_fields, ...item.low_confidence_fields].map(fieldLabel).join(" / "),
            "Review decision": item.review_decision || "",
            Version: item.version,
            Updated: item.updated_at,
          })),
        );
        toast({
          title: "Verification cases exported",
          description: `${response.items.length} live cases written to a CSV in your downloads folder.`,
          tone: "success",
        });
        return;
      }

      const selected = new URLSearchParams(window.location.search).get("period");
      const period: DashboardResponse["period"] = selected === "day" || selected === "month" ? selected : "week";
      const response = await getDashboard(period);
      downloadCsv(`shipverify-${period}-summary-${stamp}.csv`, [
        { Metric: "Total cases", Value: response.metrics.total, Period: period },
        { Metric: "Matched", Value: response.metrics.matches, Period: period },
        { Metric: "Mismatches", Value: response.metrics.mismatches, Period: period },
        { Metric: "Needs review", Value: response.metrics.needs_review, Period: period },
        { Metric: "Processing", Value: response.metrics.processing, Period: period },
        ...response.attention_items.map((item) => ({
          Metric: `Open case ${item.case_id}`,
          Value: verificationStatus(item),
          Period: `${relativeTime(item.created_at)} · ${item.defect_fields.map(fieldLabel).join(" / ") || "Review required"}`,
        })),
      ]);
      toast({
        title: "Live report exported",
        description: `The currently selected ${period} metrics and attention cases were written to CSV.`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "The live data could not be exported.",
        tone: "warning",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <button type="button" onClick={() => void onClick()} disabled={exporting} className="btn-primary">
      <Download className="size-4" strokeWidth={2} />
      {exporting ? "Preparing…" : "Export report"}
    </button>
  );
}
