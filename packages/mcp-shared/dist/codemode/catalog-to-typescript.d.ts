/**
 * Catalog-to-TypeScript summary — generates a compact API reference for
 * embedding in the `_execute` tool description.
 *
 * The output uses HTTP method + path format so it maps directly to
 * `api.get(path, params)` calls. It is NOT runnable TypeScript — it's a
 * concise, LLM-friendly reference that replaces the need for a `_search`
 * round-trip for common operations.
 *
 * The catalog remains the single source of truth. This function is a pure
 * formatter — call it at server boot time to generate the summary string.
 */
import type { ApiCatalog } from "./catalog";
import type { ResolvedSpec } from "./openapi-resolver";
export interface CatalogSummaryOptions {
    /**
     * Approximate max number of endpoints to include in the summary.
     * Default 20 — roughly 600-800 tokens depending on param verbosity.
     */
    maxEndpoints?: number;
}
/**
 * Generate a compact API summary from an ApiCatalog.
 *
 * The catalog remains the single source of truth — this is a pure formatter.
 * The output is designed for embedding in an MCP tool description.
 */
export declare function catalogToTypeScript(catalog: ApiCatalog, options?: CatalogSummaryOptions): string;
/**
 * Generate a compact API summary from a resolved OpenAPI spec.
 */
export declare function specToTypeScript(spec: ResolvedSpec, options?: CatalogSummaryOptions): string;
//# sourceMappingURL=catalog-to-typescript.d.ts.map