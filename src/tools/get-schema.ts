import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createGetSchemaHandler, getSchemaFromDo } from "@bio-mcp/shared/staging/utils";
import { FEE_SCHEDULE_DO_ID } from "../lib/fee-schedule-sources";

interface SchemaEnv {
    CMS_PRICING_DATA_DO?: DurableObjectNamespace;
}

interface DoSchema {
    table_count?: number;
    total_rows?: number;
    tables?: Record<string, { row_count?: number }>;
}

function extractSchemaInfo(feeSchema: { schema: unknown }) {
    const schema = feeSchema.schema as DoSchema | undefined;
    if (!schema || !schema.table_count || schema.table_count === 0) return null;
    return {
        tables: Object.keys(schema.tables || {}),
        total_rows: schema.total_rows ?? 0,
    };
}

export function registerGetSchema(server: McpServer, env?: SchemaEnv): void {
    const sessionHandler = createGetSchemaHandler("CMS_PRICING_DATA_DO", "cms_pricing");

    server.registerTool(
        "cms_pricing_get_schema",
        {
            title: "Get Staged Data Schema",
            description:
                "Get schema information for staged CMS pricing data. Shows table structures and row counts. " +
                "If called without a data_access_id, lists all staged datasets including built-in fee schedules. " +
                "Use data_access_id='__fee_schedules' for the pre-loaded Physician Fee Schedule and locality GPCI tables.",
            inputSchema: {
                data_access_id: z.string().min(1).optional().describe(
                    "Data access ID for the staged dataset. Use '__fee_schedules' for built-in fee schedule tables. " +
                    "If omitted, lists all available datasets including fee schedules.",
                ),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: SchemaEnv })?.env || {};
            const dataAccessId = args.data_access_id as string | undefined;

            if (dataAccessId) {
                return sessionHandler(
                    args as Record<string, unknown>,
                    runtimeEnv as Record<string, unknown>,
                    (extra as { sessionId?: string })?.sessionId,
                );
            }

            // No data_access_id — list session datasets AND the well-known fee schedules
            const sessionResult = await sessionHandler(
                args as Record<string, unknown>,
                runtimeEnv as Record<string, unknown>,
                (extra as { sessionId?: string })?.sessionId,
            );

            const doNamespace = runtimeEnv.CMS_PRICING_DATA_DO as DurableObjectNamespace | undefined;
            if (!doNamespace) return sessionResult;

            try {
                const feeSchema = await getSchemaFromDo(doNamespace, FEE_SCHEDULE_DO_ID);
                const info = extractSchemaInfo(feeSchema);
                if (!info) return sessionResult;

                const result = sessionResult as Record<string, unknown>;
                const sc = result.structuredContent as Record<string, unknown> | undefined;
                const data = sc?.data as Record<string, unknown> | undefined;
                if (!data) return sessionResult;

                const sessionDatasets = Array.isArray(data.staged_datasets) ? data.staged_datasets : [];
                data.staged_datasets = [
                    {
                        data_access_id: FEE_SCHEDULE_DO_ID,
                        type: "built-in",
                        description: "Pre-loaded CMS Physician Fee Schedule and locality GPCI data",
                        tables: info.tables,
                        total_rows: info.total_rows,
                    },
                    ...sessionDatasets,
                ];
                data.message = `${(data.staged_datasets as unknown[]).length} dataset(s) available. Use data_access_id='${FEE_SCHEDULE_DO_ID}' for fee schedule queries.`;
            } catch { /* best-effort: Fee schedules DO may not be populated yet */ }

            return sessionResult;
        },
    );
}
