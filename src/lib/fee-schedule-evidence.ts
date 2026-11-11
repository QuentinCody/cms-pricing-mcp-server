import { csvMatrix, csvRecords } from "./fee-schedule-csv";
import { boundedFetch, fail, sha256 } from "./fee-schedule-http";
import type { FeeScheduleSource } from "./fee-schedule-sources";

export interface FeeScheduleEvidence {
  source_key: string;
  table_name: string;
  source_url: string;
  configured_period: string;
  retrieved_at: string;
  csv_sha256: string;
  http_etag: string | null;
  http_last_modified: string | null;
  row_count: number;
  release_code: string | null;
  effective_month: string | null;
  qp_classification: "unverified" | "QP" | "non-QP" | "separate_columns" | "not_applicable";
}

export async function readFeeSchedule(source: FeeScheduleSource): Promise<{
  rows: Record<string, unknown>[]; evidence: FeeScheduleEvidence;
}> {
  const url = new URL(source.url);
  if (url.origin !== "https://pfs.data.cms.gov" || url.username || url.password || url.hash || url.search ||
    !url.pathname.startsWith("/sites/default/files/data/") || !url.pathname.endsWith(".csv")) fail("Unsupported fee-schedule CSV URL");
  const { response, bytes } = await boundedFetch(url.href, "text/csv", 32 * 1024 * 1024);
  const csv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  if (/^\s*</.test(csv)) fail("Fee-schedule source returned markup instead of CSV", 502);
  const [columns = [], ...matrix] = csvMatrix(csv);
  const rows = csvRecords(columns, matrix);
  if (!rows.length) fail("CSV parsed to 0 rows", 502);
  return { rows, evidence: {
    source_key: source.key, table_name: source.tableName, source_url: url.href,
    configured_period: source.period, retrieved_at: new Date().toISOString(), csv_sha256: await sha256(bytes),
    http_etag: response.headers.get("etag"), http_last_modified: response.headers.get("last-modified"),
    row_count: rows.length, release_code: null, effective_month: null, qp_classification: "unverified",
  } };
}

interface StageTarget { fetch(request: Request): Promise<Response> }

export async function stageFeeTable(
  target: StageTarget, tableName: string, rows: unknown[], indexes: string[] = [],
  columnTypes?: Record<string, string>,
): Promise<void> {
  const response = await target.fetch(new Request("http://cms-pricing.internal/process", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: rows, schema_hints: { tableName, indexes, columnTypes } }),
  }));
  // SAFETY: success is checked explicitly; malformed JSON is a failed stage.
  const body = await response.json().catch(() => ({})) as { success?: boolean; error?: string; table_row_counts?: Record<string, number> };
  if (!response.ok || body.success !== true) fail(body.error ?? `DO /process failed with HTTP ${response.status}`, 502);
  if (body.table_row_counts?.[tableName] !== rows.length) fail(`Staged ${tableName} row count does not match complete source`, 502);
}
