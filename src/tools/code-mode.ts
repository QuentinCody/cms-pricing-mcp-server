import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { cmsPricingResponse } from "../lib/tool-result";
import { cmsPricingCatalog } from "../spec/catalog";
import { createCmsPricingApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    CMS_PRICING_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createCmsPricingApiFetch();
    const registrar = { tool: (...args: unknown[]) => {
        // SAFETY: shared factories supply SDK arguments; only the alias name changes.
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof cmsPricingResponse>;
        const respond = (input: unknown, extra: unknown) => cmsPricingResponse(() => handler(input, extra), env, String(name), extra, input);
        register(name, ...rest, respond);
        register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "cms_pricing",
        catalog: cmsPricingCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "cms_pricing",
        // Verifiable provenance: cms_pricing_execute results carry a _meta.citation.
        source: { id: "cms_pricing", name: "CMS Pricing", url: "https://data.cms.gov" },
        catalog: cmsPricingCatalog,
        apiFetch,
        preserveApiErrors: true,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        timeout: 60_000,
        doNamespace: env.CMS_PRICING_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
