/**
 * Hidden __graphql_proxy tool — routes V8 isolate gql.query() calls
 * through the server's GraphQL fetch function.
 *
 * This tool is only callable from V8 isolates (hidden=true).
 * It executes GraphQL queries, handles errors, and auto-stages
 * large responses via stageToDoAndRespond().
 */
import type { ToolEntry } from "../registry/types";
import type { GraphqlFetchFn } from "../codemode/graphql-introspection";
export interface GraphqlProxyToolOptions {
    /** Function to execute GraphQL queries on the host */
    gqlFetch: GraphqlFetchFn;
    /** DO namespace for auto-staging large responses */
    doNamespace?: unknown;
    /** Prefix for data access IDs (e.g., "pharos") */
    stagingPrefix: string;
    /** Byte threshold for auto-staging (default from shouldStage) */
    stagingThreshold?: number;
}
/**
 * Create the hidden __graphql_proxy tool entry.
 */
export declare function createGraphqlProxyTool(options: GraphqlProxyToolOptions): ToolEntry;
//# sourceMappingURL=graphql-proxy.d.ts.map