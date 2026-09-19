import { PageHeading } from "@/components/app-shell/page-heading";
import { CasesView } from "@/components/cases/cases-view";

export const metadata = { title: "Verification Cases — ShipVerify" };

export default function CasesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Verification Cases"
        subtitle="Compare shipment documents and monitor cases that require attention."
      />

      <CasesView />
    </div>
  );
}
