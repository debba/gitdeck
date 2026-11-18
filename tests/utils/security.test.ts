import { describe, expect, it } from "vitest";
import { buildRepoSecuritySummary } from "../../src/utils/security";

describe("security utilities", () => {
  it("summarizes dependabot and code scanning alerts", () => {
    const summary = buildRepoSecuritySummary({
      dependabotAlerts: [
        { updated_at: "2026-04-21T10:00:00Z" },
        { updatedAt: "2026-04-23T08:00:00Z" },
      ],
      codeScanningAlerts: [
        { updated_at: "2026-04-20T10:00:00Z" },
      ],
    });

    expect(summary.dependabotOpen).toBe(2);
    expect(summary.codeScanningOpen).toBe(1);
    expect(summary.totalOpen).toBe(3);
    expect(summary.latestUpdatedAt).toBe("2026-04-23T08:00:00Z");
    expect(summary.unavailable).toBe(false);
    expect(summary.vulnerabilityAlertsStatus).toBe("enabled");
  });

  it("preserves an unavailable flag when alert sources cannot be loaded", () => {
    const summary = buildRepoSecuritySummary({
      dependabotAlerts: [],
      codeScanningAlerts: [],
      unavailable: true,
    });

    expect(summary.totalOpen).toBe(0);
    expect(summary.unavailable).toBe(true);
    expect(summary.vulnerabilityAlertsStatus).toBe("enabled");
  });

  it("ignores stale dependabot alerts when vulnerability alerts are disabled", () => {
    const summary = buildRepoSecuritySummary({
      dependabotAlerts: [
        { updated_at: "2026-04-21T10:00:00Z", state: "open" },
        { updatedAt: "2026-04-23T08:00:00Z", state: "open" },
      ],
      codeScanningAlerts: [
        { updated_at: "2026-04-20T10:00:00Z", state: "open" },
      ],
      vulnerabilityAlertsStatus: "disabled",
    });

    expect(summary.dependabotOpen).toBe(0);
    expect(summary.codeScanningOpen).toBe(1);
    expect(summary.totalOpen).toBe(1);
    expect(summary.latestUpdatedAt).toBe("2026-04-20T10:00:00Z");
    expect(summary.unavailable).toBe(false);
    expect(summary.vulnerabilityAlertsStatus).toBe("disabled");
  });

  it("keeps open dependabot counts when the enabled status is unknown", () => {
    const summary = buildRepoSecuritySummary({
      dependabotAlerts: [
        { updated_at: "2026-04-23T08:00:00Z", state: "open" },
      ],
      codeScanningAlerts: [],
      vulnerabilityAlertsStatus: "unknown",
    });

    expect(summary.dependabotOpen).toBe(1);
    expect(summary.totalOpen).toBe(1);
    expect(summary.unavailable).toBe(false);
    expect(summary.vulnerabilityAlertsStatus).toBe("unknown");
  });

  it("counts only open alerts when a state is present", () => {
    const summary = buildRepoSecuritySummary({
      dependabotAlerts: [
        { updated_at: "2026-04-23T08:00:00Z", state: "open" },
        { updated_at: "2026-04-22T08:00:00Z", state: "dismissed" },
        { updated_at: "2026-04-21T08:00:00Z", state: "fixed" },
      ],
      codeScanningAlerts: [
        { updated_at: "2026-04-20T10:00:00Z", state: "open" },
        { updated_at: "2026-04-19T10:00:00Z", state: "closed" },
      ],
      vulnerabilityAlertsStatus: "enabled",
    });

    expect(summary.dependabotOpen).toBe(1);
    expect(summary.codeScanningOpen).toBe(1);
    expect(summary.totalOpen).toBe(2);
    expect(summary.latestUpdatedAt).toBe("2026-04-23T08:00:00Z");
  });
});
