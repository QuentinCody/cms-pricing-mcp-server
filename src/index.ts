import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { CmsPricingDataDO } from "./do";
import { ingestFeeSchedules } from "./lib/ingest-fee-schedules";

export { CmsPricingDataDO };

interface CmsPricingEnv {
    CMS_PRICING_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "cms-pricing",
        version: "0.1.0",
    });

    async init() {
        const env = this.env as unknown as CmsPricingEnv;
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);
        registerCodeMode(this.server, env);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return new Response("ok", {
                status: 200,
                headers: { "content-type": "text/plain" },
            });
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp", { binding: "MCP_OBJECT" }).fetch(request, env, ctx);
        }

        // Manual ingest trigger — POST /ingest to refresh fee schedule data
        if (url.pathname === "/ingest" && request.method === "POST") {
            const cmsPricingEnv = env as unknown as CmsPricingEnv;
            return handleIngest(cmsPricingEnv);
        }

        return new Response("Not found", { status: 404 });
    },

    // Cron trigger — runs on schedule to refresh fee schedule CSVs
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        const cmsPricingEnv = env as unknown as CmsPricingEnv;
        const results = await ingestFeeSchedules(cmsPricingEnv.CMS_PRICING_DATA_DO);

        const ok = results.filter((r) => r.status === "ok");
        const failed = results.filter((r) => r.status === "error");
        console.log(
            `[cron] Fee schedule ingest: ${ok.length} ok, ${failed.length} failed. ` +
            `Total rows: ${ok.reduce((sum, r) => sum + r.rows, 0)}`,
        );
        if (failed.length > 0) {
            console.error("[cron] Failed:", failed.map((r) => `${r.key}: ${r.error}`).join("; "));
        }
    },
};

async function handleIngest(env: CmsPricingEnv): Promise<Response> {
    try {
        const results = await ingestFeeSchedules(env.CMS_PRICING_DATA_DO);
        return new Response(JSON.stringify({ success: true, results }, null, 2), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ success: false, error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
        });
    }
}
