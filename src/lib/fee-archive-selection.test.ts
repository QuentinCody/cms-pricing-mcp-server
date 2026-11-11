import { afterEach, expect, it, vi } from "vitest";
import { archiveSelection, ingestSelection } from "./fee-archive-selection";

const selection = { release: "rvu26d", expected_archive_sha256: "A".repeat(64) };
const request = (body?: string | Uint8Array) => new Request("https://fixture.test/ingest", { method: "POST", body });
afterEach(() => vi.useRealTimers());
it("accepts only explicit hash-pinned 2026 selections and preserves legacy empty requests", async () => {
  for (const body of [undefined, "", "  ", "{}"]) expect(await ingestSelection(request(body))).toBeUndefined();
  expect(await ingestSelection(request(JSON.stringify({ archive: selection })))).toEqual({ ...selection, expected_archive_sha256: "a".repeat(64) });
});
it.each([
  { ...selection, release: "latest" }, { ...selection, release: "rvu25d" },
  { release: "rvu26d" }, { ...selection, expected_page_sha256: "bad" },
  { ...selection, archive_url: "https://evil.test/a.zip" }, { ...selection, qp: "all" },
  null, [],
])("rejects unqualified archive selection %j", value => expect(() => archiveSelection(value)).toThrow());
it.each(["not-json", "[]", '{"sources":[]}', '{"archive":null}'])("rejects malformed body %s", async body => {
  await expect(ingestSelection(request(body))).rejects.toMatchObject({ status: 400 });
});
it("bounds actual bytes and rejects invalid UTF-8", async () => {
  await expect(ingestSelection(request(" ".repeat(4097)))).rejects.toMatchObject({ status: 413 });
  await expect(ingestSelection(request(new Uint8Array([0xff])))).rejects.toMatchObject({ status: 400 });
});
it("times out a body which never finishes", async () => {
  vi.useFakeTimers();
  const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
  const req = new Request("https://fixture.test/ingest", { method: "POST", body, duplex: "half" } as RequestInit);
  const result = expect(ingestSelection(req)).rejects.toMatchObject({ status: 408 });
  await vi.advanceTimersByTimeAsync(10000); await result;
});
