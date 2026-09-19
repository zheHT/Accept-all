import { PageHeading } from "@/components/app-shell/page-heading";
import { AttentionTable } from "@/components/dashboard/attention-table";
import { OverviewSection } from "@/components/dashboard/overview-section";
import { ExportButton } from "@/components/ui/export-button";
import { StatusLegend } from "@/components/ui/status-legend";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-9">
      <PageHeading
        title="Dashboard"
        subtitle="Monitor document verification activity and cases that require attention."
        actions={
          <>
            <StatusLegend />
            <ExportButton scope="dashboard" />
          </>
        }
      />

      <OverviewSection />
      <AttentionTable />
    </div>
  );
}
