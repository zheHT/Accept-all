"use client";

import { DocumentComparison } from "./document-comparison";
import type { DocumentEvidence } from "@/lib/review-data";

/** Backwards-compatible entry point for the review detail comparison action. */
export function DualDocumentPreview({
  si,
  bl,
  problemField,
  open,
  onClose,
}: {
  si: DocumentEvidence;
  bl: DocumentEvidence;
  problemField: string;
  open: boolean;
  onClose: () => void;
}) {
  return <DocumentComparison si={si} bl={bl} problemField={problemField} open={open} onClose={onClose} />;
}
