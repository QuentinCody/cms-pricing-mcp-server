import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const CMS_DATA_BASE = "https://data.cms.gov";

export interface CmsPricingFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the Data.CMS.gov Data API.
 * Pattern: /data-api/v1/dataset/{uuid}/data?filter[col]=val&size=N&offset=N
 */
export async function cmsPricingFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: CmsPricingFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? CMS_DATA_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "cms-pricing-mcp-server/1.0 (bio-mcp)",
    });
}
