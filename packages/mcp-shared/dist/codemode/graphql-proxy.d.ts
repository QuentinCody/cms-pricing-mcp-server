/**
 * GraphQL proxy source — pure JS injected into V8 isolates.
 *
 * Provides:
 *   gql.query(queryString, variables?) — execute GraphQL queries through server's fetch layer
 *   api.query(dataAccessId, sql)       — SQL query against staged data
 *   db.queryStaged(dataAccessId, sql)  — alias for api.query
 *   db.stage(data, tableName?)         — stage arbitrary data into SQLite
 *
 * API keys never enter the isolate — all HTTP goes through the host's gqlFetch.
 *
 * Large responses (>30KB) are auto-staged into SQLite. When this happens,
 * the result has `__staged: true` with a `data_access_id` and `schema`.
 */
/**
 * Returns the JS source string to inject into V8 isolates.
 * Relies on `codemode` proxy being available (from evaluator prefix).
 */
export declare function buildGraphqlProxySource(): string;
//# sourceMappingURL=graphql-proxy.d.ts.map