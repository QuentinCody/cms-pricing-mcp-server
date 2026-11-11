/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { CmsPricingDataDO } from "../do";

export function createStore() {
  const database = new DatabaseSync(":memory:");
  let ready = Promise.resolve();
  const exec = (query: string, ...values: any[]) => {
    const rows = database.prepare(query).all(...values);
    const iterator = rows[Symbol.iterator]();
    return { toArray: () => rows, one: () => rows[0], next: () => iterator.next(), [Symbol.iterator]: () => iterator };
  };
  const transactionSync = <T>(run: () => T): T => {
    database.exec("BEGIN");
    try { const result = run(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const values = new Map<string, unknown>();
  const kv = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
  };
  const storage = {
    ...kv, sql: { exec }, transactionSync,
    transaction: async <T>(run: (txn: typeof kv) => Promise<T>): Promise<T> => run(kv),
    deleteAll: async () => {
      for (const row of database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
        database.exec(`DROP TABLE "${String(row.name).replaceAll('"', '""')}"`);
      }
      values.clear();
    },
  };
  const ctx = { blockConcurrencyWhile: (run: () => Promise<void>) => { ready = run(); return ready; }, storage };
  const instance = new CmsPricingDataDO(ctx as unknown as DurableObjectState, {} as Cloudflare.Env);
  return { database, instance, ready };
}
