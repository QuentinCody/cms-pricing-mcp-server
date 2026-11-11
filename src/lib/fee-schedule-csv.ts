import { fail } from "./fee-schedule-http";

/** Preserve source whitespace, blank rows, quoted newlines and numeric text. */
export function csvMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const endField = () => { row.push(field); field = ""; closed = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (input[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (ch === ",") endField();
    else if (ch === "\r" || ch === "\n") { endRow(); if (ch === "\r" && input[i + 1] === "\n") i++; }
    else if (ch === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || ch === '"') fail("Invalid CMS CSV quoting", 502);
      field += ch;
    }
  }
  if (quoted) fail("Incomplete CMS CSV quoted field", 502);
  if (field !== "" || row.length || closed) endRow();
  return rows;
}

export function csvRecords(columns: string[], rows: string[][]): Record<string, string>[] {
  if (!columns.length || columns.some(c => !c) || new Set(columns).size !== columns.length) fail("CMS CSV columns must be nonempty and unique", 502);
  return rows.map(row => {
    if (row.length !== columns.length) fail("CMS CSV row width differs from header", 502);
    return Object.fromEntries(columns.map((column, i) => [column, row[i]]));
  });
}

/** Qualify the observed 2026 PFS layout; retain its complete original header matrix. */
export function pfsCsv(raw: string) {
  const rows = csvMatrix(raw);
  const header = rows[9];
  if (rows.length <= 10 || header?.length !== 32 || header[0] !== "HCPCS" || header[1] !== "MOD" || header[2] !== "DESCRIPTION" || header[25] !== "FACTOR") fail("Unsupported PFS archive CSV layout", 502);
  const header_rows = rows.slice(5, 10);
  if (header_rows.some(row => row.length !== 32)) fail("Invalid PFS multirow header", 502);
  const columns = header.map((_, i) => header_rows.map(row => row[i]).filter(Boolean).join(" "));
  return { source_preamble: rows.slice(0, 5), header_rows, columns, records: csvRecords(columns, rows.slice(10)) };
}
