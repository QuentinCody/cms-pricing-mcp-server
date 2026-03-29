/**
 * GraphQL introspection-to-summary — generates a compact API reference
 * for embedding in the `_execute` tool description.
 *
 * The output lists top-level query fields with their arguments and key
 * types with their important fields, giving the LLM enough context to
 * start writing queries immediately.
 */
import type { TrimmedIntrospection } from "./graphql-introspection";
export interface IntrospectionSummaryOptions {
    /** Max number of query root fields to show (default 15) */
    maxQueryFields?: number;
    /** Max key types to show in detail (default 8) */
    maxTypes?: number;
    /** Max fields per type (default 8) */
    maxFieldsPerType?: number;
}
/**
 * Generate a compact GraphQL schema summary from trimmed introspection data.
 */
export declare function introspectionToSummary(introspection: TrimmedIntrospection, options?: IntrospectionSummaryOptions): string;
//# sourceMappingURL=graphql-to-typescript.d.ts.map