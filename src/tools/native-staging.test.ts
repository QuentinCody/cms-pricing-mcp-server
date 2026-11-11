/// <reference types="node" />
import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { hashCanonicalJson, verifyCitationEnvelope } from "@bio-mcp/shared";
import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { createStore } from "./native-store-fixture";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
  // Run the generated API helpers and user program, replacing only the Cloudflare isolate.
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockImplementation(async (code, functions) => {
    const staged: Array<Record<string, unknown>> = [];
    try {
      const run = new Function("codemode", "__stagedResults", "console", `return (${code})();`);
      const result = await run(functions, staged, { warn() {}, log() {} });
      return { result: JSON.parse(JSON.stringify(result)), __stagedResults: staged };
    } catch (error) { return { error: String((error as Error).message), __stagedResults: staged }; }
  });
  const stores = new Map<string, ReturnType<typeof createStore>>();
  const namespace = { idFromName: (name: string) => name, get: (id: string) => ({ fetch: async (request: Request) => {
    let store = stores.get(id);
    if (!store) { store = createStore(); stores.set(id, store); }
    await store.ready;
    return store.instance.fetch(request);
  } }) };
  const env = { CMS_PRICING_DATA_DO: namespace, CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, env); registerQueryData(server, env); registerGetSchema(server, env);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<any> }> })._registeredTools;
  return { tools, close: () => { for (const store of stores.values()) store.database.close(); } };
}

async function recover(f: ReturnType<typeof fixture>, id: string, prefix: string) {
  const rows = async (sql: string) => {
    const output = await f.tools[`${prefix}cms_pricing_query_data`].handler({ data_access_id: id, sql }, {});
    expect(output.isError, JSON.stringify(output)).not.toBe(true);
    expect(output.structuredContent.staged).not.toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(30720);
    return output.structuredContent.data.rows;
  };
  const text = async (table: string, column: string, where: string) => {
    const [{ n }] = await rows(`SELECT length(${column}) AS n FROM ${table} WHERE ${where}`);
    let result = "";
    for (let start = 1; start <= n; start += 1000) {
      const [row] = await rows(`SELECT substr(${column}, ${start}, 1000) AS part FROM ${table} WHERE ${where}`);
      result += row.part;
    }
    return result;
  };
  let raw = await text("payloads", "root_json", "id = 1");
  if (raw.startsWith("__CHUNKED__:")) {
    const chunk = raw.slice("__CHUNKED__:".length);
    expect(chunk).toMatch(/^chunk_[a-f0-9]{32}$/);
    const parts = await rows(`SELECT chunk_index FROM content_chunks WHERE content_id = '${chunk}' ORDER BY chunk_index`);
    raw = "";
    for (const part of parts) raw += await text("content_chunks", "chunk_data", `content_id = '${chunk}' AND chunk_index = ${part.chunk_index}`);
  }
  const decoded = JSON.parse(raw);
  return typeof decoded === "string" ? JSON.parse(decoded) : decoded;
}

it("preserves complete native records and stages escaped SQL with exact helper citations", async () => {
  const f = fixture();
  const native = [{ HCPCS_Cd: "00100", Rndrng_NPI: "000123", Rndrng_Prvdr_Type: "fixture", Rndrng_Prvdr_State_Abrvtn: "MA", note: 'α 🧬 "'.repeat(5000) }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    for (const prefix of ["", "mcp_"]) {
      const code = " \nreturn await api.get('/physician/by-provider-service',{size:1});\r\n";
      const result = await f.tools[`${prefix}cms_pricing_execute`].handler({ code }, {});
      expect(result.isError).not.toBe(true);
      const id = result.structuredContent.data.data_access_id;
      const original = await recover(f, id, prefix);
      expect(original).toEqual(native);
      const proof = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: { code }, materialized: { value: original } });
      expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
      const args = { data_access_id: id, sql: "SELECT HCPCS_Cd, Rndrng_NPI, note FROM physician_services" };
      const large = await f.tools[`${prefix}cms_pricing_query_data`].handler(args, {});
      expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeLessThan(30720);
      expect(large.structuredContent.staged).toBe(true);
      const full = await recover(f, large.structuredContent.data_access_id, prefix);
      expect(full.structuredContent.data.rows).toEqual([{ HCPCS_Cd: "00100", Rndrng_NPI: "000123", note: native[0].note }]);
      const verified = await verifyCitationEnvelope({ citation: large.structuredContent._meta.citation, structuredContent: large.structuredContent, toolArguments: args, materialized: { value: full } });
      expect(verified.verification).toMatchObject({ query: "verified", result: "verified" });
      const schemaArgs = { data_access_id: id };
      const schema = await f.tools[`${prefix}cms_pricing_get_schema`].handler(schemaArgs, {});
      const schemaProof = await verifyCitationEnvelope({ citation: schema.structuredContent._meta.citation, structuredContent: schema.structuredContent, toolArguments: schemaArgs });
      expect(schemaProof.verification).toMatchObject({ query: "verified", result: "verified" });
    }
  } finally { f.close(); }
});

it("preserves large native HTTP failure evidence through both aliases", async () => {
  const f = fixture(); const raw = "α".repeat(40000);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(raw, { status: 503, headers: { "retry-after": "60" } })));
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}cms_pricing_execute`].handler({ code: "return await api.get('/fee-schedules/releases');" }, {});
      expect(result).toMatchObject({ isError: true, structuredContent: { success: false, data: { __api_error: true, status: 503 } } });
      const preserved = await recover(f, result.structuredContent.data.data.data_access_id, prefix);
      expect(preserved).toMatchObject({ body: raw, retry_after: "60", http_status: 503 });
    }
  } finally { f.close(); }
});
