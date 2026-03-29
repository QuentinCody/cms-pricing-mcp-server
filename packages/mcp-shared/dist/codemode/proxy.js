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
export class CodeModeProxy extends WorkerEntrypoint {
    stubByDoId = new Map();
    async callFunction(options) {
        let stub = this.stubByDoId.get(options.doId);
        if (!stub) {
            const ns = this.env.MCP_OBJECT;
            const id = ns.idFromString(options.doId);
            stub = ns.get(id);
            this.stubByDoId.set(options.doId, stub);
        }
        return stub.callTool(options.functionName, [options.args]);
    }
}
//# sourceMappingURL=proxy.js.map