from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from backend.core.blob_store import BlobStore
from backend.core.documents import SUPPORTED_EXTENSIONS
from backend.core.publisher import TaskPublisher
from backend.core.repository import CaseRepository


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
        validated_attachments: list[tuple[str, str, bytes]] = []
        for filename, content_type, data in attachments:
            filename = safe_filename(filename)
            if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
                raise ValueError(f"unsupported attachment type: {filename}")
            if len(data) > self.max_upload_bytes:
                raise ValueError(f"attachment exceeds {self.max_upload_bytes} bytes: {filename}")
            validated_attachments.append((filename, content_type, data))

        case, created = self.repository.create_case(case_id, metadata)
        if not created and not allow_append:
            return case, False

        for filename, content_type, data in validated_attachments:
            digest = hashlib.sha256(data).hexdigest()
            document_id = digest[:24]
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
        self.repository.append_event(
            case_id,
            "ingested" if created else "attachment_appended",
            {"source_type": source_type},
        )
        if publish:
            self.publisher.publish({"case_id": case_id})
        return self.repository.get_case(case_id) or case, True
