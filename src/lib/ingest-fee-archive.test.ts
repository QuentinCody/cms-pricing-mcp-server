import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { createStore } from "../tools/native-store-fixture";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "../tools/query-data";
import { registerGetSchema } from "../tools/get-schema";
import { ingestFeeSchedules, resolveFeeScheduleDataAccessId } from "./ingest-fee-schedules";
import { csvMatrix } from "./fee-schedule-csv";
import { memberName, sourceCsv, zip, upstream } from "./fee-archive-fixture";
import { sha256 } from "./fee-schedule-http";
import { ARCHIVE_TABLES } from "./fee-archive-tables";

const serialize = (rows: string[][]) => rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
function entries(): Array<[string, string]> {
  return [
    [memberName, "\uFEFF" + sourceCsv()], [memberName.replace("_QPP", "_nonQPP"), sourceCsv().replaceAll("33.567500", "33.400900")],
    ["GPCI2026.csv", serialize([["source notice"], [""], ["Medicare Administrative Contractor (MAC)", "State", "Locality Number", "Locality Name", "2026 PW GPCI", "2026 PE GPCI", "2026 MP GPCI"], ["01112", "CA", "05", "fixture", "1.000", "1.001", "1.002"], ["note", "", "", "", "", "", ""]])],
    ["26LOCCO.csv", serialize([["source notice"], [""], ["Medicare Adminstrative Contractor", "Locality Number", "State ", "Fee Schedule Area ", "Counties", ""], ["01112", "05", "", " fixture ", 'quoted, county\r\n🧬"' + "α🧬".repeat(5000), ""], ["", "", "", "", "", ""]])],
    ["OPPSCAP_Oct.csv", serialize([["HCPCS", "MOD", "PROCSTAT", "CARRIER", "LOCALITY", "FACILITY PRICE", "NON-FACILTY PRICE"], ["0633T", "TC", "C", "01112", "05", "150.3800", "150.3800"]])],
    ["ANES2026.csv", serialize([["Contractor", "Locality", "Locality Name", "Qualifying APM source CF", "Non-Qualifying APM source CF"], ["01112 ", "05 ", "fixture", "19.6300", "19.5300"], ["", "", "", "", ""]])],
  ];
}
function fixture(failTable?: string) {
  const stores = new Map<string, ReturnType<typeof createStore>>();
  const namespace = { idFromName: (name: string) => name, get: (id: string) => ({ fetch: async (request: Request) => {
    let store = stores.get(id);
    if (!store) { store = createStore(); stores.set(id, store); }
    await store.ready;
    if (new URL(request.url).pathname === "/process" && failTable) {
      const body = await request.clone().json() as { schema_hints: { tableName: string } };
      if (body.schema_hints.tableName === failTable) return Response.json({ success: true, table_row_counts: { [failTable]: 0 } });
    }
    return store.instance.fetch(request);
  } }) } as unknown as DurableObjectNamespace;
  const server = new McpServer({ name: "fixture", version: "1" });
  registerQueryData(server, { CMS_PRICING_DATA_DO: namespace }); registerGetSchema(server, { CMS_PRICING_DATA_DO: namespace });
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<any> }> })._registeredTools;
  return { stores, namespace, tools, close: () => { for (const store of stores.values()) store.database.close(); } };
}
afterEach(() => vi.unstubAllGlobals());

it("promotes all native CSV cells, source matrices, raw chunks and member evidence together", async () => {
  const native = entries(); const bytes = zip(native); const fetcher = upstream(bytes); const f = fixture();
  const archive = { release: "rvu26d", expected_archive_sha256: await sha256(bytes) };
  try {
    const first = await ingestFeeSchedules(f.namespace, { idempotencyKey: "first", archive });
    expect(first, JSON.stringify(first)).toMatchObject({ status: "ok", data_access_id: "__fee_schedule_archive" });
    const db = f.stores.get(first.generation!)!.database;
    for (let i = 0; i < native.length; i++) {
      const [name, raw] = native[i]; const table = ARCHIVE_TABLES[i].table;
      const manifest = db.prepare("SELECT * FROM fee_schedule_sources WHERE source_member = ?").get(name)!;
      const headerRows = JSON.parse(manifest.header_rows_json as string);
      const columns = JSON.parse(manifest.columns_json as string) as string[];
      const matrix = csvMatrix(raw); const headerEnd = i < 2 ? 10 : i < 4 ? 3 : 1;
      expect(headerRows).toEqual(matrix.slice(i < 2 ? 5 : headerEnd - 1, headerEnd));
      expect(JSON.parse(manifest.source_preamble_json as string)).toEqual(matrix.slice(0, i < 2 ? 5 : headerEnd - 1));
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      expect(rows.map(row => columns.map(column => row[column]))).toEqual(matrix.slice(headerEnd));
      expect(rows.map(row => row.source_csv_row)).toEqual(rows.map((_, row) => row + headerEnd + 1));
      const recovered = db.prepare("SELECT csv_text_chunk FROM fee_schedule_csv_chunks WHERE source_member = ? ORDER BY chunk_index").all(name).map(row => row.csv_text_chunk).join("");
      expect(recovered).toBe(raw);
      expect(manifest.csv_sha256).toBe(await sha256(new TextEncoder().encode(recovered)));
    }
    const all = db.prepare("SELECT qp_classification, auxiliary_row_count FROM fee_schedule_sources ORDER BY rowid").all();
    expect(all.map(row => row.qp_classification)).toEqual(["QP", "non-QP", "not_applicable", "not_applicable", "not_applicable", "separate_columns"]);
    expect(all.map(row => row.auxiliary_row_count)).toEqual([0, 0, 1, 1, 0, 1]);
    expect(await resolveFeeScheduleDataAccessId(f.namespace)).toBe("__fee_schedules");
    for (const prefix of ["", "mcp_"]) {
      const out = await f.tools[`${prefix}cms_pricing_query_data`].handler({ data_access_id: "__fee_schedule_archive", sql: 'SELECT "HCPCS", "CONV FACTOR" FROM pfs_rvu_qp' }, {});
      expect(out.structuredContent.data.rows).toEqual([{ HCPCS: "00100", "CONV FACTOR": "33.567500" }, { HCPCS: "00100", "CONV FACTOR": "33.567500" }]);
      const list = await f.tools[`${prefix}cms_pricing_get_schema`].handler({}, {});
      expect(list.structuredContent.data.staged_datasets.filter((d: any) => d.type === "built-in").map((d: any) => d.data_access_id)).toEqual(["__fee_schedule_archive"]);
    }
    fetcher.mockClear();
    expect(await ingestFeeSchedules(f.namespace, { idempotencyKey: "first", archive })).toMatchObject({ status: "replayed", generation: first.generation });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(ingestFeeSchedules(f.namespace, { idempotencyKey: "first", archive: { ...archive, expected_archive_sha256: "0".repeat(64) } })).rejects.toMatchObject({ status: 409 });
    expect(await ingestFeeSchedules(f.namespace, { idempotencyKey: "changed", archive: { ...archive, expected_archive_sha256: "0".repeat(64) } })).toMatchObject({ status: "error", activeGeneration: first.generation });
  } finally { f.close(); }
});

it.each(["pfs_anesthesia", "fee_schedule_csv_chunks", "fee_schedule_sources", "fee_schedule_archive_metadata"])("never promotes incomplete %s staging", async failed => {
  const bytes = zip(entries()); upstream(bytes); const f = fixture(failed);
  try {
    const archive = { release: "rvu26d", expected_archive_sha256: await sha256(bytes) };
    const result = await ingestFeeSchedules(f.namespace, { idempotencyKey: "fail", archive });
    expect(result).toMatchObject({ status: "error", error: expect.stringContaining("row count") });
    expect(await resolveFeeScheduleDataAccessId(f.namespace, "__fee_schedule_archive")).toBe("__fee_schedule_archive");
  } finally { f.close(); }
});

it.each(["missing", "extra", "crc", "layout"])("retains the active generation when archive qualification fails: %s", async kind => {
  const native = entries();
  if (kind === "missing") native.pop();
  if (kind === "extra") native.push(["unexpected.csv", "a\n1\n"]);
  if (kind === "layout") native[4][1] = "changed\n1\n";
  const bytes = zip(native);
  if (kind === "crc") { const cd = bytes.readUInt32LE(bytes.length - 6); bytes.writeUInt32LE(1, 14); bytes.writeUInt32LE(1, cd + 16); }
  upstream(bytes); const f = fixture();
  try {
    const result = await ingestFeeSchedules(f.namespace, { idempotencyKey: kind, archive: { release: "rvu26d", expected_archive_sha256: await sha256(bytes) } });
    expect(result.status).toBe("error");
    expect(await resolveFeeScheduleDataAccessId(f.namespace, "__fee_schedule_archive")).toBe("__fee_schedule_archive");
  } finally { f.close(); }
});
