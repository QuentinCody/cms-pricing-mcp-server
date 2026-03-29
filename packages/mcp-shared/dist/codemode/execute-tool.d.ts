/**
 * Execute tool factory — creates a `<prefix>_execute` tool for Code Mode.
 *
 * Uses DynamicWorkerExecutor (inlined from @cloudflare/codemode) to run user
 * code in a sandboxed V8 isolate via the Worker Loader binding.
 *
 * The isolate gets:
 * - codemode.__api_proxy() — routes API calls through server HTTP layer
 * - Pre-injected catalog search helpers (searchSpec, listCategories, etc.)
 * - Pre-injected api.get/api.post wrappers
 * - console.log() capture
 *
 * API keys never enter the isolate — all HTTP goes through the host's apiFetch.
 */
import { z } from "zod";
import { RpcTarget } from "cloudflare:workers";
import type { ApiCatalog, ApiFetchFn } from "./catalog";
import type { ResolvedSpec } from "./openapi-resolver";
import type { ToolEntry } from "../registry/types";
export type ExecutorFns = Record<string, (...args: unknown[]) => Promise<unknown>>;
export interface ExecutorResult {
    result?: unknown;
    error?: string;
    logs?: string[];
    __stagedResults?: Array<Record<string, unknown>>;
}
/** RPC target that dispatches tool calls from the isolate back to the host. */
export declare class ToolDispatcher extends RpcTarget {
    #private;
    constructor(fns: ExecutorFns);
    call(name: string, argsJson: string): Promise<string>;
}
/** Minimal interface for the Cloudflare Worker Loader binding. */
export interface WorkerLoaderBinding {
    get(name: string, factory: () => unknown): {
        getEntrypoint(): {
            evaluate(dispatcher: ToolDispatcher): Promise<ExecutorResult>;
        };
    };
}
/** Executes code in an isolated V8 Worker via the Worker Loader binding. */
export declare class DynamicWorkerExecutor {
    #private;
    constructor(options: {
        loader: WorkerLoaderBinding;
        timeout?: number;
    });
    execute(code: string, fns: ExecutorFns): Promise<ExecutorResult>;
}
export interface ExecuteToolOptions {
    /** Tool name prefix (e.g., "gtex" → "gtex_execute") */
    prefix: string;
    /** The legacy API catalog (optional when using OpenAPI mode) */
    catalog?: ApiCatalog;
    /** Resolved OpenAPI spec injected into the isolate in place of the catalog */
    openApiSpec?: ResolvedSpec;
    /** Server's HTTP fetch adapter */
    apiFetch: ApiFetchFn;
    /** DO namespace for auto-staging large responses */
    doNamespace?: unknown;
    /** Worker Loader binding for V8 isolate creation (WorkerLoaderBinding) */
    loader: unknown;
    /** Byte threshold for auto-staging (default 100KB) */
    stagingThreshold?: number;
    /** Execution timeout in ms (default 30000) */
    timeout?: number;
    /** Optional JavaScript source injected into the isolate before user code.
     *  Use to provide domain-specific helper functions (e.g. stats.computePRR). */
    preamble?: string;
    /** DO namespace for virtual filesystem. When provided, fs.* is available in isolates.
     *  Uses idFromName("__fs__") for a shared filesystem DO instance. */
    fsDoNamespace?: unknown;
}
export interface ExecuteToolResult {
    name: string;
    apiProxyTool: ToolEntry;
    description: string;
    schema: {
        code: z.ZodString;
    };
    register: (server: {
        tool: (...args: unknown[]) => void;
    }) => void;
}
/**
 * Create an execute tool registration object.
 */
export declare function createExecuteTool(options: ExecuteToolOptions): ExecuteToolResult;
//# sourceMappingURL=execute-tool.d.ts.map