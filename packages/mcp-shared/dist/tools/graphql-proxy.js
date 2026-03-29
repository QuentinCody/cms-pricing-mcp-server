/**
 * Hidden __graphql_proxy tool — routes V8 isolate gql.query() calls
 * through the server's GraphQL fetch function.
 *
 * This tool is only callable from V8 isolates (hidden=true).
 * It executes GraphQL queries, handles errors, and auto-stages
 * large responses via stageToDoAndRespond().
 */
import { z } from "zod";
import { shouldStage, stageToDoAndRespond } from "../staging/utils";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Max size (bytes) for a single property to be preserved in the staging envelope. */
const ENVELOPE_SCALAR_LIMIT = 1024;
/**
 * Copy small scalar properties from the original response onto the
 * staging metadata object so LLM code can read them without a round-trip.
 */
function preserveEnvelopeScalars(original, staging) {
    if (!original || typeof original !== "object" || Array.isArray(original)) {
        return;
    }
    for (const [key, value] of Object.entries(original)) {
        if (key in staging)
            continue;
        try {
            const serialized = JSON.stringify(value);
            if (serialized !== undefined && serialized.length <= ENVELOPE_SCALAR_LIMIT) {
                staging[key] = value;
            }
        }
        catch {
            // Skip non-serializable values
        }
    }
}
/**
 * Build a human-readable summary of staged tables.
 */
function buildStagedTableSummary(staged) {
    const tables = staged.tablesCreated;
    const rowCounts = staged._staging?.table_row_counts;
    if (!tables || tables.length === 0) {
        return `${staged.totalRows ?? 0} rows`;
    }
    if (tables.length === 1) {
        const rows = rowCounts?.[tables[0]] ?? staged.totalRows ?? 0;
        return `table "${tables[0]}" [${rows} rows]`;
    }
    const details = tables
        .map((t) => {
        const rows = rowCounts?.[t];
        return rows !== undefined ? `${t} [${rows}]` : t;
    })
        .join(", ");
    return `${tables.length} tables: ${details}`;
}
/**
 * Try to auto-stage a large response into the DO.
 * Returns the staging envelope if staged, or undefined if not applicable.
 */
async function tryAutoStage(resultData, responseBytes, config) {
    if (!config.doNamespace || !shouldStage(responseBytes, config.threshold)) {
        return undefined;
    }
    const staged = await stageToDoAndRespond(resultData, config.doNamespace, config.prefix, undefined, undefined, config.prefix);
    const tableDetail = buildStagedTableSummary(staged);
    const envelope = {
        __staged: true,
        data_access_id: staged.dataAccessId,
        schema: staged.schema,
        tables_created: staged.tablesCreated,
        total_rows: staged.totalRows,
        _staging: staged._staging,
        message: `Response auto-staged (${(responseBytes / 1024).toFixed(1)}KB → ${tableDetail}). Use api.query("${staged.dataAccessId}", sql) in-band, or return this object for the caller to use the query_data tool.`,
    };
    preserveEnvelopeScalars(resultData, envelope);
    return envelope;
}
/**
 * Execute a GraphQL query and return the result, staging if needed.
 */
async function executeAndMaybeStage(gqlFetch, query, variables, staging) {
    const response = await gqlFetch(query, variables);
    // GraphQL errors without data — return error
    if (response.errors && !response.data) {
        const messages = response.errors.map((e) => e.message).join("; ");
        return { __gql_error: true, message: messages, errors: response.errors };
    }
    // Determine what to return (data, or data+errors for partial results)
    const resultData = response.errors
        ? { data: response.data, errors: response.errors }
        : response.data;
    const responseBytes = JSON.stringify(resultData).length;
    const staged = await tryAutoStage(resultData, responseBytes, staging);
    return staged ?? resultData;
}
/**
 * Build the handler function for the __graphql_proxy tool.
 */
function buildHandler(gqlFetch, staging) {
    return async (input) => {
        const query = String(input.query || "");
        const variables = input.variables;
        if (!query) {
            return { __gql_error: true, message: "query is required", errors: [] };
        }
        try {
            return await executeAndMaybeStage(gqlFetch, query, variables, staging);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { __gql_error: true, message, errors: [{ message }] };
        }
    };
}
/**
 * Create the hidden __graphql_proxy tool entry.
 */
export function createGraphqlProxyTool(options) {
    const staging = {
        doNamespace: options.doNamespace,
        prefix: options.stagingPrefix,
        threshold: options.stagingThreshold,
    };
    return {
        name: "__graphql_proxy",
        description: "Route GraphQL queries from V8 isolate through server fetch layer. Internal only.",
        hidden: true,
        schema: {
            query: z.string(),
            variables: z.record(z.string(), z.unknown()).optional(),
        },
        handler: buildHandler(options.gqlFetch, staging),
    };
}
//# sourceMappingURL=graphql-proxy.js.map