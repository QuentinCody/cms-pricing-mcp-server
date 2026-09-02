import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { CmsPricingDataDO } from "./do";
import { ingestFeeSchedules } from "./lib/ingest-fee-schedules";
import { getIdempotencyKey, isAuthorizedIngestRequest } from "./lib/ingest-auth";

export { CmsPricingDataDO };

interface CmsPricingEnv {
    CMS_PRICING_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
	CMS_INGEST_TOKEN?: string;
}

export class MyMCP extends StatelessMcpWorker {
    server = new McpServer({
        name: "cms-pricing",
        version: "0.1.0",
    });

    async init() {

    	configureCitationSigning(this.env);
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
            return buildHealthResponse("cms-pricing");
        }

        if (url.pathname === "/readyz") {
            // Deep check: builds the MCP server the way a real request does, so a
            // factory that throws is a 503 here instead of a green /health over a
            // server that 500s every MCP call.
            return MyMCP.readiness(env, "cms-pricing");
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        // Manual ingest trigger — POST /ingest to refresh fee schedule data
        if (url.pathname === "/ingest" && request.method === "POST") {
            const cmsPricingEnv = env as unknown as CmsPricingEnv;
			if (!cmsPricingEnv.CMS_INGEST_TOKEN) {
				return Response.json(
					{ success: false, error: "CMS_INGEST_TOKEN is not configured" },
					{ status: 503 },
				);
			}
			if (!isAuthorizedIngestRequest(request, cmsPricingEnv.CMS_INGEST_TOKEN)) {
				return Response.json(
					{ success: false, error: "Unauthorized" },
					{ status: 401 },
				);
			}
			const idempotencyKey = getIdempotencyKey(request);
			if (!idempotencyKey) {
				return Response.json(
					{ success: false, error: "A valid Idempotency-Key header is required" },
					{ status: 400 },
				);
			}
			return handleIngest(cmsPricingEnv, idempotencyKey);
        }

        return new Response("Not found", { status: 404 });
    },

    // Cron trigger — runs on schedule to refresh fee schedule CSVs
    async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        const cmsPricingEnv = env as unknown as CmsPricingEnv;
        const outcome = await ingestFeeSchedules(cmsPricingEnv.CMS_PRICING_DATA_DO, {
			idempotencyKey: `scheduled:${controller.scheduledTime}`,
			now: controller.scheduledTime,
		});
		const results = outcome.results;

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

async function handleIngest(
	env: CmsPricingEnv,
	idempotencyKey: string,
): Promise<Response> {
    try {
        const outcome = await ingestFeeSchedules(env.CMS_PRICING_DATA_DO, {
			idempotencyKey,
		});
		const status = outcome.status === "in_progress" ? 409 : outcome.status === "error" ? 502 : 200;
        return new Response(JSON.stringify({ success: outcome.status !== "error", ...outcome }, null, 2), {
            status,
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
