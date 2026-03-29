/**
 * Filesystem proxy source — pure JS injected into V8 isolates.
 *
 * Provides:
 *   fs.readFile(path)           — read file content as string
 *   fs.writeFile(path, content) — write string (auto-stringifies objects)
 *   fs.appendFile(path, content)— append to file (creates if missing)
 *   fs.mkdir(path, opts?)       — create directory (recursive by default)
 *   fs.readdir(path)            — list directory entries
 *   fs.stat(path)               — get file/directory metadata
 *   fs.exists(path)             — check if path exists
 *   fs.rm(path, opts?)          — remove file or directory
 *   fs.glob(pattern)            — glob pattern matching
 *   fs.readJSON(path)           — readFile + JSON.parse (no extra RPC)
 *   fs.writeJSON(path, data)    — JSON.stringify + writeFile (no extra RPC)
 *
 * All operations persist in DO SQLite across tool calls within a session.
 * API keys and network access are not involved — this is pure storage.
 */
/**
 * Returns the JS source string to inject into V8 isolates.
 * Relies on `codemode` proxy being available (from evaluator prefix).
 */
export declare function buildFsProxySource(): string;
//# sourceMappingURL=fs-proxy.d.ts.map