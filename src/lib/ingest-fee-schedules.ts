/**
 * Fee schedule ingestion — fetches CSVs from CMS, parses them,
 * and stages into a well-known Durable Object for persistent SQL queries.
 */

import { parseCsv } from "./csv-parser";
import { FEE_SCHEDULE_DO_ID, FEE_SCHEDULE_SOURCES, type FeeScheduleSource } from "./fee-schedule-sources";

interface IngestResult {
    key: string;
    name: string;
    tableName: string;
    rows: number;
    status: "ok" | "error";
    error?: string;
}

/**
 * Ingest all fee schedule CSVs into the well-known DO.
 * Drops existing tables first to ensure clean refresh.
 */
export async function ingestFeeSchedules(
    doNamespace: DurableObjectNamespace,
): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    const doId = doNamespace.idFromName(FEE_SCHEDULE_DO_ID);
    const doInstance = doNamespace.get(doId);

    // Wipe existing data so re-ingest doesn't duplicate rows
    await doInstance.fetch(
        new Request("http://localhost/delete", { method: "DELETE" }),
    );

    for (const source of FEE_SCHEDULE_SOURCES) {
        const result = await ingestOne(doInstance, source);
        results.push(result);
    }

    return results;
}

async function ingestOne(
    doInstance: DurableObjectStub,
    source: FeeScheduleSource,
): Promise<IngestResult> {
    try {
        // Fetch CSV from CMS
        const response = await fetch(source.url, {
            headers: { "User-Agent": "cms-pricing-mcp-server/1.0 (bio-mcp)" },
        });

        if (!response.ok) {
            return {
                key: source.key,
                name: source.name,
                tableName: source.tableName,
                rows: 0,
                status: "error",
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }

        const csvText = await response.text();
        const rows = parseCsv(csvText);

        if (rows.length === 0) {
            return {
                key: source.key,
                name: source.name,
                tableName: source.tableName,
                rows: 0,
                status: "error",
                error: "CSV parsed to 0 rows",
            };
        }

        // Stage into the well-known DO via its /process endpoint.
        // Wrap in { data, schema_hints } so the DO uses our table name.
        const processResponse = await doInstance.fetch(
            new Request("http://localhost/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    data: rows,
                    schema_hints: {
                        tableName: source.tableName,
                        indexes: inferIndexes(source),
                    },
                }),
            }),
        );

        if (!processResponse.ok) {
            const body = await processResponse.text().catch(() => "");
            return {
                key: source.key,
                name: source.name,
                tableName: source.tableName,
                rows: rows.length,
                status: "error",
                error: `DO /process failed: HTTP ${processResponse.status} ${body.slice(0, 200)}`,
            };
        }

        return {
            key: source.key,
            name: source.name,
            tableName: source.tableName,
            rows: rows.length,
            status: "ok",
        };
    } catch (err) {
        return {
            key: source.key,
            name: source.name,
            tableName: source.tableName,
            rows: 0,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/** Infer useful indexes based on the dataset type. */
function inferIndexes(source: FeeScheduleSource): string[] {
    switch (source.key) {
        case "pfs-indicators":
            return ["hcpc", "modifier", "proc_stat"];
        case "pfs-localities":
            return ["locality", "mac_description", "loc_description"];
        default:
            return [];
    }
}
