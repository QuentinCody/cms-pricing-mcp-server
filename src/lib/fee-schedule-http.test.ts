import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedFetch, sha256 } from "./fee-schedule-http";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("bounded CMS reads", () => {
  it("hashes exact bytes", async () => {
    expect(await sha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("disallows redirects and preserves response validators", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("abc", { headers: { etag: '"v1"' } }));
    vi.stubGlobal("fetch", fetcher);
    const read = await boundedFetch("https://www.cms.gov/example", "text/html", 3);
    expect(new TextDecoder().decode(read.bytes)).toBe("abc");
    expect(read.response.headers.get("etag")).toBe('"v1"');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { Accept: "text/html" } });
  });
  it("enforces actual bytes, not content-length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("éé", { headers: { "content-length": "1" } })));
    await expect(boundedFetch("https://www.cms.gov/example", "text/html", 3)).rejects.toMatchObject({ status: 502 });
  });
  it.each([404, 429, 503])("retains HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status })));
    await expect(boundedFetch("https://www.cms.gov/example", "text/html", 3)).rejects.toMatchObject({ status });
  });
  it("bounds a stalled body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream())));
    const pending = expect(boundedFetch("https://www.cms.gov/example", "text/html", 3)).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
  });
  it("retains native error body, retry guidance and exact body hash", async () => {
    const hash = await sha256(new TextEncoder().encode("provider detail"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider detail", { status: 429, headers: { "retry-after": "42" } })));
    await expect(boundedFetch("https://www.cms.gov/example", "text/html", 100)).rejects.toMatchObject({ status: 429, data: { body: "provider detail", response_sha256: hash, retry_after: "42", http_status: 429 } });
  });
  it.each([206, 200])("rejects partial archive HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("part", { status, headers: { "content-range": "bytes 0-3/99" } })));
    await expect(boundedFetch("https://www.cms.gov/example", "application/zip", 100)).rejects.toMatchObject({ status: 502, data: { body: "part", http_status: status } });
  });
  it("bounds a fetch that ignores abort", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const pending = expect(boundedFetch("https://www.cms.gov/example", "text/html", 3)).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(15000); await pending;
  });
  it("does not await a noncooperating stream cancellation", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const pending = expect(boundedFetch("https://www.cms.gov/example", "text/html", 3)).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(15000); await pending; expect(cancel).toHaveBeenCalled();
  });
});
