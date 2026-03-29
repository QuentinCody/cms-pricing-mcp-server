/**
 * GraphQL execute tool factory — creates a `<prefix>_execute` tool for
 * GraphQL Code Mode.
 *
 * Uses DynamicWorkerExecutor to run user code in a sandboxed V8 isolate.
 * The isolate gets:
 * - gql.query(queryString, variables?) — GraphQL execution through host
 * - schema.types(), schema.type(), schema.search() etc. — introspection helpers
 * - db.stage(), db.queryStaged(), api.query() — staging helpers
 * - console.log() capture
 *
 * API keys never enter the isolate — all HTTP goes through the host's gqlFetch.
 */
import { z } from "zod";
import { type GraphqlFetchFn, type TrimmedIntrospection } from "./graphql-introspection";
export interface GraphqlExecuteToolOptions {
    /** Tool name prefix (e.g., "pharos" → "pharos_execute") */
    prefix: string;
    /** Function to execute GraphQL queries on the host */
    gqlFetch: GraphqlFetchFn;
    /** DO namespace for auto-staging large responses */
    doNamespace?: unknown;
    /** Worker Loader binding for V8 isolate creation */
    loader: unknown;
    /** Byte threshold for auto-staging (default 30KB) */
    stagingThreshold?: number;
    /** Execution timeout in ms (default 30000) */
    timeout?: number;
    /** Optional JavaScript source injected before user code (domain-specific helpers/quirks) */
    preamble?: string;
    /** DO namespace for virtual filesystem (optional) */
    fsDoNamespace?: unknown;
    /** Pre-cached introspection result. If omitted, fetched lazily on first execute. */
    introspection?: TrimmedIntrospection;
    /** Display name for the API in tool description */
    apiName?: string;
}
export interface GraphqlExecuteToolResult {
    name: string;
    description: string;
    schema: {
        code: z.ZodString;
    };
    register: (server: {
        tool: (...args: unknown[]) => void;
    }) => void;
}
/**
 * Create a GraphQL execute tool registration object.
 */
export declare function createGraphqlExecuteTool(options: GraphqlExecuteToolOptions): GraphqlExecuteToolResult;
//# sourceMappingURL=graphql-execute-tool.d.ts.map