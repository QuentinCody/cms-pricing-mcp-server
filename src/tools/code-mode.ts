import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
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

    const searchTool = createSearchTool({
        prefix: "cms_pricing",
        catalog: cmsPricingCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "cms_pricing",
        catalog: cmsPricingCatalog,
        apiFetch,
        doNamespace: env.CMS_PRICING_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
