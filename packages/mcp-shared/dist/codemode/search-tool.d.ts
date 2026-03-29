/**
 * Search tool factory — creates a `<prefix>_search` tool for API discovery.
 *
 * Two modes:
 * 1. **Catalog mode** (legacy) — runs in-process keyword search over a static ApiCatalog.
 * 2. **OpenAPI mode** (new) — evaluates agent-written JS with the full resolved
 *    OpenAPI spec available. The agent can search paths, list tags, describe
 *    operations, etc., using injected helper functions.
 *
 * When `openApiSpec` is provided, the tool switches to OpenAPI mode.
 * When only `catalog` is provided, the tool uses the original catalog mode.
 */
import { z } from "zod";
import type { ApiCatalog } from "./catalog";
import type { ResolvedSpec } from "./openapi-resolver";
export interface SearchToolOptions {
    /** Tool name prefix (e.g., "gtex" → "gtex_search") */
    prefix: string;
    /** The API catalog to search (legacy mode) */
    catalog?: ApiCatalog;
    /** Resolved OpenAPI spec for code-execution search (new mode) */
    openApiSpec?: ResolvedSpec;
}
export interface SearchToolResult {
    name: string;
    description: string;
    schema: Record<string, z.ZodType>;
    register: (server: {
        tool: (...args: unknown[]) => void;
    }) => void;
}
/**
 * Create a search tool registration object.
 * Returns { name, description, schema, register } for the server to use.
 *
 * When `openApiSpec` is provided, creates a code-execution search tool.
 * When only `catalog` is provided, creates a keyword search tool (legacy).
 */
export declare function createSearchTool(options: SearchToolOptions): SearchToolResult;
//# sourceMappingURL=search-tool.d.ts.map