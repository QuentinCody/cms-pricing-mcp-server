import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { createCmsPricingApiFetch } from "../lib/api-adapter";
import { cmsPricingCatalog } from "../spec/catalog";

afterEach(() => vi.unstubAllGlobals());

it("registers both aliases and returns both MCP fields on tested success/error paths", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: invalid execution never invokes loader or DO.
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  // SAFETY: inspect actual SDK callbacks solely for the registration contract.
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  expect(Object.keys(tools)).toHaveLength(8);
  for (const prefix of ["", "mcp_"]) {
    expect(await tools[prefix + "cms_pricing_search"].handler({ query: "fee-schedules", max_results: 5 }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    for (const [name, args] of [["execute", { code: "" }], ["query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["get_schema", { data_access_id: "fixture" }]] as const) {
      expect(await tools[prefix + "cms_pricing_" + name].handler(args, {})).toMatchObject({ content: expect.any(Array), structuredContent: expect.any(Object), isError: true });
    }
  }
});

it("stages a large release result with update labels and page provenance intact", async () => {
  const path = "/medicare/payment/fee-schedules/physician/pfs-relative-value-files";
  const label = `Updated 08/26/2026 ${"x".repeat(40000)}`;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(`<a href="${path}/rvu26d">RVU26D</a>`, { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response(`<p>Physician Fee Schedule - October 2026 release</p><a href="/files/zip/rvu26d.zip">${label}</a>`, { headers: { "content-type": "text/html" } })));
  const stored: unknown[] = [];
  // SAFETY: fixture supplies the DO methods used by shared staging.
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      // SAFETY: payload comes from shared staging under test.
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: { payloads: { columns: [{ name: "root_json" }] } } } });
  } }) } as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({ apiFetch: createCmsPricingApiFetch(), catalog: cmsPricingCatalog, doNamespace: namespace, stagingPrefix: "cms_pricing", maxInlineBytes: 30 * 1024 });
  const result = await proxy.handler({ method: "GET", path: "/fee-schedules/release", params: { release: "rvu26d" } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toEqual(expect.arrayContaining([expect.objectContaining({ effective_month: "2026-10", page_sha256: expect.any(String), downloads: [{ label, url: "https://www.cms.gov/files/zip/rvu26d.zip", updated_date_label: "08/26/2026" }] })]));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});
