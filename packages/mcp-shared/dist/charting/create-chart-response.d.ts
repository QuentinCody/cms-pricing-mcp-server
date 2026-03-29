/**
 * Main chart response factory — produces a multi-format response
 * compatible with all three client tiers:
 *
 *   content[0] = Unicode text chart (CLI)
 *   content[1] = EmbeddedResource HTML (MCP Apps GUI clients)
 *   structuredContent._chart = ChartSpec (our Next.js web app)
 *
 * Runs in the Cloudflare Worker (MCP Server), not the V8 isolate sandbox.
 */
import type { ChartSpec, ChartResponseOptions } from "./chart-types.js";
export interface ChartTextContent {
    type: "text";
    text: string;
}
export interface ChartResourceContent {
    type: "resource";
    resource: {
        uri: string;
        mimeType: string;
        blob: string;
    };
}
export interface ChartResponseResult {
    content: Array<ChartTextContent | ChartResourceContent>;
    structuredContent: {
        success: true;
        data: Record<string, unknown>;
        _chart: ChartSpec;
        _meta?: Record<string, unknown>;
    };
}
export declare function createChartResponse(options: ChartResponseOptions): ChartResponseResult;
//# sourceMappingURL=create-chart-response.d.ts.map