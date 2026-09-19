import { PageHeading } from "@/components/app-shell/page-heading";
import { ReviewView } from "@/components/review/review-view";

export const metadata = { title: "Human Review — ShipVerify" };

export default function ReviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Human Review"
        subtitle="Review cases where the verification system needs human input."
      />

      <ReviewView />
    </div>
  );
}
