from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from backend.core.blob_store import BlobStore
from backend.core.publisher import TaskPublisher
from backend.core.repository import CaseRepository
from backend.core.schemas import IngestionState, ProcessingState


def stable_case_id(source_type: str, source_message_id: str) -> str:
    digest = hashlib.sha256(f"{source_type}:{source_message_id}".encode()).hexdigest()[:24]
    return f"case-{digest}"


def safe_filename(filename: str) -> str:
    name = Path(filename).name
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)[:180] or "attachment"


class CaseIngestor:
    def __init__(
        self,
        repository: CaseRepository,
        blobs: BlobStore,
        publisher: TaskPublisher,
        *,
        max_upload_bytes: int,
    ) -> None:
        self.repository = repository
        self.blobs = blobs
        self.publisher = publisher
        self.max_upload_bytes = max_upload_bytes

    def ingest(
        self,
        metadata: dict[str, Any],
        attachments: list[tuple[str, str, bytes]],
        *,
        publish: bool = True,
        allow_append: bool = False,
    ) -> tuple[dict[str, Any], bool]:
        source_type = metadata["source_type"]
        source_message_id = metadata["source_message_id"]
        case_id = stable_case_id(source_type, source_message_id)
        validated_attachments: list[tuple[str, str, bytes, str]] = []
        for filename, content_type, data in attachments:
            filename = safe_filename(filename)
            if len(data) > self.max_upload_bytes:
                raise ValueError(f"attachment exceeds {self.max_upload_bytes} bytes: {filename}")
            digest = hashlib.sha256(data).hexdigest()
            validated_attachments.append((filename, content_type, data, digest))

        incoming_ids = {item[3] for item in validated_attachments}
        initial_payload = {
            **metadata,
            "processing_state": ProcessingState.DRAFT.value,
            "ingestion_state": IngestionState.PENDING.value,
            "expected_document_ids": sorted(incoming_ids),
        }
        case, created = self.repository.create_case(case_id, initial_payload)

        existing_documents = self.repository.list_documents(case_id)
        existing_ids = {
            str(document.get("sha256") or document.get("document_id"))
            for document in existing_documents
        }
        expected_ids = set(case.get("expected_document_ids") or existing_ids)
        if not created:
            if allow_append:
                expected_ids |= incoming_ids
            elif expected_ids != incoming_ids:
                raise ValueError("attachment set conflicts with immutable existing case")
            elif case.get("ingestion_state") == IngestionState.TASK_PUBLISHED.value:
                return case, False

        if expected_ids != set(case.get("expected_document_ids") or []):
            case = self.repository.update_case(
                case_id,
                {
                    "expected_document_ids": sorted(expected_ids),
                    "ingestion_state": IngestionState.PENDING.value,
                    "processing_state": ProcessingState.DRAFT.value,
                },
            )

        missing_ids = expected_ids - existing_ids
        for filename, content_type, data, digest in validated_attachments:
            if digest not in missing_ids:
                continue
            document_id = digest
            object_name = f"cases/{case_id}/raw/{digest}-{filename}"
            uri = self.blobs.upload(object_name, data, content_type or "application/octet-stream")
            self.repository.add_document(
                case_id,
                document_id,
                {
                    "filename": filename,
                    "content_type": content_type or "application/octet-stream",
                    "size_bytes": len(data),
                    "sha256": digest,
                    "gcs_uri": uri,
                },
            )
            existing_ids.add(digest)

        if expected_ids - existing_ids:
            missing = ", ".join(sorted(expected_ids - existing_ids))
            raise RuntimeError(f"ingestion incomplete; missing documents: {missing}")

        case = self.repository.update_case(
            case_id,
            {
                "ingestion_state": IngestionState.DOCUMENTS_STORED.value,
                "expected_document_ids": sorted(expected_ids),
            },
        )
        self.repository.append_event(
            case_id,
            "ingested" if created else "attachment_appended",
            {"source_type": source_type},
        )
        if publish:
            message_id = self.publisher.publish({"case_id": case_id})
            case = self.repository.update_case(
                case_id,
                {
                    "ingestion_state": IngestionState.TASK_PUBLISHED.value,
                    "processing_state": ProcessingState.QUEUED.value,
                    "task_message_id": message_id,
                },
            )
            self.repository.append_event(
                case_id,
                "task_published",
                {"message_id": message_id},
            )
        return case, created
