import { afterEach, expect, it, vi } from "vitest";
import { createCmsPricingApiFetch } from "./api-adapter";
import { cmsPricingCatalog, DATASET_MAP } from "../spec/catalog";
import { cmsPricingFetch } from "./http";
vi.mock("./http", () => ({ cmsPricingFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const api = createCmsPricingApiFetch();
it("retains existing UUID routes and native query parameters", async () => {
  vi.mocked(cmsPricingFetch).mockResolvedValue(Response.json([{ hcpc: "00100" }]));
  expect(await api({ method: "GET", path: "/physician/by-provider/stats", params: { size: 1 } })).toEqual({ status: 200, data: [{ hcpc: "00100" }] });
  expect(cmsPricingFetch).toHaveBeenCalledWith(`/data-api/v1/dataset/${DATASET_MAP["physician/by-provider"]}/data/stats`, { size: 1 });
});
it("routes configuration without a dataset request", async () => {
  expect(await api({ method: "GET", path: "/fee-schedules/configured" })).toMatchObject({ status: 200, data: { release_qualification: "pending" } });
  expect(cmsPricingFetch).not.toHaveBeenCalled();
});
it.each([
  { method: "POST", path: "/fee-schedules/releases" },
  { method: "GET", path: "/physician/by-provider", body: {} },
])("rejects non-read requests", async request => {
  await expect(api(request)).rejects.toMatchObject({ status: 405 });
  expect(cmsPricingFetch).not.toHaveBeenCalled();
});
it("keeps the catalog endpoint count consistent", () => {
  expect(cmsPricingCatalog.endpointCount).toBe(cmsPricingCatalog.endpoints.length);
});
