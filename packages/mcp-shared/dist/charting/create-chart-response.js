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
import { renderUnicodeChart } from "./unicode-chart.js";
import { buildChartHtml } from "./chart-html-template.js";
const MAX_CHART_DATA_ROWS = 200;
export function createChartResponse(options) {
    const { chart, toolPrefix, textPreamble } = options;
    if (!chart.data || chart.data.length === 0) {
        return emptyChartResponse(chart);
    }
    const truncated = chart.data.length > MAX_CHART_DATA_ROWS;
    const chartData = truncated
        ? chart.data.slice(0, MAX_CHART_DATA_ROWS)
        : chart.data;
    const spec = { ...chart, data: chartData };
    const unicodeChart = renderUnicodeChart(spec);
    const textContent = textPreamble
        ? `${textPreamble}\n\n${unicodeChart}`
        : unicodeChart;
    const truncationNote = truncated
        ? `\n\n(Showing ${MAX_CHART_DATA_ROWS} of ${chart.data.length} data points)`
        : "";
    const htmlContent = buildChartHtml(spec);
    const htmlBase64 = btoa(unescape(encodeURIComponent(htmlContent)));
    return {
        content: [
            { type: "text", text: textContent + truncationNote },
            {
                type: "resource",
                resource: {
                    uri: `chart://${toolPrefix}/${encodeURIComponent(chart.title)}`,
                    mimeType: "text/html",
                    blob: htmlBase64,
                },
            },
        ],
        structuredContent: {
            success: true,
            data: {
                chart_rendered: true,
                title: spec.title,
                type: spec.type,
                data_points: chartData.length,
                ...(truncated
                    ? { truncated: true, total_data_points: chart.data.length }
                    : {}),
            },
            _chart: spec,
            _meta: { fetched_at: new Date().toISOString() },
        },
    };
}
function emptyChartResponse(chart) {
    return {
        content: [
            {
                type: "text",
                text: `${chart.title}\n\nNo data available to chart.`,
            },
        ],
        structuredContent: {
            success: true,
            data: { message: "No data available to chart" },
            _chart: { ...chart, data: [] },
        },
    };
}
//# sourceMappingURL=create-chart-response.js.map