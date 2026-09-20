import { describe, expect, it } from "vitest";
import { reviewDetail } from "./live-view-models";
import type { CaseDetail } from "./api";
import { VERIFIED_SEVEN_FIELDS } from "./live-view-models";

function createMockCaseDetail(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    case_id: "CASE-1001",
    version: 3,
    source_type: "EMAIL",
    source_message_id: "msg-1",
    sender: "shipper@example.com",
    subject: "Shipping Advice SI vs BL",
    status: "NEEDS_REVIEW",
    processing_state: "TERMINAL",
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:05:00Z",
    defect_fields: ["container_count"],
    low_confidence: true,
    low_confidence_fields: ["gross_weight"],
    unresolved_fields: ["container_count", "gross_weight"],
    body: "Please verify the attached documents.",
    recipients: ["carrier@example.com"],
    rationale: "Discrepancy detected in container count.",
    assumptions: [],
    draft: null,
    comparisons: [
      {
        field: "shipper",
        label: "Shipper",
        si: { value: "Acme Export Co.", confidence: 0.95 },
        bl: { value: "Acme Export Co.", confidence: 0.95 },
        matches: true,
        low_confidence: false,
      },
      {
        field: "consignee",
        label: "Consignee",
        si: { value: "Global Imports Ltd", confidence: 0.92 },
        bl: { value: "Global Imports Ltd", confidence: 0.92 },
        matches: true,
        low_confidence: false,
      },
      {
        field: "notify_party",
        label: "Notify Party",
        si: { value: "Same as Consignee", confidence: 0.9 },
        bl: { value: "Same as Consignee", confidence: 0.9 },
        matches: true,
        low_confidence: false,
      },
      {
        field: "port_of_loading",
        label: "Port of Loading",
        si: { value: "Shanghai", confidence: 0.88 },
        bl: { value: "Shanghai Port", confidence: 0.88 },
        matches: false,
        low_confidence: false,
      },
      {
        field: "port_of_discharge",
        label: "Port of Discharge",
        si: { value: "Rotterdam", confidence: 0.85 },
        bl: { value: null, confidence: null },
        matches: false,
        low_confidence: false,
      },
      {
        field: "container_count",
        label: "Container Count",
        si: { value: "5 x 40HC", confidence: 0.8 },
        bl: { value: "4 x 40HC", confidence: 0.8 },
        matches: false,
        low_confidence: false,
      },
      {
        field: "gross_weight",
        label: "Gross Weight",
        si: { value: "25,400", unit: "KGS", confidence: 0.65 },
        bl: { value: "25,400", unit: "KGS", confidence: 0.65 },
        matches: true,
        low_confidence: true, // low confidence -> uncertain
      },
    ],
    documents: [
      {
        document_id: "DOC-SI-01",
        filename: "si_doc.pdf",
        content_type: "application/pdf",
        size_bytes: 1024,
        sha256: "abc123si",
        document_type: "SI",
        readable: true,
        raw_text: "SHIPPER: Acme Export Co.\nPORT OF LOADING: Shanghai\nCONTAINER: 5 x 40HC",
      },
      {
        document_id: "DOC-BL-01",
        filename: "bl_doc.pdf",
        content_type: "application/pdf",
        size_bytes: 1024,
        sha256: "abc123bl",
        document_type: "BL",
        readable: true,
        raw_text: "SHIPPER: Acme Export Co.\nPORT OF LOADING: Shanghai Port\nCONTAINER: 4 x 40HC",
      },
    ],
    field_reviews: {
      port_of_loading: {
        field: "port_of_loading",
        reviewer: "inspector_jane",
        at: "2026-09-20T10:15:00Z",
        decision: "confirm",
        note: "Shanghai and Shanghai Port are synonymous for this carrier.",
        document_role: "BL",
        original_si: { value: "Shanghai", confidence: 0.88 },
        original_bl: { value: "Shanghai Port", confidence: 0.88 },
        value: "Shanghai Port",
        resolved: true,
      },
    },
    ...overrides,
  };
}

describe("Seven shipping fields comparison and review logic", () => {
  it("includes all 7 verified shipping fields in canonical order", () => {
    const detail = createMockCaseDetail();
    const mapped = reviewDetail(detail);

    expect(mapped.comparisonFields).toBeDefined();
    expect(mapped.comparisonFields?.length).toBe(7);

    const fieldKeys = mapped.comparisonFields!.map((f) => f.field);
    const expectedKeys = VERIFIED_SEVEN_FIELDS.map((f) => f.field);
    expect(fieldKeys).toEqual(expectedKeys);
  });

  it("accurately classifies discrepancy types for all fields", () => {
    const detail = createMockCaseDetail();
    const mapped = reviewDetail(detail);

    const getField = (key: string) => mapped.comparisonFields!.find((f) => f.field === key)!;

    // shipper: match
    expect(getField("shipper").discrepancyType).toBe("match");
    expect(getField("shipper").matches).toBe(true);
    expect(getField("shipper").resolved).toBe(true);

    // port_of_discharge: missing on BL
    expect(getField("port_of_discharge").discrepancyType).toBe("missing");
    expect(getField("port_of_discharge").resolved).toBe(false);

    // container_count: mismatch
    expect(getField("container_count").discrepancyType).toBe("mismatch");
    expect(getField("container_count").resolved).toBe(false);

    // gross_weight: confidence 0.65 -> uncertain
    expect(getField("gross_weight").discrepancyType).toBe("uncertain");
    expect(getField("gross_weight").resolved).toBe(false);
  });

  it("attaches structured human review decisions with reviewer metadata and original values", () => {
    const detail = createMockCaseDetail();
    const mapped = reviewDetail(detail);

    const pol = mapped.comparisonFields!.find((f) => f.field === "port_of_loading")!;
    expect(pol.humanReview).toBeDefined();
    expect(pol.humanReview?.decision).toBe("confirm");
    expect(pol.humanReview?.reviewer).toBe("inspector_jane");
    expect(pol.humanReview?.note).toContain("synonymous");
    expect(pol.humanReview?.originalSi).toBe("Shanghai");
    expect(pol.humanReview?.originalBl).toBe("Shanghai Port");
    expect(pol.resolved).toBe(true);
  });

  it("identifies unresolved fields when unreadable decision is recorded", () => {
    const detail = createMockCaseDetail({
      field_reviews: {
        port_of_loading: {
          field: "port_of_loading",
          reviewer: "inspector_jane",
          at: "2026-09-20T10:15:00Z",
          decision: "unreadable",
          note: "Port stamp is smudged.",
          document_role: "BL",
          value: null,
          resolved: false,
        },
      },
    });
    const mapped = reviewDetail(detail);
    const pol = mapped.comparisonFields!.find((f) => f.field === "port_of_loading")!;

    // unreadable remains unresolved
    expect(pol.resolved).toBe(false);
    expect(mapped.unresolvedFields).toContain("port_of_loading");
  });

  it("reflects full resolution when all discrepant/uncertain fields have confirm or correct reviews", () => {
    const detail = createMockCaseDetail({
      field_reviews: {
        port_of_loading: {
          field: "port_of_loading",
          reviewer: "inspector_jane",
          at: "2026-09-20T10:15:00Z",
          decision: "confirm",
          note: "Shanghai Port verified",
          document_role: "BL",
          value: "Shanghai Port",
          resolved: true,
        },
        port_of_discharge: {
          field: "port_of_discharge",
          reviewer: "inspector_jane",
          at: "2026-09-20T10:16:00Z",
          decision: "correct",
          value: "Rotterdam",
          note: "Missing on BL, inserted per SI",
          document_role: "BL",
          resolved: true,
        },
        container_count: {
          field: "container_count",
          reviewer: "inspector_jane",
          at: "2026-09-20T10:17:00Z",
          decision: "correct",
          value: "5 x 40HC",
          note: "SI prevails per customer confirmation",
          document_role: "BL",
          resolved: true,
        },
        gross_weight: {
          field: "gross_weight",
          reviewer: "inspector_jane",
          at: "2026-09-20T10:18:00Z",
          decision: "confirm",
          note: "OCR confirmed legible",
          document_role: "BL",
          value: "25,400 KGS",
          resolved: true,
        },
      },
    });

    const mapped = reviewDetail(detail);
    // shipper, consignee, notify_party were already matching.
    // The 4 discrepancy fields now have valid resolved reviews.
    expect(mapped.unresolvedFields?.length).toBe(0);
  });

  it("cycles fields forward and backward with wrap-around using left and right keys", () => {
    const fields = VERIFIED_SEVEN_FIELDS;
    expect(fields.length).toBe(7);

    // Right (next) navigation from first field
    const firstField = fields[0].field;
    expect(firstField).toBe("shipper");
    const nextIndex = (0 + 1) % fields.length;
    expect(fields[nextIndex].field).toBe("consignee");

    // Right navigation wrap-around from last field
    const lastIndex = fields.length - 1;
    const wrappedNext = (lastIndex + 1) % fields.length;
    expect(fields[wrappedNext].field).toBe(fields[0].field);

    // Left (previous) navigation from first field wraps to last
    const wrappedPrev = (0 - 1 + fields.length) % fields.length;
    expect(fields[wrappedPrev].field).toBe(fields[lastIndex].field);

    // Left navigation from second field
    const prevFromSecond = (1 - 1 + fields.length) % fields.length;
    expect(fields[prevFromSecond].field).toBe(fields[0].field);
  });
});

