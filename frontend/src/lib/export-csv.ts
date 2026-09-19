/** Builds a CSV from row objects and triggers a browser download. */
export function downloadCsv(filename: string, rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const body = rows.map((row) => headers.map((header) => escape(row[header] ?? "")).join(","));
  // BOM keeps Excel happy with UTF-8 company names.
  const csv = `\ufeff${[headers.join(","), ...body].join("\r\n")}`;

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
