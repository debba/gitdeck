import { beforeEach, describe, expect, it } from "vitest";
import { beginDashboardLoad, clearDashboardLoadMetrics, getDashboardLoadMetrics } from "../../src/utils/loadDiagnostics";

describe("dashboard load diagnostics", () => {
  beforeEach(() => clearDashboardLoadMetrics());

  it("records request sources and time to first content", () => {
    const load = beginDashboardLoad("issues", new Set(["repos", "issues"]), false);
    load.startResource("repos", "cache");
    load.startResource("issues", "network");
    load.finishResource("repos", true);
    load.finishResource("issues", true);

    expect(getDashboardLoadMetrics()).toEqual([
      expect.objectContaining({
        tab: "issues",
        resources: ["repos", "issues"],
        networkRequests: 1,
        cacheHits: 1,
        deduplicatedRequests: 0,
        failures: 0,
      }),
    ]);
    expect(getDashboardLoadMetrics()[0].firstContentMs).not.toBeNull();
  });
});
