import type { McpServer } from "@bio-mcp/shared/mcp";
import { cmsPricingResponse } from "../lib/tool-result";
import { z } from "zod";
import { createQueryDataHandler } from "@bio-mcp/shared/staging/utils";
import { FEE_SCHEDULE_HANDLES } from "../lib/fee-schedule-sources";
import { resolveFeeScheduleDataAccessId } from "../lib/ingest-fee-schedules";

interface QueryEnv {
    CMS_PRICING_DATA_DO?: unknown;
}

export function registerQueryData(server: McpServer, env?: QueryEnv): void {
    const handler = createQueryDataHandler("CMS_PRICING_DATA_DO", "cms_pricing");

	const registerWithName = (name: string) => server.registerTool(
        name,
        {
            title: "Query Staged CMS Pricing Data",
            description:
                "Query staged Medicare pricing data using SQL. Use this when responses are too large and have been staged with a data_access_id.",
            inputSchema: {
                data_access_id: z.string().min(1).describe("Data access ID for the staged dataset"),
                sql: z.string().min(1).describe("SQL query to execute against the staged data"),
                limit: z.number().int().positive().max(10000).optional().describe("Maximum number of rows to return (default: 100)"),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: QueryEnv })?.env || {};
			const resolvedArgs = { ...args } as Record<string, unknown>;
			if (
				FEE_SCHEDULE_HANDLES.some(handle => handle === args.data_access_id) &&
				runtimeEnv.CMS_PRICING_DATA_DO
			) {
				resolvedArgs.data_access_id = await resolveFeeScheduleDataAccessId(
					runtimeEnv.CMS_PRICING_DATA_DO as DurableObjectNamespace,
					args.data_access_id,
				);
			}
            return cmsPricingResponse(() => handler(resolvedArgs, runtimeEnv as Record<string, unknown>), runtimeEnv, name, extra, args);
        },
    );
	registerWithName("mcp_cms_pricing_query_data");
	registerWithName("cms_pricing_query_data");
}
