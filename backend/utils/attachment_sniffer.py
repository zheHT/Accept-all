"""Safe content inspector for maritime shipping email attachments."""
import io
import os
from typing import Union

MAX_CHARS = 1000

SHIPPING_KEYWORDS = [
    "shipper",
    "consignee",
    "notify party",
    "port of loading",
    "port of discharge",
    "container",
    "gross weight",
    "bill of lading",
    "shipping instruction",
    "vessel",
    "voyage",
]


def inspect_attachment(filename: str, content: Union[bytes, str]) -> str:
    """Inspect and extract up to 1,000 characters from an attachment preview.

    Supports:
      - Plain text (.txt, .csv, .log)
      - Word (.docx) via python-docx
      - Excel (.xlsx, .xls) via openpyxl
      - PDF (.pdf) via pypdf

    Safely catches any parsing errors and returns informative indicators:
      - "[Scanned or Image-only PDF]" when PDF has no text layer
      - "[Unreadable or Corrupted File]" on corruption or parser exception
    """
    if not filename:
        filename = ""

    ext = os.path.splitext(filename.lower())[1]

    try:
        # 1. Plain text / CSV files
        if ext in [".txt", ".csv", ".tsv", ".log", ".json", ".xml", ".html", ".md"]:
            if isinstance(content, bytes):
                text = content.decode("utf-8", errors="replace")
            else:
                text = str(content)
            return text[:MAX_CHARS].strip()

        # If content is already a string but file has binary extension, return truncated string
        if isinstance(content, str):
            # If string is empty or already an error tag, return it
            if not content.strip():
                return "[Unreadable or Corrupted File]"
            return content[:MAX_CHARS].strip()

        # From here, content is bytes
        if not content or len(content) == 0:
            return "[Unreadable or Corrupted File]"

        stream = io.BytesIO(content)

        # 2. PDF files (.pdf)
        if ext == ".pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(stream)
                if not reader.pages or len(reader.pages) == 0:
                    return "[Scanned or Image-only PDF]"
                page1 = reader.pages[0]
                text = page1.extract_text() or ""
                clean_text = text.strip()
                if not clean_text:
                    return "[Scanned or Image-only PDF]"
                return clean_text[:MAX_CHARS]
            except Exception:
                return "[Unreadable or Corrupted File]"

        # 3. Word documents (.docx)
        elif ext == ".docx":
            try:
                import docx
                doc = docx.Document(stream)
                non_empty_paras = []
                for p in doc.paragraphs:
                    t = p.text.strip()
                    if t:
                        non_empty_paras.append(t)
                    if len(non_empty_paras) >= 3:
                        break
                if not non_empty_paras:
                    # Also check tables in docx
                    for table in doc.tables:
                        for row in table.rows:
                            row_text = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
                            if row_text:
                                non_empty_paras.append(row_text)
                            if len(non_empty_paras) >= 3:
                                break
                        if len(non_empty_paras) >= 3:
                            break
                joined = "\n".join(non_empty_paras).strip()
                return (joined[:MAX_CHARS] if joined else "[Unreadable or Corrupted File]")
            except Exception:
                return "[Unreadable or Corrupted File]"

        # 4. Excel spreadsheets (.xlsx, .xls)
        elif ext in [".xlsx", ".xlsm", ".xltx", ".xltm"]:
            try:
                import openpyxl
                wb = openpyxl.load_workbook(stream, data_only=True, read_only=True)
                sheet_names = wb.sheetnames
                lines = [f"Sheets: {', '.join(sheet_names)}"]
                first_sheet = wb[sheet_names[0]] if sheet_names else None
                if first_sheet:
                    row_count = 0
                    for row in first_sheet.iter_rows(values_only=True):
                        cells = [str(c).strip() for c in row if c is not None and str(c).strip() != ""]
                        if cells:
                            lines.append(" | ".join(cells))
                            row_count += 1
                        if row_count >= 3:
                            break
                joined = "\n".join(lines).strip()
                return joined[:MAX_CHARS] if joined else "[Unreadable or Corrupted File]"
            except Exception:
                return "[Unreadable or Corrupted File]"

        # 5. Unsupported binary file formats (e.g. .png, .jpg, .zip, .exe)
        else:
            # Attempt UTF-8 decode in case it's misnamed text
            try:
                decoded = content.decode("utf-8")
                return decoded[:MAX_CHARS].strip()
            except Exception:
                return "[Unreadable or Corrupted File]"

    except Exception:
        return "[Unreadable or Corrupted File]"
