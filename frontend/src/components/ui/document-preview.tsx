"use client";

import { DocumentComparison } from "./document-comparison";

export interface PreviewDocument {
  name: string;
  role?: "SI" | "BL" | "other";
  caseId?: string;
  documentId?: string;
  contentType?: string;
  pages: number;
  sizeLabel?: string;
  scanned?: boolean;
  /** Document text, one entry per line. */
  lines: string[];
  /** Indexes of lines to highlight as the source of a problem. */
  problemLines?: number[];
}

/** Single-document compatibility wrapper around the shared source viewer. */
export function DocumentPreview({
  document: doc,
  onClose,
}: {
  document: PreviewDocument | null;
  onClose: () => void;
}) {
  if (!doc) return null;
  return (
    <DocumentComparison
      si={{
        name: doc.name,
        documentId: doc.documentId,
        caseId: doc.caseId,
        contentType: doc.contentType,
        pages: doc.pages,
        scanned: doc.scanned,
        snippet: doc.lines,
        fullLines: doc.lines,
        problemLines: doc.problemLines,
        highlightIndex: doc.problemLines?.[0] ?? -1,
        extractedLabel: "Extracted value",
        extractedValue: null,
      }}
      problemField="Extracted value"
      open
      onClose={onClose}
      heading={`${doc.role && doc.role !== "other" ? `${doc.role} · ` : ""}${doc.name}`}
      singleRole={doc.role || "other"}
    />
  );
}
