import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createGetSchemaHandler } from "@bio-mcp/shared/staging/utils";

interface SchemaEnv {
    CMS_PRICING_DATA_DO?: unknown;
}

export function registerGetSchema(server: McpServer, env?: SchemaEnv): void {
    const handler = createGetSchemaHandler("CMS_PRICING_DATA_DO", "cms_pricing");

    server.registerTool(
        "cms_pricing_get_schema",
        {
            title: "Get Staged Data Schema",
            description:
                "Get schema information for staged CMS pricing data. Shows table structures and row counts. " +
                "If called without a data_access_id, lists all staged datasets available in this session.",
            inputSchema: {
                data_access_id: z.string().min(1).optional().describe(
                    "Data access ID for the staged dataset. If omitted, lists all staged datasets in this session.",
                ),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: SchemaEnv })?.env || {};
            return handler(
                args as Record<string, unknown>,
                runtimeEnv as Record<string, unknown>,
                (extra as { sessionId?: string })?.sessionId,
            );
        },
    );
}
