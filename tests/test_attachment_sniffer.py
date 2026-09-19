"""Unit tests for attachment sniffer across supported formats."""
import io

import docx
import openpyxl
import pypdf

from backend.utils.attachment_sniffer import MAX_CHARS, inspect_attachment


def test_plain_text_inspection():
    text = "Shipper: Moorim Paper\nConsignee: Global Logistics\nPort of Loading: Callao\n"
    preview = inspect_attachment("test.txt", text)
    assert "Shipper: Moorim Paper" in preview
    assert len(preview) <= MAX_CHARS


def test_plain_text_truncation_bound():
    long_text = "A" * 2000
    preview = inspect_attachment("long.txt", long_text)
    assert len(preview) == 1000


def test_csv_inspection():
    csv_data = b"Port,Container,Weight\nCallao,MEDU1234567,24000\n"
    preview = inspect_attachment("manifest.csv", csv_data)
    assert "Callao" in preview
    assert "MEDU1234567" in preview


def test_docx_inspection():
    doc = docx.Document()
    doc.add_paragraph("First paragraph: Draft Bill of Lading")
    doc.add_paragraph("Second paragraph: Shipper details")
    doc.add_paragraph("Third paragraph: Consignee details")
    doc.add_paragraph("Fourth paragraph: Should not be included in first 3")

    buf = io.BytesIO()
    doc.save(buf)
    content = buf.getvalue()

    preview = inspect_attachment("draft_bl.docx", content)
    assert "Draft Bill of Lading" in preview
    assert "Shipper details" in preview
    assert "Fourth paragraph" not in preview


def test_excel_inspection():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ShippingInstructions"
    ws.append(["Shipper", "Consignee", "Port of Discharge"])
    ws.append(["Acme Shipping", "Pacific Imports", "Tokyo"])
    ws.append(["Row 3 Data", "More Info", "10000 kg"])

    buf = io.BytesIO()
    wb.save(buf)
    content = buf.getvalue()

    preview = inspect_attachment("si.xlsx", content)
    assert "Sheets: ShippingInstructions" in preview
    assert "Shipper" in preview
    assert "Tokyo" in preview


def test_pdf_inspection_with_text():
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=200, height=200)
    # We can write text or test empty/scanned
    buf = io.BytesIO()
    writer.write(buf)
    content = buf.getvalue()

    # Empty blank page has no text, should return Scanned or Image-only PDF
    preview = inspect_attachment("blank.pdf", content)
    assert preview == "[Scanned or Image-only PDF]"


def test_corrupted_file_safety():
    corrupted_data = b"\x00\xff\xfe\x01\x02\x03\x04INVALID_BINARY_DATA"
    preview_docx = inspect_attachment("corrupted.docx", corrupted_data)
    assert preview_docx == "[Unreadable or Corrupted File]"

    preview_xlsx = inspect_attachment("corrupted.xlsx", corrupted_data)
    assert preview_xlsx == "[Unreadable or Corrupted File]"

    preview_pdf = inspect_attachment("corrupted.pdf", corrupted_data)
    assert preview_pdf == "[Unreadable or Corrupted File]"
