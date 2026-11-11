import { afterEach, describe, expect, it, vi } from "vitest";
import { feeScheduleRoute } from "./fee-schedule-releases";

const indexPath = "/medicare/payment/fee-schedules/physician/pfs-relative-value-files";
const anchor = (code: string): string => `<a href="${indexPath}/${code}">${code.toUpperCase()}</a>`;
const index = `${anchor("rvu26d")}${anchor("rvu25d")}${anchor("rvu26a")}${anchor("rvu26d")}`;
// Representative fixture from CMS's published description and download label;
// archive contents have not been validated by this test.
const detail = `<h1>RVU26D</h1><div>Physician Fee Schedule - October 2026 release</div>
  <a href="/files/zip/rvu26d.zip">RVU26D - Updated 08/26/2026</a>`;
function pages(indexHtml = index, detailHtml = detail): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn().mockImplementation(async (url: string) => new Response(url.endsWith(indexPath) ? indexHtml : detailHtml, { headers: { "content-type": "text/html; charset=utf-8" } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe("fee schedule discovery", () => {
  it("deduplicates listed releases and filters by requested year without selecting latest", async () => {
    pages();
    const result = await feeScheduleRoute("/fee-schedules/releases", { year: 2026 });
    expect(result).toMatchObject({ releases: [{ release: "rvu26d" }, { release: "rvu26a" }] });
    expect(result).not.toHaveProperty("latest");
  });
  it("keeps October effectiveness separate from the August download update", async () => {
    pages();
    expect(await feeScheduleRoute("/fee-schedules/release", { release: "rvu26d" })).toMatchObject({
      effective_month: "2026-10", archive_checksum_verified: false, loaded_into_fee_schedules: false,
      downloads: [{ updated_date_label: "08/26/2026", url: "https://www.cms.gov/files/zip/rvu26d.zip" }],
    });
  });
  it("does not infer an effective month from the release code, footer, or update date", async () => {
    pages(index, '<div>Last modified October 2026</div><a href="/files/zip/rvu26d.zip">Updated 08/26/2026</a>');
    expect(await feeScheduleRoute("/fee-schedules/release", { release: "rvu26d" })).toMatchObject({ effective_month: null });
  });
  it("leaves conflicting effective descriptions unqualified", async () => {
    pages(index, `${detail}<p>Physician Fee Schedule - July 2026 release</p>`);
    expect(await feeScheduleRoute("/fee-schedules/release", { release: "rvu26d" })).toMatchObject({ effective_month: null });
  });
  it("rejects changed page hashes", async () => {
    pages();
    await expect(feeScheduleRoute("/fee-schedules/release", { release: "rvu26d", expected_page_sha256: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
  });
  it("accepts a matching page hash", async () => {
    pages();
    // SAFETY: a successful detail result includes the page hash tested below.
    const first = await feeScheduleRoute("/fee-schedules/release", { release: "rvu26d" }) as { page_sha256: string };
    expect(first.page_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await feeScheduleRoute("/fee-schedules/release", { release: "rvu26d", expected_page_sha256: first.page_sha256 })).toMatchObject({ page_sha256: first.page_sha256, effective_month: "2026-10" });
  });
  it("rejects unlisted releases before fetching their detail", async () => {
    const fetcher = pages();
    await expect(feeScheduleRoute("/fee-schedules/release", { release: "rvu26b" })).rejects.toMatchObject({ status: 404 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("ignores off-origin and misleading path links", async () => {
    pages(`${index}<a href="https://evil.test${indexPath}/rvu26b">RVU26B</a><a href="${indexPath}/rvu26c/other">RVU26C</a>`);
    // SAFETY: discovery returns a releases array on success.
    const result = await feeScheduleRoute("/fee-schedules/releases", {}) as { releases: unknown[] };
    expect(result.releases).toHaveLength(3);
  });
  it.each(["", "<a href='/other'>unrelated</a>"])("fails closed on unrecognized index markup", async html => {
    pages(html);
    await expect(feeScheduleRoute("/fee-schedules/releases", {})).rejects.toMatchObject({ status: 502 });
  });
  it("fails closed when downloads are absent", async () => {
    pages(index, "<h1>RVU26D</h1>");
    await expect(feeScheduleRoute("/fee-schedules/release", { release: "rvu26d" })).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    ["/fee-schedules/releases", { year: "26" }],
    ["/fee-schedules/releases", { url: "https://evil.test" }],
    ["/fee-schedules/release", { release: "../rvu26d" }],
    ["/fee-schedules/release", { release: "rvu26d", expected_page_sha256: "bad" }],
  ])("rejects invalid selectors before I/O: %s %j", async (path, params) => {
    const fetcher = pages();
    await expect(feeScheduleRoute(path, params)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("exposes configured CSVs without asserting current-quarter coverage", async () => {
    expect(await feeScheduleRoute("/fee-schedules/configured", {})).toMatchObject({ release_qualification: "pending", effective_month: null });
  });
});
