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
// ---------------------------------------------------------------------------
// DO communication
// ---------------------------------------------------------------------------
const FS_DO_NAME = "__fs__";
async function fsFetch(doNamespace, action, body) {
    const doId = doNamespace.idFromName(FS_DO_NAME);
    const doStub = doNamespace.get(doId);
    const resp = await doStub.fetch(new Request(`http://localhost/fs/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }));
    const result = await resp.json();
    if (!result.success) {
        return { __fs_error: true, message: result.error ?? `fs.${action} failed` };
    }
    return result.data;
}
function toBody(args) {
    if (args !== null && typeof args === "object" && !Array.isArray(args)) {
        return args;
    }
    return {};
}
/**
 * Create handler functions for all __fs_* RPC calls from V8 isolates.
 * Merge the returned record into executorFns in createExecuteTool().
 */
export function createFsProxyHandlers(options) {
    const { doNamespace } = options;
    return {
        __fs_read: async (args) => fsFetch(doNamespace, "read", toBody(args)),
        __fs_write: async (args) => fsFetch(doNamespace, "write", toBody(args)),
        __fs_append: async (args) => fsFetch(doNamespace, "append", toBody(args)),
        __fs_mkdir: async (args) => fsFetch(doNamespace, "mkdir", toBody(args)),
        __fs_readdir: async (args) => fsFetch(doNamespace, "readdir", toBody(args)),
        __fs_stat: async (args) => fsFetch(doNamespace, "stat", toBody(args)),
        __fs_exists: async (args) => fsFetch(doNamespace, "exists", toBody(args)),
        __fs_rm: async (args) => fsFetch(doNamespace, "rm", toBody(args)),
        __fs_glob: async (args) => fsFetch(doNamespace, "glob", toBody(args)),
    };
}
//# sourceMappingURL=fs-proxy.js.map