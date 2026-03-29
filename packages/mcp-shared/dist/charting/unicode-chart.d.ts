/**
 * Terminal chart renderer — produces Unicode text strings from ChartSpec.
 *
 * Uses block characters (█) for bar charts and simple-ascii-chart for line/scatter.
 * Runs in Cloudflare Workers (no DOM, no Node.js APIs).
 */
import type { ChartSpec } from "./chart-types.js";
export declare function renderUnicodeChart(spec: ChartSpec): string;
//# sourceMappingURL=unicode-chart.d.ts.map