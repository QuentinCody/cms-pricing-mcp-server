/**
 * GraphQL schema source — pure JS injected into V8 isolates.
 *
 * Provides schema.types(), schema.type(), schema.search(),
 * schema.queryRoot(), schema.mutationRoot(), schema.inputType(),
 * and schema.enumValues() functions that operate on the frozen
 * SCHEMA object (trimmed introspection data).
 */
/**
 * Returns the JS source string to inject into V8 isolates.
 * The introspection JSON is embedded as a frozen global `SCHEMA`.
 */
export declare function buildGraphqlSchemaSource(introspectionJson: string): string;
//# sourceMappingURL=graphql-schema-source.d.ts.map