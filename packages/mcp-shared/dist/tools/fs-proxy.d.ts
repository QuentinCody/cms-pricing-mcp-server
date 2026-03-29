/**
 * Filesystem proxy host handlers — routes V8 isolate fs.* calls
 * through the Durable Object's /fs/* endpoints.
 *
 * Returns a record of handler functions keyed by RPC name (__fs_read, etc.)
 * that are merged into the executor's function map in execute-tool.ts.
 *
 * The handlers communicate with a well-known DO instance (`__fs__`)
 * via HTTP fetch, keeping the filesystem isolated from staging data.
 */
interface DurableObjectStub {
    fetch(req: Request): Promise<Response>;
}
interface DurableObjectNamespace {
    idFromName(name: string): unknown;
    get(id: unknown): DurableObjectStub;
}
/** Handler function shape matching ExecutorFns in execute-tool.ts */
type FsHandler = (args: unknown) => Promise<unknown>;
export interface FsProxyHandlerOptions {
    /** DO namespace — uses idFromName("__fs__") for the shared filesystem DO */
    doNamespace: DurableObjectNamespace;
}
/**
 * Create handler functions for all __fs_* RPC calls from V8 isolates.
 * Merge the returned record into executorFns in createExecuteTool().
 */
export declare function createFsProxyHandlers(options: FsProxyHandlerOptions): Record<string, FsHandler>;
export {};
//# sourceMappingURL=fs-proxy.d.ts.map