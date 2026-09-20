from __future__ import annotations

import argparse
import hashlib
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from google.cloud import firestore, storage

CONTENT_TYPES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@dataclass(frozen=True)
class AttachmentMetadata:
    filename: str
    content_type: str
    size_bytes: int
    sha256: str


@dataclass(frozen=True)
class RepairPlan:
    snapshot: Any
    case_id: str
    source: Path
    object_name: str
    gcs_uri: str
    metadata: AttachmentMetadata
    upload_required: bool
    metadata_update_required: bool


def inspect_attachment(path: Path) -> AttachmentMetadata:
    suffix = path.suffix.lower()
    content_type = CONTENT_TYPES.get(suffix)
    if content_type is None:
        raise ValueError(f"unsupported attachment type: {path.name}")

    data = path.read_bytes()
    if not data:
        raise ValueError(f"attachment is empty: {path.name}")
    if suffix == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError(f"invalid PDF signature: {path.name}")
    elif suffix in {".docx", ".xlsx"} and not zipfile.is_zipfile(path):
        raise ValueError(f"invalid Office package: {path.name}")
    elif suffix == ".txt":
        data.decode("utf-8")

    return AttachmentMetadata(
        filename=path.name,
        content_type=content_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )


def canonical_object_name(case_id: str, metadata: AttachmentMetadata) -> str:
    return f"cases/{case_id}/raw/{metadata.sha256}-{metadata.filename}"


def build_plans(
    *,
    db: firestore.Client,
    bucket: storage.Bucket,
    attachments: Path,
) -> list[RepairPlan]:
    if not attachments.is_dir():
        raise ValueError(f"attachment directory does not exist: {attachments}")

    existing_objects = {blob.name for blob in bucket.list_blobs()}
    plans: list[RepairPlan] = []
    errors: list[str] = []

    for snapshot in db.collection_group("documents").stream():
        document = snapshot.to_dict()
        filename = str(document.get("filename") or "")
        if not filename or Path(filename).name != filename:
            errors.append(f"{snapshot.reference.path}: unsafe or missing filename {filename!r}")
            continue
        source = attachments / filename
        if not source.is_file():
            errors.append(f"{snapshot.reference.path}: source file not found: {source}")
            continue
        try:
            metadata = inspect_attachment(source)
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(f"{snapshot.reference.path}: {exc}")
            continue

        case_ref = snapshot.reference.parent.parent
        if case_ref is None:
            errors.append(f"{snapshot.reference.path}: document has no parent case")
            continue
        case_id = case_ref.id
        object_name = canonical_object_name(case_id, metadata)
        gcs_uri = f"gs://{bucket.name}/{object_name}"
        expected = {
            "filename": metadata.filename,
            "content_type": metadata.content_type,
            "size_bytes": metadata.size_bytes,
            "sha256": metadata.sha256,
            "gcs_uri": gcs_uri,
        }
        plans.append(
            RepairPlan(
                snapshot=snapshot,
                case_id=case_id,
                source=source,
                object_name=object_name,
                gcs_uri=gcs_uri,
                metadata=metadata,
                upload_required=object_name not in existing_objects,
                metadata_update_required=any(document.get(key) != value for key, value in expected.items()),
            )
        )

    if errors:
        detail = "\n".join(errors[:20])
        suffix = f"\n... and {len(errors) - 20} more" if len(errors) > 20 else ""
        raise RuntimeError(f"repair validation failed:\n{detail}{suffix}")
    return plans


def apply_plans(plans: list[RepairPlan], bucket: storage.Bucket) -> tuple[int, int]:
    uploads = 0
    updates = 0
    for plan in plans:
        if plan.upload_required:
            bucket.blob(plan.object_name).upload_from_filename(
                plan.source,
                content_type=plan.metadata.content_type,
                if_generation_match=0,
            )
            uploads += 1
        if plan.metadata_update_required:
            plan.snapshot.reference.update(
                {
                    "filename": plan.metadata.filename,
                    "content_type": plan.metadata.content_type,
                    "size_bytes": plan.metadata.size_bytes,
                    "sha256": plan.metadata.sha256,
                    "gcs_uri": plan.gcs_uri,
                }
            )
            updates += 1
    return uploads, updates


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Restore dataset attachment bytes to GCS and repair Firestore metadata."
    )
    parser.add_argument("--attachments", type=Path, required=True)
    parser.add_argument("--project", default="gen-lang-client-0866395749")
    parser.add_argument("--database", default="(default)")
    parser.add_argument("--bucket", default="gen-lang-client-0866395749-classall-docs")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Upload and update records. Without this flag the command is read-only.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    db = firestore.Client(project=args.project, database=args.database)
    bucket = storage.Client(project=args.project).bucket(args.bucket)
    plans = build_plans(db=db, bucket=bucket, attachments=args.attachments.resolve())
    uploads = sum(plan.upload_required for plan in plans)
    updates = sum(plan.metadata_update_required for plan in plans)
    print(
        f"validated={len(plans)} uploads_required={uploads} "
        f"metadata_updates_required={updates}"
    )
    if not args.apply:
        print("dry-run complete; pass --apply to repair these records")
        return 0
    uploaded, updated = apply_plans(plans, bucket)
    print(f"repair complete; uploaded={uploaded} metadata_updated={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
