import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-attribution-${process.pid}-${Date.now()}`),
    getSnapshotHistory: vi.fn(),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));
vi.mock("../../src/server/snapshots", () => ({
  getRepositorySnapshotHistory: state.getSnapshotHistory,
}));

const store = await import("../../src/server/growth/store");
const { refreshContentPerformance } = await import("../../src/server/growth/attribution");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

const NOW = new Date("2026-09-10T00:00:00.000Z");
const MEDIA = [{ kind: "image" as const, url: "https://example.com/card.png", alt: "Card" }];

function createPublished(
  accountId = "account-a",
  repository = "acme/rocket",
  publishedAt = "2026-09-01T00:00:00.000Z",
) {
  return store.createContentItem({
    accountId,
    repository,
    channel: "x",
    format: "x-thread",
    status: "published",
    publishedAt,
    media: MEDIA,
  });
}

function completeHistory(targetStars = 125) {
  return [
    { date: "2026-09-01", stars: 100, forks: 20 },
    { date: "2026-09-03", stars: 110, forks: 22 },
    { date: "2026-09-08", stars: targetStars, forks: 25 },
  ];
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.getSnapshotHistory.mockReset();
  state.getSnapshotHistory.mockResolvedValue(completeHistory());
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth snapshot attribution refresh", () => {
  it("measures both due windows once for account-owned published content", async () => {
    const item = createPublished();
    createPublished("account-b");
    createPublished("account-a", "acme/other");
    store.createContentItem({
      accountId: "account-a",
      repository: "acme/rocket",
      channel: "x",
      format: "x-thread",
      status: "draft",
    });

    const result = await refreshContentPerformance("account-a", {
      repository: "acme/rocket",
      now: NOW,
    });

    expect(state.getSnapshotHistory).toHaveBeenCalledTimes(1);
    expect(state.getSnapshotHistory).toHaveBeenCalledWith("acme/rocket");
    expect(result).toEqual({
      refreshedAt: NOW.toISOString(),
      pending: [],
      performance: [
        {
          accountId: "account-a",
          contentId: item.id,
          window: "48h",
          measuredAt: NOW.toISOString(),
          metrics: { starsDelta: 10, forksDelta: 2 },
        },
        {
          accountId: "account-a",
          contentId: item.id,
          window: "7d",
          measuredAt: NOW.toISOString(),
          metrics: { starsDelta: 25, forksDelta: 5 },
        },
      ],
    });
    expect(store.listContentPerformance("account-b")).toEqual([]);
    expect(store.listContentPerformance("account-a", { repository: "acme/other" })).toEqual([]);
  });

  it("does not read snapshots for windows that are not due", async () => {
    const item = createPublished("account-a", "acme/rocket", "2026-09-09T00:00:00.000Z");

    const result = await refreshContentPerformance("account-a", { now: NOW });

    expect(state.getSnapshotHistory).not.toHaveBeenCalled();
    expect(result.performance).toEqual([]);
    expect(result.pending).toEqual([
      { contentId: item.id, window: "48h", dueAt: "2026-09-11T00:00:00.000Z", reason: "not-due" },
      { contentId: item.id, window: "7d", dueAt: "2026-09-16T00:00:00.000Z", reason: "not-due" },
    ]);
  });

  it("adds windows as they become due and updates existing measurements idempotently", async () => {
    const item = createPublished();
    const first = await refreshContentPerformance("account-a", {
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    expect(first.performance).toHaveLength(1);
    expect(first.pending).toEqual([{
      contentId: item.id,
      window: "7d",
      dueAt: "2026-09-08T00:00:00.000Z",
      reason: "not-due",
    }]);
    state.getSnapshotHistory.mockResolvedValue(completeHistory(130));

    const refreshed = await refreshContentPerformance("account-a", { now: NOW });

    expect(refreshed.performance).toHaveLength(2);
    expect(refreshed.performance.find(({ window }) => window === "7d")?.metrics)
      .toEqual({ starsDelta: 30, forksDelta: 5 });
    expect(store.listContentPerformance("account-a", { contentId: item.id })).toHaveLength(2);
  });

  it("preserves stored measurements and reports due work pending when history becomes incomplete", async () => {
    const item = createPublished();
    await refreshContentPerformance("account-a", { now: NOW });
    state.getSnapshotHistory.mockResolvedValue([
      { date: "2026-08-20", stars: 50, forks: 10 },
    ]);

    const refreshed = await refreshContentPerformance("account-a", {
      now: new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(refreshed.performance).toHaveLength(2);
    expect(refreshed.pending).toEqual([
      { contentId: item.id, window: "48h", dueAt: "2026-09-03T00:00:00.000Z", reason: "snapshot-unavailable" },
      { contentId: item.id, window: "7d", dueAt: "2026-09-08T00:00:00.000Z", reason: "snapshot-unavailable" },
    ]);
  });

  it("reports a missing publication timestamp without reading snapshots for it", async () => {
    const item = createPublished();
    getDatabase().prepare("UPDATE content_items SET published_at = NULL WHERE id = ?").run(item.id);

    const result = await refreshContentPerformance("account-a", { now: NOW });

    expect(state.getSnapshotHistory).not.toHaveBeenCalled();
    expect(result.pending).toEqual([
      { contentId: item.id, window: "48h", dueAt: null, reason: "missing-publication" },
      { contentId: item.id, window: "7d", dueAt: null, reason: "missing-publication" },
    ]);
  });
});
