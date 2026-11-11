import { expect, it } from "vitest";
import { beginIngest, promoteIngest, failIngest, INGEST_LEASE_MS } from "./ingest-control";

const first = { idempotencyKeyHash: "key", requestHash: "selection", generation: "attempt-1", now: 100 };
const state = beginIngest({ activeGeneration: "prior" }, undefined, first).state;
const completed = { ...first, completedAt: 200, results: [] };
it("serializes competing loads and binds replay to the source selection", () => {
  expect(beginIngest(state, undefined, { ...first, generation: "attempt-2" }).status).toBe("in_progress");
  expect(beginIngest(state, undefined, { ...first, requestHash: "changed" }).status).toBe("conflict");
  const promoted = promoteIngest(state, completed);
  expect(promoted).toMatchObject({ activeGeneration: "attempt-1", previousGeneration: "prior", running: undefined });
  expect(beginIngest(promoted, completed, { ...first, generation: "unused" }).status).toBe("replayed");
  expect(beginIngest(promoted, completed, { ...first, requestHash: "changed" }).status).toBe("conflict");
});
it("prevents an expired or replaced attempt from promoting or failing its successor", () => {
  expect(() => promoteIngest(state, { ...completed, completedAt: 101 + INGEST_LEASE_MS })).toThrow(/lease/);
  expect(() => promoteIngest(state, { ...completed, requestHash: "changed" })).toThrow(/lease/);
  const replacement = beginIngest(state, undefined, { ...first, generation: "attempt-2", now: 101 + INGEST_LEASE_MS }).state;
  expect(() => promoteIngest(replacement, completed)).toThrow(/lease/);
  expect(failIngest(replacement, { ...first, failedAt: 300, error: "stale" })).toEqual(replacement);
  expect(failIngest(replacement, { ...first, generation: "attempt-2", failedAt: 300, error: "failed" })).toMatchObject({ activeGeneration: "prior", running: undefined });
});
