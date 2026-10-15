import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-performance-${process.pid}-${Date.now()}`),
    getSnapshotHistory: vi.fn(),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));
vi.mock("../../src/server/snapshots", () => ({
  getRepositorySnapshotHistory: state.getSnapshotHistory,
}));

const store = await import("../../src/server/growth/store");
const {
  getGrowthPerformanceSummary,
  getPerformanceAdjustedPillars,
} = await import("../../src/server/growth/performance");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

const MEDIA = [{ kind: "image" as const, url: "https://example.com/card.png", alt: "Card" }];
const ZERO_METRICS = {
  starsDelta: 0,
  forksDelta: 0,
  closedPrsDelta: 0,
  releaseDownloadsDelta: 0,
};

function createPublished(input: {
  accountId?: string;
  repository?: string;
  channel?: "x" | "linkedin" | "mastodon";
  pillar?: string;
  publishedAt: string;
}) {
  return store.createContentItem({
    accountId: input.accountId ?? "account-a",
    repository: input.repository ?? "acme/rocket",
    channel: input.channel ?? "x",
    format: input.channel === "linkedin" ? "linkedin-post" : "x-thread",
    pillar: input.pillar ?? "product",
    status: "published",
    publishedAt: input.publishedAt,
    media: MEDIA,
  });
}

function measure(
  accountId: string,
  contentId: string,
  window: "48h" | "7d",
  metrics: Record<string, number>,
  measuredAt = "2026-09-10T00:00:00.000Z",
): void {
  store.upsertContentPerformance(accountId, {
    contentId,
    window,
    measuredAt,
    metrics,
  });
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.getSnapshotHistory.mockReset();
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth performance summary reads", () => {
  it("joins account-owned measurements with inclusive repository and publication filters", () => {
    const fromEdge = createPublished({
      publishedAt: "2026-09-01T00:00:00.000Z",
      channel: "x",
      pillar: "product",
    });
    const toEdge = createPublished({
      publishedAt: "2026-09-03T00:00:00.000Z",
      channel: "linkedin",
      pillar: "",
    });
    const beforeRange = createPublished({ publishedAt: "2026-08-31T23:59:59.999Z" });
    const otherRepository = createPublished({
      repository: "acme/other",
      publishedAt: "2026-09-02T00:00:00.000Z",
    });
    const otherAccount = createPublished({
      accountId: "account-b",
      publishedAt: "2026-09-02T00:00:00.000Z",
    });
    createPublished({ publishedAt: "2026-09-02T12:00:00.000Z", channel: "mastodon" });
    const mismatchedAccountRow = createPublished({ publishedAt: "2026-09-02T18:00:00.000Z" });

    measure("account-a", fromEdge.id, "48h", { starsDelta: 3, forksDelta: -1 });
    measure("account-a", toEdge.id, "7d", { starsDelta: -2 });
    measure("account-a", beforeRange.id, "48h", { starsDelta: 100 });
    measure("account-a", otherRepository.id, "48h", { starsDelta: 50 });
    measure("account-b", otherAccount.id, "48h", { starsDelta: 70 });
    measure("account-a", mismatchedAccountRow.id, "48h", { starsDelta: 9 });
    getDatabase().prepare(
      "UPDATE content_performance SET account_id = ? WHERE content_id = ?",
    ).run("account-b", mismatchedAccountRow.id);

    const summary = getGrowthPerformanceSummary("account-a", {
      repository: "acme/rocket",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-03T00:00:00.000Z",
    });

    expect(summary.windows.map(({ window, measuredItems, metrics, channels, pillars }) => ({
      window,
      measuredItems,
      metrics,
      channels: channels.map(({ key, measuredItems: count }) => ({ key, count })),
      pillars: pillars.map(({ key, measuredItems: count }) => ({ key, count })),
    }))).toEqual([
      {
        window: "48h",
        measuredItems: 1,
        metrics: { ...ZERO_METRICS, starsDelta: 3, forksDelta: -1 },
        channels: [{ key: "x", count: 1 }],
        pillars: [{ key: "product", count: 1 }],
      },
      {
        window: "7d",
        measuredItems: 1,
        metrics: { ...ZERO_METRICS, starsDelta: -2 },
        channels: [{ key: "linkedin", count: 1 }],
        pillars: [{ key: "__unassigned__", count: 1 }],
      },
    ]);
    expect(state.getSnapshotHistory).not.toHaveBeenCalled();
  });

  it("returns zero-valued summaries without triggering attribution when nothing is measured", () => {
    createPublished({ publishedAt: "2026-09-02T00:00:00.000Z" });

    expect(getGrowthPerformanceSummary("account-a", {
      repository: "acme/rocket",
    }).windows).toEqual([
      { window: "48h", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
      { window: "7d", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
    ]);
    expect(getGrowthPerformanceSummary("account-b").windows.every(({ measuredItems }) => measuredItems === 0))
      .toBe(true);
    expect(state.getSnapshotHistory).not.toHaveBeenCalled();
  });

  it("rejects malformed or reversed ranges when called directly", () => {
    expect(() => getGrowthPerformanceSummary("account-a", { from: "invalid" }))
      .toThrow("invalid performance from date");
    expect(() => getGrowthPerformanceSummary("account-a", {
      from: "2026-09-03T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    })).toThrow("invalid performance date range");
  });

  it("derives weights only from the requested account and repository", () => {
    const productOne = createPublished({ publishedAt: "2026-09-01T00:00:00.000Z", pillar: "product" });
    const productTwo = createPublished({ publishedAt: "2026-09-02T00:00:00.000Z", pillar: "product" });
    const community = createPublished({ publishedAt: "2026-09-03T00:00:00.000Z", pillar: "community" });
    const otherRepository = createPublished({
      repository: "acme/other",
      publishedAt: "2026-09-03T00:00:00.000Z",
      pillar: "community",
    });
    const otherAccount = createPublished({
      accountId: "account-b",
      publishedAt: "2026-09-03T00:00:00.000Z",
      pillar: "community",
    });
    measure("account-a", productOne.id, "7d", { starsDelta: 10, forksDelta: 0 });
    measure("account-a", productTwo.id, "7d", { starsDelta: 10, forksDelta: 0 });
    measure("account-a", community.id, "7d", { starsDelta: 0, forksDelta: 0 });
    measure("account-a", otherRepository.id, "7d", { starsDelta: 100_000, forksDelta: 0 });
    measure("account-b", otherAccount.id, "7d", { starsDelta: 100_000, forksDelta: 0 });
    const pillars = [
      { id: "product", label: "Product", weight: 50, description: "" },
      { id: "community", label: "Community", weight: 50, description: "" },
    ];

    expect(getPerformanceAdjustedPillars(
      "account-a",
      "acme/rocket",
      pillars,
      "2026-10-05",
    )).toEqual({
      weightsAdjusted: true,
      pillars: [
        { ...pillars[0], weight: 58 },
        { ...pillars[1], weight: 42 },
      ],
    });
    expect(getPerformanceAdjustedPillars(
      "account-b",
      "acme/rocket",
      pillars,
      "2026-10-05",
    )).toEqual({ weightsAdjusted: false, pillars });
    expect(state.getSnapshotHistory).not.toHaveBeenCalled();
  });
});
