import { PageHeading } from "@/components/app-shell/page-heading";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata = {
  title: "Inbox — ShipVerify",
};

export default function InboxPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Inbox"
        subtitle="Review incoming emails and their automated classifications."
      />

      <InboxView />
    </div>
  );
}
