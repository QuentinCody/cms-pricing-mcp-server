import { boundedFetch, fail, sha256 } from "./fee-schedule-http";
import { feeScheduleDetail } from "./fee-schedule-releases";
import { zipMembers, zipMember } from "./fee-schedule-zip";
import { pfsCsv } from "./fee-schedule-csv";

function expectedHash(value: unknown, name: string) {
  if (value !== undefined && (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value))) fail(`${name} must be a SHA-256 digest`);
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

export async function readFeeArchive(params: Record<string, unknown>) {
  const expected = expectedHash(params.expected_archive_sha256, "expected_archive_sha256");
  const detail = await feeScheduleDetail({ release: params.release, ...(params.expected_page_sha256 === undefined ? {} : { expected_page_sha256: params.expected_page_sha256 }) });
  const selected = params.archive_url === undefined && detail.downloads.length === 1 ? detail.downloads[0] : detail.downloads.find(download => download.url === params.archive_url);
  if (!selected) fail("Select an exact archive_url from this release's downloads");
  const { response, bytes } = await boundedFetch(selected.url, "application/zip", 16 * 1024 * 1024);
  const archive_sha256 = await sha256(bytes);
  if (expected && expected !== archive_sha256) throw Object.assign(new Error("CMS archive changed; reselect the source snapshot"), { status: 409, data: { expected_sha256: expected, observed_sha256: archive_sha256, source_url: selected.url } });
  const members = zipMembers(bytes);
  return { bytes, members, evidence: {
    release: detail.release, source_url: detail.source_url, page_sha256: detail.page_sha256,
    effective_month: detail.effective_month, archive_url: selected.url, download_updated_date_label: selected.updated_date_label,
    archive_sha256, archive_bytes: bytes.length, expected_archive_sha256_matched: expected !== undefined,
    retrieved_at: new Date().toISOString(), http_etag: response.headers.get("etag"), http_last_modified: response.headers.get("last-modified"),
    loaded_into_fee_schedules: false,
    snapshot_scope: "Complete retrieved ZIP bytes, not an immutable release or provider-published checksum. Publication, effective month and retrieval time are separate.",
  } };
}

function selection(params: Record<string, unknown>) {
  if (params.qp !== "QP" && params.qp !== "non-QP") fail("Select qp explicitly: QP or non-QP; clinician eligibility is not inferred");
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 500;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 1000) fail("offset must be a nonnegative safe integer and limit must be 1–1000");
  if (offset > 0 && params.expected_archive_sha256 === undefined) fail("Continuation requires expected_archive_sha256 from the preceding response");
  return { qp: params.qp, offset, limit };
}

export async function feeArchiveRoute(path: string, params: Record<string, unknown>) {
  const isRows = path === "/fee-schedules/rvus";
  if (!isRows && path !== "/fee-schedules/archive") fail("Unknown fee archive route", 404);
  const allowed = ["release", "archive_url", "expected_page_sha256", "expected_archive_sha256", ...(isRows ? ["qp", "offset", "limit"] : [])];
  if (Object.keys(params).some(key => !allowed.includes(key))) fail("Unsupported fee archive parameter");
  const page = isRows ? selection(params) : undefined;
  const archive = await readFeeArchive(params);
  if (!page) return { ...archive.evidence, members: archive.members.map(({ offset: _offset, flags: _flags, data_limit: _limit, ...member }) => member),
    note: "Member sizes/CRC32 are declared by the ZIP directory; selected RVU reads verify CRC32 and compute a member SHA-256. No clinician eligibility or payment is calculated." };
  // The separate QPP/nonQPP layout is verified for 2026. Older/future layouts fail explicitly.
  if (!archive.evidence.effective_month?.startsWith("2026-")) fail("QP/non-QP archive layout is qualified only for 2026 releases", 422);
  const suffix = page.qp === "QP" ? "QPP" : "nonQPP";
  const pattern = new RegExp(`^PPRRVU2026_[A-Za-z]+_${suffix}\\.csv$`);
  const candidates = archive.members.filter(member => pattern.test(member.name));
  if (candidates.length !== 1) fail("Release must contain exactly one selected QP/non-QP RVU CSV", 502);
  const member = candidates[0];
  const decoded = await zipMember(archive.bytes, member);
  const csv = pfsCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(decoded.bytes));
  if (page.offset > csv.records.length) fail("offset exceeds this archive member's row count");
  const records = csv.records.slice(page.offset, page.offset + page.limit);
  const next = page.offset + records.length;
  return { ...archive.evidence, member: member.name, member_sha256: decoded.member_sha256, member_crc32_verified: decoded.member_crc32_verified,
    qp_classification: page.qp, qualification_basis: "Provider-linked 2026 QPP/nonQPP member name; not inferred from conversion-factor ordering or personal eligibility",
    source_preamble: csv.source_preamble, header_rows: csv.header_rows, columns: csv.columns,
    column_label_rule: "Nonempty native header cells joined vertically with spaces, retaining the original header matrix above",
    records, total_rows: csv.records.length, offset: page.offset, limit: page.limit, next_offset: next < csv.records.length ? next : null,
    complete: page.offset === 0 && next === csv.records.length, table_kind: "pfs_rvu_rows",
    note: "All cells remain source strings; duplicate codes/modifiers and copyright notices are preserved. A page or successful staging is not the complete file. QP coverage is narrower; absence is not a zero payment or a non-QP equivalent.",
  };
}
