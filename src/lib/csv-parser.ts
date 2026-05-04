/**
 * Re-export of the shared CSV parser. The implementation lives at
 * `@bio-mcp/shared/staging/csv-parser` so cms-pricing, oig-leie, and
 * future bulk-ingest servers (depmap, peddep, ...) share one parser.
 *
 * `parseCsv` here matches the historical signature: numeric auto-cast on,
 * `Record<string, unknown>[]` return shape. Behavior is locked by
 * tests/csv-parser-characterization.test.ts.
 */
export { parseCsv } from "@bio-mcp/shared/staging/csv-parser";
