import { afterEach, expect, it, vi } from "vitest";
import { ingestFeeSchedules, resolveFeeScheduleDataAccessId } from "./ingest-fee-schedules";
import { beginIngest, failIngest, promoteIngest, type CompletedIngest, type IngestControlState } from "./ingest-control";

function fixture(failTable?: string) {
  let state: IngestControlState = { activeGeneration: "prior" };
  const completed = new Map<string, CompletedIngest>();
  const staged: { data: Record<string, unknown>[]; schema_hints: { tableName: string; columnTypes?: Record<string, string> } }[] = [];
  const coordinator = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === "/ingest/status") return Response.json({ success: true, ...state });
    // SAFETY: requests are produced by the ingest module under test.
    const body = await request.json() as CompletedIngest & { now: number; failedAt: number; error: string };
    if (path === "/ingest/begin") {
      const decision = beginIngest(state, completed.get(body.idempotencyKeyHash), body);
      state = decision.state;
      return Response.json({ success: true, ...decision });
    }
    if (path === "/ingest/promote") {
      state = promoteIngest(state, body); completed.set(body.idempotencyKeyHash, body);
    } else state = failIngest(state, body);
    return Response.json({ success: true });
  };
  const candidate = async (request: Request): Promise<Response> => {
    if (request.method === "DELETE") return Response.json({ success: true });
    // SAFETY: capture the JSON staging contract from the ingest module.
    const body = await request.json() as typeof staged[number];
    staged.push(body);
    return Response.json({ success: body.schema_hints.tableName !== failTable, table_row_counts: { [body.schema_hints.tableName]: body.data.length } });
  };
  // SAFETY: fixture supplies every DO method used by ingest and resolution.
  const namespace = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: name === "__fee_schedules" ? coordinator : candidate }) } as unknown as DurableObjectNamespace;
  return { namespace, staged, state: () => state };
}

function upstream(): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn().mockImplementation(async (url: string) => new Response(url.includes("indicators") ? "hcpc,modifier,conv_fact\n00100,00,33.567500\n" : "locality,mac_description\n01,Example\n"));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
it("promotes data and exact source evidence together, with all native columns TEXT", async () => {
  upstream(); const f = fixture();
  const result = await ingestFeeSchedules(f.namespace, { idempotencyKey: "first" });
  expect(result.status).toBe("ok");
  expect(f.staged.map(item => item.schema_hints.tableName)).toEqual(["pfs_indicators", "pfs_localities", "fee_schedule_sources"]);
  expect(f.staged[0]).toMatchObject({ data: [{ hcpc: "00100", modifier: "00", conv_fact: "33.567500" }], schema_hints: { columnTypes: { hcpc: "TEXT", modifier: "TEXT", conv_fact: "TEXT" } } });
  expect(f.staged[2].data).toEqual(result.results.map(item => item.evidence));
  expect(f.state()).toMatchObject({ previousGeneration: "prior", activeGeneration: result.generation });
  expect(await resolveFeeScheduleDataAccessId(f.namespace)).toBe(result.generation);
});
it.each(["pfs_localities", "fee_schedule_sources"])("retains prior generation if %s staging fails", async failed => {
  upstream(); const f = fixture(failed);
  expect(await ingestFeeSchedules(f.namespace, { idempotencyKey: "failed" })).toMatchObject({ status: "error", activeGeneration: "prior" });
  expect(f.state().activeGeneration).toBe("prior");
  expect(await resolveFeeScheduleDataAccessId(f.namespace)).toBe("prior");
});
it("does not promote a partial upstream refresh", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("hcpc,conv_fact\n00100,33.5\n")).mockResolvedValueOnce(new Response("unavailable", { status: 503 })));
  const f = fixture();
  expect(await ingestFeeSchedules(f.namespace, { idempotencyKey: "partial" })).toMatchObject({ status: "error", activeGeneration: "prior" });
  expect(f.staged).toHaveLength(1);
});
it("replays a completed ingest without refetching or restaging", async () => {
  const fetcher = upstream(); const f = fixture();
  const first = await ingestFeeSchedules(f.namespace, { idempotencyKey: "same" });
  expect(await ingestFeeSchedules(f.namespace, { idempotencyKey: "same" })).toMatchObject({ status: "replayed", generation: first.generation, results: first.results });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(f.staged).toHaveLength(3);
});
it("does not promote an empty source list", async () => {
  const f = fixture();
  expect(await ingestFeeSchedules(f.namespace, { idempotencyKey: "empty", sources: [] })).toMatchObject({ status: "error", activeGeneration: "prior" });
  expect(f.staged).toHaveLength(0);
});
