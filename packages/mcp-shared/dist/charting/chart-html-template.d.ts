/**
 * MCP Apps HTML builder — produces a self-contained HTML document
 * with Observable Plot loaded from CDN for interactive charting.
 *
 * Returned as an EmbeddedResource with mimeType "text/html" for
 * GUI MCP clients (Claude Desktop, VS Code Insiders, ChatGPT, Goose).
 */
import type { ChartSpec } from "./chart-types.js";
export declare function buildChartHtml(spec: ChartSpec): string;
//# sourceMappingURL=chart-html-template.d.ts.map