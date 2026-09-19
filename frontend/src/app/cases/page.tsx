import { PageHeading } from "@/components/app-shell/page-heading";
import { CasesView } from "@/components/cases/cases-view";
import { ExportButton } from "@/components/ui/export-button";

export const metadata = { title: "Verification Cases — ShipVerify" };

export default function CasesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Verification Cases"
        subtitle="Compare shipment documents and monitor cases that require attention."
        actions={<ExportButton scope="cases" />}
      />

      <CasesView />
    </div>
  );
}
