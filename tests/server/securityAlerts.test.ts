import { beforeEach, describe, expect, it, vi } from "vitest";

const { restApi, restApiPaginate } = vi.hoisted(() => ({
  restApi: vi.fn(),
  restApiPaginate: vi.fn(),
}));

vi.mock("../../src/server/githubClient", () => ({
  restApi,
  restApiPaginate,
}));

const { fetchRepoSecuritySummary } = await import("../../src/server/securityAlerts");

function alertsResult(alerts: Array<{ updated_at?: string; state?: string }>, ok = true) {
  return ok
    ? { ok: true as const, data: alerts }
    : { ok: false as const, error: "forbidden", status: 403 };
}

function mockApis(options: {
  status: { ok: true; data: null } | { ok: false; error: string; status?: number };
  dependabot?: Array<{ updated_at?: string; state?: string }>;
  codeScanning?: Array<{ updated_at?: string; state?: string }>;
  dependabotOk?: boolean;
  codeScanningOk?: boolean;
}) {
  restApi.mockResolvedValue(options.status);
  restApiPaginate.mockImplementation(async (path: string) => {
    if (String(path).includes("/dependabot/alerts")) {
      return alertsResult(options.dependabot ?? [], options.dependabotOk ?? true);
    }
    if (String(path).includes("/code-scanning/alerts")) {
      return alertsResult(options.codeScanning ?? [], options.codeScanningOk ?? true);
    }
    return { ok: false as const, error: `unexpected path ${path}` };
  });
}

describe("fetchRepoSecuritySummary", () => {
  beforeEach(() => {
    restApi.mockReset();
    restApiPaginate.mockReset();
  });

  it("counts open alerts when vulnerability alerts are enabled", async () => {
    mockApis({
      status: { ok: true, data: null },
      dependabot: [
        { updated_at: "2026-04-23T08:00:00Z", state: "open" },
        { updated_at: "2026-04-21T08:00:00Z", state: "open" },
      ],
      codeScanning: [{ updated_at: "2026-04-20T10:00:00Z", state: "open" }],
    });

    const summary = await fetchRepoSecuritySummary("acme/enabled");

    expect(restApi).toHaveBeenCalledWith("/repos/acme/enabled/vulnerability-alerts");
    expect(restApiPaginate.mock.calls.map(([path]) => path)).toEqual([
      "/repos/acme/enabled/dependabot/alerts?state=open&per_page=100",
      "/repos/acme/enabled/code-scanning/alerts?state=open&per_page=100",
    ]);
    expect(summary).toMatchObject({
      dependabotOpen: 2,
      codeScanningOpen: 1,
      totalOpen: 3,
      unavailable: false,
      vulnerabilityAlertsStatus: "enabled",
    });
  });

  it("drops stale dependabot alerts when vulnerability alerts are disabled", async () => {
    mockApis({
      status: { ok: false, error: "not found", status: 404 },
      dependabot: [
        { updated_at: "2026-04-23T08:00:00Z", state: "open" },
        { updated_at: "2026-04-22T08:00:00Z", state: "open" },
      ],
      codeScanning: [{ updated_at: "2026-04-20T10:00:00Z", state: "open" }],
    });

    const summary = await fetchRepoSecuritySummary("acme/disabled");

    expect(summary).toMatchObject({
      dependabotOpen: 0,
      codeScanningOpen: 1,
      totalOpen: 1,
      latestUpdatedAt: "2026-04-20T10:00:00Z",
      unavailable: false,
      vulnerabilityAlertsStatus: "disabled",
    });
  });

  it("does not mark the summary unavailable when disabled dependabot alerts cannot be loaded", async () => {
    mockApis({
      status: { ok: false, error: "not found", status: 404 },
      dependabotOk: false,
      codeScanning: [],
    });

    const summary = await fetchRepoSecuritySummary("acme/disabled-unavailable");

    expect(summary).toMatchObject({
      dependabotOpen: 0,
      codeScanningOpen: 0,
      totalOpen: 0,
      unavailable: false,
      vulnerabilityAlertsStatus: "disabled",
    });
  });

  it("keeps open alert counts when the vulnerability-alerts check is forbidden", async () => {
    mockApis({
      status: { ok: false, error: "forbidden", status: 403 },
      dependabot: [{ updated_at: "2026-04-23T08:00:00Z", state: "open" }],
      codeScanning: [],
    });

    const summary = await fetchRepoSecuritySummary("acme/unknown");

    expect(summary).toMatchObject({
      dependabotOpen: 1,
      codeScanningOpen: 0,
      totalOpen: 1,
      unavailable: false,
      vulnerabilityAlertsStatus: "unknown",
    });
  });

  it("caches the summary including the vulnerability-alerts status", async () => {
    mockApis({
      status: { ok: false, error: "not found", status: 404 },
      dependabot: [{ updated_at: "2026-04-23T08:00:00Z", state: "open" }],
      codeScanning: [],
    });

    const first = await fetchRepoSecuritySummary("acme/cached");
    const second = await fetchRepoSecuritySummary("acme/cached");

    expect(first).toBe(second);
    expect(first.vulnerabilityAlertsStatus).toBe("disabled");
    expect(first.dependabotOpen).toBe(0);
    expect(restApi).toHaveBeenCalledTimes(1);
    expect(restApiPaginate).toHaveBeenCalledTimes(2);
  });
});
