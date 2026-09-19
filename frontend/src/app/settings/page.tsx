import { PageHeading } from "@/components/app-shell/page-heading";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata = { title: "Settings — ShipVerify" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Settings"
        subtitle="Appearance, verification rules, mailbox connection, and notifications."
      />

      <SettingsView />
    </div>
  );
}
