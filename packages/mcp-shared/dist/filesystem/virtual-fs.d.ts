/**
 * VirtualFS — SQLite-backed virtual filesystem for Code Mode V8 isolates.
 *
 * Provides a persistent scratch filesystem within Durable Object SQLite.
 * Files written in one tool call persist and can be read in subsequent calls.
 *
 * Inspired by narumatt/sqlitefs schema design, reimplemented as a TypeScript
 * library with no Cloudflare or POSIX dependencies.
 */
import type { SqlExec } from "../staging/chunking";
export interface FsStat {
    path: string;
    kind: "file" | "directory";
    size: number;
    created_at: string;
    modified_at: string;
}
export interface FsGlobResult {
    matches: string[];
    count: number;
}
export declare class VirtualFS {
    #private;
    constructor(sql: SqlExec);
    private ensureSchema;
    private normalizePath;
    private parentPath;
    private baseName;
    /** Create all ancestor directories for a path (not the path itself). */
    private ensureParentDirs;
    writeFile(filePath: string, content: string): {
        path: string;
        size: number;
    };
    appendFile(filePath: string, content: string): {
        path: string;
        size: number;
    };
    readFile(filePath: string): string;
    mkdir(dirPath: string, options?: {
        recursive?: boolean;
    }): void;
    readdir(dirPath: string): string[];
    stat(filePath: string): FsStat;
    exists(filePath: string): boolean;
    rm(filePath: string, options?: {
        recursive?: boolean;
    }): void;
    glob(pattern: string): FsGlobResult;
}
//# sourceMappingURL=virtual-fs.d.ts.map