import re

from collections import defaultdict

from app.schemas import (
    CheckFinding,
    DocumentType,
    ExtractedDocument,
    FindingSeverity,
    VerificationResult,
    VerificationStatus,
)


class ShippingDocumentChecker:
    """
    Deterministic consistency checker.

    Gemini extracts facts.
    This class decides whether those facts conflict.

    Domain-specific Averis / organiser rules can be added here
    later without modifying document ingestion or AI extraction.
    """

    WEIGHT_TOLERANCE_RATIO = 0.01

    TEXT_FIELDS = {
        "booking_number": (
            "Booking number",
            FindingSeverity.ERROR,
        ),
        "shipper": (
            "Shipper",
            FindingSeverity.WARNING,
        ),
        "consignee": (
            "Consignee",
            FindingSeverity.WARNING,
        ),
        "vessel_name": (
            "Vessel name",
            FindingSeverity.WARNING,
        ),
        "voyage_number": (
            "Voyage number",
            FindingSeverity.WARNING,
        ),
        "port_of_loading": (
            "Port of loading",
            FindingSeverity.WARNING,
        ),
        "port_of_discharge": (
            "Port of discharge",
            FindingSeverity.WARNING,
        ),
    }

    def check(
        self,
        documents: list[ExtractedDocument],
    ) -> VerificationResult:
        findings: list[CheckFinding] = []

        for document in documents:
            findings.extend(
                self._check_document_quality(
                    document
                )
            )

        findings.extend(
            self._check_text_consistency(
                documents
            )
        )

        findings.extend(
            self._check_container_consistency(
                documents
            )
        )

        findings.extend(
            self._check_gross_weight_consistency(
                documents
            )
        )

        status = self._status_from_findings(
            findings
        )

        return VerificationResult(
            status=status,
            documents=documents,
            findings=findings,
            summary=self._build_summary(
                status,
                documents,
                findings,
            ),
        )

    def _check_document_quality(
        self,
        document: ExtractedDocument,
    ) -> list[CheckFinding]:
        findings: list[CheckFinding] = []

        if (
            document.document_type
            == DocumentType.UNKNOWN
        ):
            findings.append(
                CheckFinding(
                    rule_id="DOC-TYPE-001",
                    field="document_type",
                    severity=FindingSeverity.WARNING,
                    message=(
                        "Document type could not be "
                        "identified confidently."
                    ),
                    documents=[
                        document.source_filename
                    ],
                )
            )

        if document.confidence < 0.60:
            findings.append(
                CheckFinding(
                    rule_id="DOC-CONFIDENCE-001",
                    field="confidence",
                    severity=FindingSeverity.WARNING,
                    message=(
                        "Document extraction confidence "
                        f"is low "
                        f"({document.confidence:.0%})."
                    ),
                    documents=[
                        document.source_filename
                    ],
                )
            )

        if document.uncertain_fields:
            fields = ", ".join(
                document.uncertain_fields
            )

            findings.append(
                CheckFinding(
                    rule_id="DOC-UNCERTAIN-001",
                    severity=FindingSeverity.WARNING,
                    message=(
                        "Manual review may be required "
                        f"for uncertain fields: {fields}."
                    ),
                    documents=[
                        document.source_filename
                    ],
                )
            )

        return findings

    def _check_text_consistency(
        self,
        documents: list[ExtractedDocument],
    ) -> list[CheckFinding]:
        findings: list[CheckFinding] = []

        for field_name, (
            label,
            severity,
        ) in self.TEXT_FIELDS.items():

            values: dict[
                str,
                list[tuple[str, str]],
            ] = defaultdict(list)

            for document in documents:
                value = getattr(
                    document,
                    field_name,
                )

                if not value:
                    continue

                normalized = self._normalize_text(
                    value
                )

                values[normalized].append(
                    (
                        document.source_filename,
                        value,
                    )
                )

            # Less than two documents contain the field.
            if len(
                [
                    item
                    for entries in values.values()
                    for item in entries
                ]
            ) < 2:
                continue

            if len(values) <= 1:
                continue

            visible_values: list[str] = []
            affected_documents: list[str] = []

            for entries in values.values():
                for filename, original in entries:
                    visible_values.append(
                        f"{filename}: {original}"
                    )

                    affected_documents.append(
                        filename
                    )

            findings.append(
                CheckFinding(
                    rule_id=(
                        f"CONSISTENCY-"
                        f"{field_name.upper()}"
                    ),
                    field=field_name,
                    severity=severity,
                    message=(
                        f"{label} differs across "
                        f"documents: "
                        + "; ".join(visible_values)
                    ),
                    documents=sorted(
                        set(affected_documents)
                    ),
                )
            )

        return findings

    def _check_container_consistency(
        self,
        documents: list[ExtractedDocument],
    ) -> list[CheckFinding]:
        available: list[
            tuple[str, set[str]]
        ] = []

        for document in documents:
            if not document.container_numbers:
                continue

            container_set = {
                self._normalize_identifier(value)
                for value in document.container_numbers
                if value.strip()
            }

            if container_set:
                available.append(
                    (
                        document.source_filename,
                        container_set,
                    )
                )

        if len(available) < 2:
            return []

        unique_sets = {
            frozenset(values)
            for _, values in available
        }

        if len(unique_sets) == 1:
            return []

        descriptions = [
            (
                f"{filename}: "
                f"{', '.join(sorted(values))}"
            )
            for filename, values in available
        ]

        return [
            CheckFinding(
                rule_id="CONSISTENCY-CONTAINER",
                field="container_numbers",
                severity=FindingSeverity.ERROR,
                message=(
                    "Container numbers differ across "
                    "documents: "
                    + "; ".join(descriptions)
                ),
                documents=[
                    filename
                    for filename, _ in available
                ],
            )
        ]

    def _check_gross_weight_consistency(
        self,
        documents: list[ExtractedDocument],
    ) -> list[CheckFinding]:
        weights = [
            (
                document.source_filename,
                document.gross_weight_kg,
            )
            for document in documents
            if document.gross_weight_kg is not None
        ]

        if len(weights) < 2:
            return []

        numeric_weights = [
            weight
            for _, weight in weights
            if weight is not None
        ]

        minimum = min(numeric_weights)
        maximum = max(numeric_weights)

        if maximum == 0:
            return []

        difference_ratio = (
            maximum - minimum
        ) / maximum

        if (
            difference_ratio
            <= self.WEIGHT_TOLERANCE_RATIO
        ):
            return []

        descriptions = [
            f"{filename}: {weight:g} kg"
            for filename, weight in weights
            if weight is not None
        ]

        return [
            CheckFinding(
                rule_id="CONSISTENCY-GROSS-WEIGHT",
                field="gross_weight_kg",
                severity=FindingSeverity.ERROR,
                message=(
                    "Gross weight differs by more than "
                    f"{self.WEIGHT_TOLERANCE_RATIO:.0%} "
                    "across documents: "
                    + "; ".join(descriptions)
                ),
                documents=[
                    filename
                    for filename, _ in weights
                ],
            )
        ]

    @staticmethod
    def _normalize_text(
        value: str,
    ) -> str:
        normalized = value.casefold().strip()

        normalized = re.sub(
            r"[^\w]+",
            " ",
            normalized,
        )

        return re.sub(
            r"\s+",
            " ",
            normalized,
        ).strip()

    @staticmethod
    def _normalize_identifier(
        value: str,
    ) -> str:
        return re.sub(
            r"[^A-Z0-9]",
            "",
            value.upper(),
        )

    @staticmethod
    def _status_from_findings(
        findings: list[CheckFinding],
    ) -> VerificationStatus:
        if any(
            finding.severity
            == FindingSeverity.ERROR
            for finding in findings
        ):
            return VerificationStatus.FAIL

        if any(
            finding.severity
            == FindingSeverity.WARNING
            for finding in findings
        ):
            return (
                VerificationStatus.NEEDS_REVIEW
            )

        return VerificationStatus.PASS

    @staticmethod
    def _build_summary(
        status: VerificationStatus,
        documents: list[ExtractedDocument],
        findings: list[CheckFinding],
    ) -> str:
        error_count = sum(
            finding.severity
            == FindingSeverity.ERROR
            for finding in findings
        )

        warning_count = sum(
            finding.severity
            == FindingSeverity.WARNING
            for finding in findings
        )

        return (
            f"Checked {len(documents)} document(s). "
            f"Status: {status.value}. "
            f"{error_count} error(s), "
            f"{warning_count} warning(s)."
        )