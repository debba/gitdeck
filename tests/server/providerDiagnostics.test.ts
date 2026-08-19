import { beforeEach, describe, expect, it } from "vitest";
import { getProviderMetrics, measureProviderCall, resetProviderMetrics } from "../../src/server/providerDiagnostics";

describe("provider diagnostics", () => {
  beforeEach(() => resetProviderMetrics());

  it("counts provider calls, failures and durations", async () => {
    await measureProviderCall("repos", async () => ["repo"]);
    await expect(measureProviderCall("repos", async () => { throw new Error("failed"); })).rejects.toThrow("failed");

    expect(getProviderMetrics().operations).toEqual([
      expect.objectContaining({
        operation: "repos",
        calls: 2,
        failures: 1,
      }),
    ]);
    expect(getProviderMetrics().operations[0].totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
