import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { cmsPricingFetch } from "./http";
import { DATASET_MAP } from "../spec/catalog";
import { feeScheduleRoute } from "./fee-schedule-releases";
import { fail } from "./fee-schedule-http";
import { feeArchiveRoute } from "./fee-schedule-archive";

/**
 * Maps friendly catalog paths to Data.CMS.gov Data API URLs.
 *
 * Catalog paths like "/inpatient/by-provider-service" are translated to
 * "/data-api/v1/dataset/{uuid}/data" using the DATASET_MAP lookup.
 *
 * Appending /stats to any path hits the stats endpoint instead.
 */
export function createCmsPricingApiFetch(): ApiFetchFn {
    return async (request) => {
        if (request.method !== "GET" || request.body !== undefined) fail("CMS pricing routes require bodyless GET requests", 405);
        if (["/fee-schedules/archive", "/fee-schedules/rvus"].includes(request.path)) {
            const data = await feeArchiveRoute(request.path, request.params ?? {});
            return { status: 200, data, ...("records" in data ? { completeness: {
                complete: data.complete, returned: data.records.length, total_available: data.total_rows,
                ...(data.complete ? {} : { truncation: { reason: "page_limit" as const, detail: "Selected archive member slice; continue with the same qp, release, archive URL and SHA-256" } }),
            } } : {}) };
        }
        if (request.path.startsWith("/fee-schedules/")) {
            return { status: 200, data: await feeScheduleRoute(request.path, request.params ?? {}) };
        }
        let path = request.path;

        // Strip leading slash for lookup
        const cleanPath = path.startsWith("/") ? path.slice(1) : path;

        // Check for /stats suffix
        const isStats = cleanPath.endsWith("/stats");
        const lookupPath = isStats ? cleanPath.replace(/\/stats$/, "") : cleanPath;

        // Look up dataset UUID
        const uuid = DATASET_MAP[lookupPath];
        if (!uuid) {
            const available = Object.keys(DATASET_MAP).join(", ");
            const error = new Error(
                `Unknown dataset path: "${lookupPath}". Available: ${available}`,
            ) as Error & { status: number; data: unknown };
            error.status = 404;
            error.data = { available_paths: Object.keys(DATASET_MAP) };
            throw error;
        }

        // Build the actual CMS API path
        path = `/data-api/v1/dataset/${uuid}/data${isStats ? "/stats" : ""}`;

        // Pass through all query params (filter[], keyword, size, offset, sort, column)
        const response = await cmsPricingFetch(path, request.params);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(
                `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            ) as Error & { status: number; data: unknown };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}
