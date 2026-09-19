from __future__ import annotations

import html
import re

_TABLE_DIVIDER = re.compile(r"^:?-{3,}:?$")


def _inline(value: str) -> str:
    """Render a deliberately small, escaped Markdown inline subset."""
    escaped = html.escape(value, quote=True)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", escaped)
    return escaped


def _table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_table_divider(line: str) -> bool:
    cells = _table_cells(line)
    return bool(cells) and all(_TABLE_DIVIDER.fullmatch(cell) for cell in cells)


def _starts_block(lines: list[str], index: int) -> bool:
    line = lines[index].strip()
    if not line:
        return True
    if line.startswith(("# ", "## ", "### ", "> ", "- ", "* ")):
        return True
    return index + 1 < len(lines) and "|" in line and _is_table_divider(lines[index + 1])


def render_markdown(markdown: str) -> str:
    """Render publisher Markdown as safe semantic HTML without accepting stored HTML."""
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue

        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            level = len(heading.group(1))
            blocks.append(f"<h{level}>{_inline(heading.group(2))}</h{level}>")
            index += 1
            continue

        if index + 1 < len(lines) and "|" in line and _is_table_divider(lines[index + 1]):
            headers = _table_cells(line)
            index += 2
            rows: list[list[str]] = []
            while index < len(lines) and "|" in lines[index] and lines[index].strip():
                rows.append(_table_cells(lines[index]))
                index += 1
            header_html = "".join(f"<th scope='col'>{_inline(cell)}</th>" for cell in headers)
            body_rows = []
            for row in rows:
                padded = row + [""] * max(0, len(headers) - len(row))
                cells = "".join(f"<td>{_inline(cell)}</td>" for cell in padded[: len(headers)])
                body_rows.append(f"<tr>{cells}</tr>")
            blocks.append(
                "<div class='table-wrap'><table><thead><tr>"
                f"{header_html}</tr></thead><tbody>{''.join(body_rows)}</tbody></table></div>"
            )
            continue

        if line.startswith(("- ", "* ")):
            items: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(("- ", "* ")):
                items.append(f"<li>{_inline(lines[index].strip()[2:])}</li>")
                index += 1
            blocks.append(f"<ul>{''.join(items)}</ul>")
            continue

        if line.startswith("> "):
            quotes: list[str] = []
            while index < len(lines) and lines[index].strip().startswith("> "):
                quotes.append(_inline(lines[index].strip()[2:]))
                index += 1
            blocks.append(f"<blockquote>{'<br>'.join(quotes)}</blockquote>")
            continue

        paragraph = [line]
        index += 1
        while index < len(lines) and not _starts_block(lines, index):
            paragraph.append(lines[index].strip())
            index += 1
        blocks.append(f"<p>{' '.join(_inline(part) for part in paragraph)}</p>")

    return "\n".join(blocks)


def render_preview_document(markdown: str) -> str:
    content = render_markdown(markdown)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>ClassAll knowledge preview</title>
  <style>
    :root {{ color-scheme: light; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: clamp(18px, 4vw, 48px);
      color: #203532;
      background: #edf4f3;
      font: 15px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }}
    .document {{
      width: min(860px, 100%);
      margin: 0 auto;
      padding: clamp(26px, 6vw, 68px);
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 1px 3px rgb(13 27 30 / .08), 0 24px 70px -40px rgb(13 27 30 / .36);
    }}
    h1 {{
      margin: 0 0 30px;
      color: #102c2b;
      font-size: clamp(27px, 5vw, 40px);
      line-height: 1.12;
      letter-spacing: -.025em;
    }}
    h2 {{
      margin: 38px 0 14px;
      padding-top: 26px;
      border-top: 1px solid #dce7e5;
      color: #173f3d;
      font-size: 19px;
      line-height: 1.3;
      letter-spacing: -.012em;
    }}
    h3 {{ margin: 26px 0 10px; color: #245653; font-size: 16px; }}
    p {{ margin: 0 0 16px; text-wrap: pretty; }}
    strong {{ color: #102c2b; }}
    em {{ color: #60736f; }}
    code {{
      padding: 2px 5px;
      border-radius: 5px;
      background: #edf6f4;
      color: #175452;
      font: .9em ui-monospace, "SFMono-Regular", Consolas, monospace;
    }}
    ul {{ margin: 10px 0 20px; padding-left: 22px; }}
    li {{ margin: 6px 0; }}
    blockquote {{
      margin: 20px 0;
      padding: 14px 18px;
      border-radius: 10px;
      background: #eff7f6;
      color: #315754;
    }}
    .table-wrap {{ margin: 16px 0 26px; overflow-x: auto; border-radius: 12px; box-shadow: 0 0 0 1px #dce7e5; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }}
    th {{ background: #eff7f6; color: #315754; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }}
    th, td {{ padding: 11px 14px; border-bottom: 1px solid #e5eceb; text-align: left; vertical-align: top; }}
    tbody tr:last-child td {{ border-bottom: 0; }}
    tbody tr:hover {{ background: #f8fbfa; }}
    @media (max-width: 520px) {{
      body {{ padding: 0; background: #fff; }}
      .document {{ padding: 24px 20px 40px; border-radius: 0; box-shadow: none; }}
      h2 {{ margin-top: 30px; }}
      th, td {{ min-width: 128px; padding: 10px 12px; }}
    }}
  </style>
</head>
<body><article class="document">{content}</article></body>
</html>"""
