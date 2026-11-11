import { readFeeArchive } from "./fee-schedule-archive";
import { archiveSelection, type ArchiveSelection } from "./fee-archive-selection";
import { ARCHIVE_TABLES, archiveTable } from "./fee-archive-tables";
import { ArchiveMember, zipMember } from "./fee-schedule-zip";
import { stageFeeTable, type FeeScheduleEvidence } from "./fee-schedule-evidence";
import type { IngestResultSummary } from "./ingest-control";
import { fail } from "./fee-schedule-http";

interface ArchiveEvidence extends FeeScheduleEvidence {
  archive_url: string;
  archive_sha256: string;
  release_page_url: string;
  page_sha256: string;
  download_updated_date_label: string | null;
  source_member: string;
  member_crc32: number;
  member_crc32_verified: boolean;
  header_rows_json: string;
  source_preamble_json: string;
  columns_json: string;
  data_row_count: number;
  auxiliary_row_count: number;
}
interface CsvChunk { source_member: string; chunk_index: number; csv_text_chunk: string }

function textChunks(source_member: string, raw: string): CsvChunk[] {
  const chunks: CsvChunk[] = [];
  for (let start = 0; start < raw.length;) {
    let end = Math.min(start + 8000, raw.length);
    const last = raw.charCodeAt(end - 1);
    if (end < raw.length && last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push({ source_member, chunk_index: chunks.length, csv_text_chunk: raw.slice(start, end) }); start = end;
  }
  return chunks;
}

/** Build all six source tables and raw CSV evidence before any promotion. */
export async function stageFeeArchive(
  target: Parameters<typeof stageFeeTable>[0], input: ArchiveSelection, results: IngestResultSummary[],
) {
  const { members, archive } = await selectArchiveMembers(input);
  const chunks: CsvChunk[] = [];
  for (const { definition, member } of members) {
    const { decoded, rows, table, dataRows } = await stageArchiveMember(archive, member, definition, target, chunks);
    const evidence: ArchiveEvidence = {
      source_key: definition.kind, table_name: definition.table, source_url: archive.evidence.archive_url,
      configured_period: archive.evidence.effective_month, retrieved_at: archive.evidence.retrieved_at,
      csv_sha256: decoded.member_sha256, http_etag: archive.evidence.http_etag, http_last_modified: archive.evidence.http_last_modified,
      row_count: rows.length, release_code: archive.evidence.release, effective_month: archive.evidence.effective_month,
      qp_classification: definition.qp, archive_url: archive.evidence.archive_url, archive_sha256: archive.evidence.archive_sha256,
      release_page_url: archive.evidence.source_url, page_sha256: archive.evidence.page_sha256,
      download_updated_date_label: archive.evidence.download_updated_date_label, source_member: member.name,
      member_crc32: member.crc32, member_crc32_verified: decoded.member_crc32_verified,
      header_rows_json: JSON.stringify(table.header_rows), source_preamble_json: JSON.stringify(table.source_preamble),
      columns_json: JSON.stringify(table.columns), data_row_count: dataRows, auxiliary_row_count: rows.length - dataRows,
    };
    results.push({ key: definition.kind, name: member.name, tableName: definition.table, rows: rows.length, status: "ok", evidence });
  }
  await stageFeeTable(target, "fee_schedule_csv_chunks", chunks, ["source_member"], { source_member: "TEXT", chunk_index: "INTEGER", csv_text_chunk: "TEXT" });
  await stageFeeTable(target, "fee_schedule_sources", results.map(result => result.evidence));
  await stageFeeTable(target, "fee_schedule_archive_metadata", [{
    ...archive.evidence, loaded_into_fee_schedules: undefined,
    members_json: JSON.stringify(archive.members.map(({ offset: _offset, data_limit: _limit, flags: _flags, ...member }) => member)),
    scope: "All six recognized CSV members. Alternative TXT/XLSX/PDF members remain in the manifest; no payment or eligibility calculation. Publication and effective dates are separate.",
  }]);
}

async function selectArchiveMembers(input: ArchiveSelection) {
  const selection = archiveSelection(input);
  const archive = await readFeeArchive({ ...selection });
  if (!archive.evidence.effective_month?.startsWith("2026-")) fail("Archive effective year/layout is not qualified", 422);
  const members = ARCHIVE_TABLES.map(definition => {
    const candidates = archive.members.filter(member => definition.pattern.test(member.name));
    if (candidates.length !== 1) fail(`Archive requires exactly one ${definition.kind} CSV`, 502);
    return { definition, member: candidates[0] };
  });
  if (archive.members.filter(member => /\.csv$/i.test(member.name)).length !== members.length) fail("Archive contains additional unqualified CSV members", 422);
  return { members, archive: { ...archive, evidence: { ...archive.evidence, effective_month: archive.evidence.effective_month } } };
}

async function stageArchiveMember(archive: { bytes: Uint8Array<ArrayBufferLike>; members: ArchiveMember[]; evidence: { release: string; source_url: string; page_sha256: string; effective_month: string | null; archive_url: string; download_updated_date_label: string | null; archive_sha256: string; archive_bytes: number; expected_archive_sha256_matched: boolean; retrieved_at: string; http_etag: string | null; http_last_modified: string | null; loaded_into_fee_schedules: boolean; snapshot_scope: string; }; }, member: ArchiveMember, definition: { readonly kind: "rvu_qp"; readonly table: "pfs_rvu_qp"; readonly pattern: RegExp; readonly qp: "QP"; } | { readonly kind: "rvu_non_qp"; readonly table: "pfs_rvu_non_qp"; readonly pattern: RegExp; readonly qp: "non-QP"; } | { readonly kind: "gpci"; readonly table: "pfs_gpci"; readonly pattern: RegExp; readonly qp: "not_applicable"; } | { readonly kind: "locality_counties"; readonly table: "pfs_locality_counties"; readonly pattern: RegExp; readonly qp: "not_applicable"; } | { readonly kind: "opps_caps"; readonly table: "pfs_opps_caps"; readonly pattern: RegExp; readonly qp: "not_applicable"; } | { readonly kind: "anesthesia"; readonly table: "pfs_anesthesia"; readonly pattern: RegExp; readonly qp: "separate_columns"; }, target: Parameters<typeof stageFeeTable>[0], chunks: CsvChunk[]) {
  const decoded = await zipMember(archive.bytes, member);
  // Preserve a UTF-8 BOM in raw chunks; the matrix parser handles it separately.
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decoded.bytes);
  const table = archiveTable(raw, definition);
  if (table.columns.includes("source_csv_row") || table.columns.includes("source_row_kind")) fail("Source headers conflict with CSV row metadata", 502);
  const rows = table.records.map((row, i) => ({ ...row, source_csv_row: table.first_record_row + i, source_row_kind: table.row_kinds[i] }));
  await stageFeeTable(target, definition.table, rows, [], {
    ...Object.fromEntries(table.columns.map(column => [column, "TEXT"])), source_csv_row: "INTEGER", source_row_kind: "TEXT",
  });
  chunks.push(...textChunks(member.name, raw));
  const dataRows = table.row_kinds.filter(kind => kind === "data").length;
  return { decoded, rows, table, dataRows };
}
