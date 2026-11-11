import { afterEach, expect, it, vi } from "vitest";
import { csvMatrix, csvRecords, pfsCsv } from "./fee-schedule-csv";
import { zipMembers, zipMember } from "./fee-schedule-zip";
import { feeArchiveRoute } from "./fee-schedule-archive";
import { sha256 } from "./fee-schedule-http";
import { createCmsPricingApiFetch } from "./api-adapter";

import { memberName, archiveUrl, sourceCsv, zip, upstream } from "./fee-archive-fixture";
afterEach(() => vi.unstubAllGlobals());

it("preserves quoted newlines, whitespace, empty rows and duplicated values", () => {
  const text = 'id,value\r\n001," a,b\r\nc "\r\n,\r\n001," a,b\r\nc "\r\n';
  const [header, ...rows] = csvMatrix(text);
  expect(csvRecords(header, rows)).toEqual([{ id: "001", value: " a,b\r\nc " }, { id: "", value: "" }, { id: "001", value: " a,b\r\nc " }]);
});
it.each(['a\n"unclosed', 'a\n"x"tail', 'a\nx"y'])("rejects malformed CSV %j", raw => expect(() => csvMatrix(raw)).toThrow());
it("rejects duplicated/empty columns and ragged rows", () => {
  expect(() => csvRecords(["a", "a"], [["1", "2"]])).toThrow();
  expect(() => csvRecords(["a", ""], [["1", "2"]])).toThrow();
  expect(() => csvRecords(["a"], [["1", "2"]])).toThrow();
});
it("preserves all five header rows and separate source notices with conversion precision", () => {
  const result = pfsCsv(sourceCsv());
  expect(result.header_rows).toHaveLength(5); expect(result.source_preamble).toHaveLength(5);
  expect(result.records).toHaveLength(2); expect(result.records[0]).toMatchObject({ HCPCS: "00100", MOD: "  ", "CONV FACTOR": "33.567500" });
  expect(result.records[0]).toEqual(result.records[1]);
  expect(() => pfsCsv(sourceCsv().replace("FACTOR", "different"))).toThrow(/layout/);
});
it("verifies the actual deflated member's size, CRC32 and SHA-256", async () => {
  const bytes = zip(); const members = zipMembers(bytes);
  const result = await zipMember(bytes, members[0]);
  expect(new TextDecoder().decode(result.bytes)).toBe(sourceCsv());
  expect(result.member_sha256).toBe(await sha256(Buffer.from(sourceCsv())));
  expect(result.member_crc32_verified).toBe(true);
});
it.each(["duplicate", "path", "encryption", "zip64", "multidisk", "oversized"])("rejects unsupported ZIP %s", kind => {
  let bytes = zip(); const cd = bytes.readUInt32LE(bytes.length - 6);
  if (kind === "duplicate") bytes = zip([[memberName, "a"], [memberName, "b"]]);
  if (kind === "path") bytes = zip([["../source.csv", "a"]]);
  if (kind === "encryption") bytes.writeUInt16LE(1, cd + 8);
  if (kind === "zip64") bytes.writeUInt16LE(65535, bytes.length - 12);
  if (kind === "multidisk") bytes.writeUInt16LE(1, bytes.length - 18);
  if (kind === "oversized") bytes.writeUInt32LE(17 * 1024 * 1024, cd + 24);
  expect(() => zipMembers(bytes)).toThrow();
});
it.each(["local_name", "local_size", "crc"])("rejects corrupted ZIP %s", async kind => {
  const bytes = zip(); const cd = bytes.readUInt32LE(bytes.length - 6);
  if (kind === "local_name") bytes[30] ^= 1;
  if (kind === "local_size") bytes.writeUInt32LE(1, 22);
  if (kind === "crc") { bytes.writeUInt32LE(1, 14); bytes.writeUInt32LE(1, cd + 16); }
  await expect(zipMember(bytes, zipMembers(bytes)[0])).rejects.toThrow();
});
it("preserves source dates and explicit QP selection on bounded, hash-guarded continuation", async () => {
  const bytes = zip(); upstream(bytes); const hash = await sha256(bytes);
  const first = await feeArchiveRoute("/fee-schedules/rvus", { release: "rvu26d", qp: "QP", limit: 1 });
  expect(first).toMatchObject({ qp_classification: "QP", total_rows: 2, offset: 0, next_offset: 1, complete: false, effective_month: "2026-10", download_updated_date_label: "08/26/2026", archive_sha256: hash });
  expect(await feeArchiveRoute("/fee-schedules/rvus", { release: "rvu26d", qp: "QP", limit: 1, offset: 1, expected_archive_sha256: hash })).toMatchObject({ next_offset: null, complete: false });
  expect(await feeArchiveRoute("/fee-schedules/rvus", { release: "rvu26d", qp: "QP", limit: 2 })).toMatchObject({ next_offset: null, complete: true });
  expect(await createCmsPricingApiFetch()({ method: "GET", path: "/fee-schedules/rvus", params: { release: "rvu26d", qp: "QP", limit: 1 } })).toMatchObject({ completeness: { complete: false, returned: 1, total_available: 2, truncation: { reason: "page_limit" } } });
});
it("keeps non-QP separate even when its fixture conversion factor is equal", async () => {
  upstream(zip([[memberName, sourceCsv()], [memberName.replace("_QPP", "_nonQPP"), sourceCsv()]]));
  expect(await feeArchiveRoute("/fee-schedules/rvus", { release: "rvu26d", qp: "non-QP" })).toMatchObject({ qp_classification: "non-QP", member: "PPRRVU2026_Oct_nonQPP.csv" });
});
it("rejects changed bytes, unlisted archives and invalid continuation", async () => {
  const fetcher = upstream();
  await expect(feeArchiveRoute("/fee-schedules/archive", { release: "rvu26d", expected_archive_sha256: "0".repeat(64) })).rejects.toMatchObject({ status: 409, data: { source_url: archiveUrl } });
  await expect(feeArchiveRoute("/fee-schedules/archive", { release: "rvu26d", archive_url: "https://evil.test/a.zip" })).rejects.toMatchObject({ status: 400 });
  expect(fetcher.mock.calls.every(([url]) => url.startsWith("https://www.cms.gov/"))).toBe(true);
  fetcher.mockClear();
  for (const params of [{ qp: "QP", offset: 1 }, { qp: "all" }, { qp: "QP", limit: 1001 }]) await expect(feeArchiveRoute("/fee-schedules/rvus", { release: "rvu26d", ...params })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});
