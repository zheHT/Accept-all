from pathlib import Path

import pytest
from pypdf import PdfWriter

from scripts.repair_dataset_attachments import canonical_object_name, inspect_attachment


def test_pdf_repair_metadata_uses_real_bytes_and_canonical_path(tmp_path: Path):
    source = tmp_path / "email_499_SI.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    with source.open("wb") as target:
        writer.write(target)

    metadata = inspect_attachment(source)

    assert metadata.content_type == "application/pdf"
    assert metadata.size_bytes == source.stat().st_size
    assert canonical_object_name("case-email-499", metadata).endswith(
        f"-{source.name}"
    )


def test_text_repair_metadata_is_content_addressed(tmp_path: Path):
    source = tmp_path / "email_001_SI.txt"
    source.write_text("Shipping instruction", encoding="utf-8")

    metadata = inspect_attachment(source)

    assert metadata.content_type == "text/plain"
    assert metadata.size_bytes == len(b"Shipping instruction")
    assert canonical_object_name("case-email-001", metadata) == (
        f"cases/case-email-001/raw/{metadata.sha256}-email_001_SI.txt"
    )


def test_repair_rejects_extension_content_mismatch(tmp_path: Path):
    source = tmp_path / "not-really-a.pdf"
    source.write_text("plain text", encoding="utf-8")

    with pytest.raises(ValueError, match="invalid PDF signature"):
        inspect_attachment(source)
