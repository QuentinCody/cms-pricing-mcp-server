import { csvMatrix, csvRecords, pfsCsv } from "./fee-schedule-csv";
import { fail } from "./fee-schedule-http";

export const ARCHIVE_TABLES = [
  { kind: "rvu_qp", table: "pfs_rvu_qp", pattern: /^PPRRVU2026_[A-Za-z]+_QPP\.csv$/, qp: "QP" },
  { kind: "rvu_non_qp", table: "pfs_rvu_non_qp", pattern: /^PPRRVU2026_[A-Za-z]+_nonQPP\.csv$/, qp: "non-QP" },
  { kind: "gpci", table: "pfs_gpci", pattern: /^GPCI2026\.csv$/, qp: "not_applicable" },
  { kind: "locality_counties", table: "pfs_locality_counties", pattern: /^26LOCCO\.csv$/, qp: "not_applicable" },
  { kind: "opps_caps", table: "pfs_opps_caps", pattern: /^OPPSCAP_[A-Za-z]+\.csv$/, qp: "not_applicable" },
  { kind: "anesthesia", table: "pfs_anesthesia", pattern: /^ANES2026\.csv$/, qp: "separate_columns" },
] as const;
export type ArchiveTable = typeof ARCHIVE_TABLES[number];

/** Supporting rows include blank separators and footnotes, without forward-filling cells. */
export function archiveTable(raw: string, definition: ArchiveTable) {
  if (definition.kind.startsWith("rvu_")) {
    const csv = pfsCsv(raw);
    const row_kinds = csv.records.map(row => Object.values(row).every(cell => cell === "") ? "blank" : /^[A-Z0-9]{5}$/.test(row.HCPCS) ? "data" : "note");
    return { ...csv, row_kinds, first_record_row: 11 };
  }
  const matrix = csvMatrix(raw);
  const offset = ["gpci", "locality_counties"].includes(definition.kind) ? 2 : 0;
  const header = matrix[offset];
  const widths = { gpci: 7, locality_counties: 6, opps_caps: 7, anesthesia: 5 };
  const expectedWidth = widths[definition.kind as keyof typeof widths];
  if (!header || header.length !== expectedWidth || matrix.length <= offset + 1) fail(`Unsupported ${definition.kind} CSV layout`, 502);
  const first = { gpci: "Medicare Administrative Contractor (MAC)", locality_counties: "Medicare Adminstrative Contractor", opps_caps: "HCPCS", anesthesia: "Contractor" };
  if (header[0] !== first[definition.kind as keyof typeof first]) fail(`Unexpected ${definition.kind} CSV header`, 502);
  if (definition.kind === "gpci" && !header[4].startsWith("2026 PW GPCI")) fail("GPCI year/header mismatch", 502);
  if (definition.kind === "anesthesia" && (!header[3].startsWith("Qualifying APM") || !header[4].startsWith("Non-Qualifying APM"))) fail("Anesthesia QP columns are not recognized", 502);
  const columns = header.map((cell, i) => cell || `unnamed_column_${i + 1}`);
  const rows = matrix.slice(offset + 1);
  const row_kinds = rows.map(row => row.every(cell => cell === "") ? "blank" :
    (definition.kind === "opps_caps" ? /^[A-Z0-9]{5}$/.test(row[0]) : /^\d{5}\s*$/.test(row[0])) ? "data" : "note");
  return { source_preamble: matrix.slice(0, offset), header_rows: [header], columns, records: csvRecords(columns, rows), row_kinds, first_record_row: offset + 2 };
}
