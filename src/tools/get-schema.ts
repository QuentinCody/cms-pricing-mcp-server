import type { McpServer } from "@bio-mcp/shared/mcp";
import { cmsPricingResponse } from "../lib/tool-result";
import { z } from "zod";
import { createGetSchemaHandler, getSchemaFromDo } from "@bio-mcp/shared/staging/utils";
import { FEE_ARCHIVE_DO_ID, FEE_SCHEDULE_HANDLES } from "../lib/fee-schedule-sources";
import { resolveFeeScheduleDataAccessId } from "../lib/ingest-fee-schedules";

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
    if (!schema || !Object.keys(schema.tables ?? {}).some(table => table.startsWith("pfs_"))) return null;
    return {
        tables: Object.keys(schema.tables || {}),
        total_rows: schema.total_rows ?? 0,
    };
}

export function registerGetSchema(server: McpServer, env?: SchemaEnv): void {
    const sessionHandler = createGetSchemaHandler("CMS_PRICING_DATA_DO", "cms_pricing");

	const registerWithName = (name: string) => server.registerTool(
        name,
        {
            title: "Get Staged Data Schema",
            description:
                "Get schema information for staged CMS pricing data. Shows table structures and row counts. " +
                "If called without a data_access_id, lists all staged datasets including built-in fee schedules. " +
                "Use __fee_schedules for configured CSVs or __fee_schedule_archive for an explicitly ingested quarterly release.",
            inputSchema: {
                data_access_id: z.string().min(1).optional().describe(
                    "Data access ID. Built-in handles: __fee_schedules (configured CSVs), __fee_schedule_archive (selected quarterly archive). " +
                    "If omitted, lists all available datasets including fee schedules.",
                ),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: SchemaEnv })?.env || {};
            return cmsPricingResponse(async () => {
			let dataAccessId = args.data_access_id as string | undefined;
			if (
				FEE_SCHEDULE_HANDLES.some(handle => handle === dataAccessId) &&
				runtimeEnv.CMS_PRICING_DATA_DO
			) {
				dataAccessId = await resolveFeeScheduleDataAccessId(
					runtimeEnv.CMS_PRICING_DATA_DO,
                    dataAccessId,
				);
			}

            if (dataAccessId) {
                return sessionHandler(
					{ ...args, data_access_id: dataAccessId } as Record<string, unknown>,
                    runtimeEnv as Record<string, unknown>,
                    (extra as Record<string, unknown>),
                );
            }

            // No data_access_id — list session datasets AND the well-known fee schedules
            const sessionResult = await sessionHandler(
                args as Record<string, unknown>,
                runtimeEnv as Record<string, unknown>,
                (extra as Record<string, unknown>),
            );

            const doNamespace = runtimeEnv.CMS_PRICING_DATA_DO as DurableObjectNamespace | undefined;
            if (!doNamespace) return sessionResult;

            const builtins = [];
            for (const handle of FEE_SCHEDULE_HANDLES) {
                try {
                    const activeId = await resolveFeeScheduleDataAccessId(doNamespace, handle);
                    const info = extractSchemaInfo(await getSchemaFromDo(doNamespace, activeId));
                    if (info) builtins.push({
                        data_access_id: handle, type: "built-in",
                        description: handle === FEE_ARCHIVE_DO_ID
                            ? "Explicitly selected CMS quarterly archive; separate QP/non-QP RVUs and supporting tables"
                            : "Configured CMS fee-schedule CSVs; release and QP classification unverified",
                        ...info,
                    });
                } catch { /* A handle may not have been populated yet. */ }
            }
            const result = sessionResult as Record<string, unknown>;
            const sc = result.structuredContent as Record<string, unknown> | undefined;
            const data = sc?.data as Record<string, unknown> | undefined;
            if (data && builtins.length) {
                const sessionDatasets = Array.isArray(data.staged_datasets) ? data.staged_datasets : [];
                data.staged_datasets = [...builtins, ...sessionDatasets];
                data.message = `${(data.staged_datasets as unknown[]).length} dataset(s) available. Query a listed data_access_id; inspect fee_schedule_sources for source identity.`;
            }

            return sessionResult;
            }, runtimeEnv, name, extra, args);
        },
    );
	registerWithName("mcp_cms_pricing_get_schema");
	registerWithName("cms_pricing_get_schema");
}
