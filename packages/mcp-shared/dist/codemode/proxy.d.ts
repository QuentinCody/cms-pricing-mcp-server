/**
 * CodeModeProxy — bridge between V8 isolates and Durable Object tools.
 *
 * This WorkerEntrypoint receives callFunction() from V8 isolates and
 * routes them to the agent's callTool() method via DO RPC.
 *
 * Needed because DurableObjectStub/DurableObjectNamespace can't be
 * serialized across Worker Loader isolate boundaries, but a Fetcher
 * to a WorkerEntrypoint (via service binding) CAN be.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
/** Environment shape expected by CodeModeProxy — each server binds MCP_OBJECT. */
interface CodeModeProxyEnv {
    MCP_OBJECT: DurableObjectNamespace;
}
export declare class CodeModeProxy extends WorkerEntrypoint<CodeModeProxyEnv> {
    private stubByDoId;
    callFunction(options: {
        functionName: string;
        args: unknown;
        doId: string;
    }): Promise<unknown>;
}
export {};
//# sourceMappingURL=proxy.d.ts.map