import { afterEach, expect, it, vi } from "vitest";
import { readFeeSchedule, stageFeeTable } from "./fee-schedule-evidence";
import { FEE_SCHEDULE_SOURCES } from "./fee-schedule-sources";

afterEach(() => vi.unstubAllGlobals());
it("preserves native decimal text and leading zeros without inferring QP eligibility", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("hcpc,modifier,conv_fact,locality\n00100,00,33.567500,01\n", { headers: { etag: '"v1"', "last-modified": "Tue, 10 Feb 2026 00:00:00 GMT" } })));
  const result = await readFeeSchedule(FEE_SCHEDULE_SOURCES[0]);
  expect(result.rows).toEqual([{ hcpc: "00100", modifier: "00", conv_fact: "33.567500", locality: "01" }]);
  expect(result.evidence).toMatchObject({ row_count: 1, effective_month: null, release_code: null, qp_classification: "unverified", http_etag: '"v1"', configured_period: "2026" });
  expect(result.evidence.csv_sha256).toMatch(/^[a-f0-9]{64}$/);
});
it.each(["", "hcpc,conv_fact\n", "<html>error</html>"])("rejects unusable CSV %j", async csv => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(csv)));
  await expect(readFeeSchedule(FEE_SCHEDULE_SOURCES[0])).rejects.toMatchObject({ status: 502 });
});
it("does not fetch unapproved source URLs", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readFeeSchedule({ ...FEE_SCHEDULE_SOURCES[0], url: "https://evil.test/source.csv" })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([new Response("{}"), new Response("bad"), new Response('{"success":true}', { status: 500 })])("requires successful staging HTTP and envelope", async response => {
  await expect(stageFeeTable({ fetch: async () => response }, "evidence", [])).rejects.toMatchObject({ status: 502 });
});
it("passes explicit TEXT hints to the staging boundary", async () => {
  const target = { fetch: vi.fn().mockResolvedValue(Response.json({ success: true, table_row_counts: { pfs_indicators: 1 } })) };
  await stageFeeTable(target, "pfs_indicators", [{ hcpc: "00100" }], ["hcpc"], { hcpc: "TEXT" });
  expect(await target.fetch.mock.calls[0][0].json()).toEqual({ data: [{ hcpc: "00100" }], schema_hints: { tableName: "pfs_indicators", indexes: ["hcpc"], columnTypes: { hcpc: "TEXT" } } });
});
it("retains source whitespace and rejects malformed source rows before ingestion", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("hcpc,modifier,conv_fact\n00100,  ,33.400900\n"))
    .mockResolvedValueOnce(new Response("hcpc,modifier\n00100\n")));
  expect((await readFeeSchedule(FEE_SCHEDULE_SOURCES[0])).rows).toEqual([{ hcpc: "00100", modifier: "  ", conv_fact: "33.400900" }]);
  await expect(readFeeSchedule(FEE_SCHEDULE_SOURCES[0])).rejects.toMatchObject({ status: 502 });
});
