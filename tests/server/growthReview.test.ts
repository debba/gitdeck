import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-review-${process.pid}-${Date.now()}`),
    aiConfigured: false,
    generateStructured: vi.fn(),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));
vi.mock("../../src/server/ai/settings", () => ({
  isAiConfigured: vi.fn(() => state.aiConfigured),
}));
vi.mock("../../src/server/ai/client", async (importActual) => ({
  ...await importActual<typeof import("../../src/server/ai/client")>(),
  generateStructured: state.generateStructured,
}));

const store = await import("../../src/server/growth/store");
const { getGrowthWeeklyReview } = await import("../../src/server/growth/review");
const { closeDatabase } = await import("../../src/server/sqlite");

const clock = () => new Date("2026-09-16T12:00:00.000Z");
const media = [{ kind: "image" as const, url: "https://example.com/card.png", alt: "Card" }];

function createPublished(accountId: string, repository: string, publishedAt: string) {
  return store.createContentItem({
    accountId,
    repository,
    channel: "x",
    format: "x-thread",
    pillar: "product",
    title: `${repository} release`,
    status: "published",
    scheduledFor: publishedAt,
    publishedAt,
    media,
  });
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.aiConfigured = false;
  state.generateStructured.mockReset();
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("weekly Growth Review service", () => {
  it("builds repository and global reviews only from account-scoped persisted facts", async () => {
    const rocket = createPublished("account-a", "acme/rocket", "2026-09-09T10:00:00.000Z");
    const docs = createPublished("account-a", "acme/docs", "2026-09-10T10:00:00.000Z");
    createPublished("account-b", "acme/rocket", "2026-09-11T10:00:00.000Z");
    store.createContentItem({
      accountId: "account-a",
      repository: "acme/rocket",
      channel: "linkedin",
      format: "linkedin-post",
      pillar: "community",
      title: "Missed story",
      status: "draft",
      scheduledFor: "2026-09-12T10:00:00.000Z",
    });
    store.createContentItem({
      accountId: "account-a",
      repository: "acme/rocket",
      channel: "mastodon",
      format: "mastodon-post",
      pillar: "community",
      title: "Upcoming story",
      status: "ready",
      scheduledFor: "2026-09-18T10:00:00.000Z",
      media,
    });
    store.createGrowthIntervention({
      accountId: "account-a",
      repository: "acme/rocket",
      category: "community",
      title: "Welcome contributors",
      action: "Publish a contributor path.",
      origin: "manual",
      dedupeKey: "welcome",
      status: "accepted",
    });
    store.upsertContentPerformance("account-a", {
      contentId: rocket.id,
      window: "48h",
      measuredAt: "2026-09-12T10:00:00.000Z",
      metrics: { starsDelta: 4, forksDelta: -1 },
    });
    store.upsertContentPerformance("account-a", {
      contentId: docs.id,
      window: "7d",
      measuredAt: "2026-09-17T10:00:00.000Z",
      metrics: { starsDelta: 2 },
    });

    const before = {
      content: store.listContentItems("account-a"),
      interventions: store.listGrowthInterventions("account-a"),
      performance: store.listContentPerformance("account-a"),
    };
    const repositoryReview = await getGrowthWeeklyReview(
      "account-a",
      { repository: "acme/rocket" },
      clock,
    );
    const globalReview = await getGrowthWeeklyReview("account-a", {}, clock);
    const otherAccountReview = await getGrowthWeeklyReview("account-b", {}, clock);

    expect(repositoryReview).toMatchObject({
      repository: "acme/rocket",
      aiEnabled: false,
      usedFallback: true,
      empty: false,
    });
    expect(repositoryReview.publishedItems.map(({ id }) => id)).toEqual([rocket.id]);
    expect(repositoryReview.missedItems.map(({ title }) => title)).toEqual(["Missed story"]);
    expect(repositoryReview.upcomingItems.map(({ title }) => title)).toEqual(["Upcoming story"]);
    expect(repositoryReview.performance.windows[0]).toMatchObject({
      window: "48h",
      measuredItems: 1,
      metrics: { starsDelta: 4, forksDelta: -1 },
    });
    expect(repositoryReview.performance.windows[1].measuredItems).toBe(0);
    expect(globalReview.publishedItems.map(({ id }) => id)).toEqual([rocket.id, docs.id]);
    expect(globalReview.performance.windows.map(({ measuredItems }) => measuredItems)).toEqual([1, 1]);
    expect(otherAccountReview.publishedItems).toHaveLength(1);
    expect(otherAccountReview.publishedItems[0].id).not.toBe(rocket.id);
    expect(state.generateStructured).not.toHaveBeenCalled();
    expect({
      content: store.listContentItems("account-a"),
      interventions: store.listGrowthInterventions("account-a"),
      performance: store.listContentPerformance("account-a"),
    }).toEqual(before);
  });

  it("allows AI to replace only a valid narrative and falls back on malformed output or errors", async () => {
    const published = createPublished("account-a", "acme/rocket", "2026-09-09T10:00:00.000Z");
    store.upsertContentPerformance("account-a", {
      contentId: published.id,
      window: "48h",
      measuredAt: "2026-09-12T10:00:00.000Z",
      metrics: { starsDelta: 5 },
    });
    state.aiConfigured = true;
    state.generateStructured.mockResolvedValueOnce({
      provider: "test",
      model: "test-model",
      data: { narrative: "Measured facts show a useful first signal." },
    });

    const enhanced = await getGrowthWeeklyReview("account-a", {}, clock);
    expect(enhanced).toMatchObject({
      narrative: "Measured facts show a useful first signal.",
      aiEnabled: true,
      usedFallback: false,
    });
    expect(state.generateStructured).toHaveBeenCalledTimes(1);
    expect(state.generateStructured.mock.calls[0][0]).toMatchObject({
      schemaName: "growth_weekly_review_narrative",
      schema: { required: ["narrative"] },
    });

    state.generateStructured.mockResolvedValueOnce({
      provider: "test",
      model: "test-model",
      data: { narrative: "   " },
    });
    const malformed = await getGrowthWeeklyReview("account-a", {}, clock);
    expect(malformed.usedFallback).toBe(true);
    expect(malformed.narrative).toContain("measured attribution available");
    expect(malformed.publishedItems).toEqual(enhanced.publishedItems);
    expect(malformed.performance).toEqual(enhanced.performance);
    expect(malformed.recommendations).toEqual(enhanced.recommendations);

    state.generateStructured.mockRejectedValueOnce(new Error("provider unavailable"));
    const failed = await getGrowthWeeklyReview("account-a", {}, clock);
    expect(failed).toMatchObject({ aiEnabled: true, usedFallback: true });
    expect(failed.narrative).toBe(malformed.narrative);
    expect(state.generateStructured).toHaveBeenCalledTimes(3);
  });
});
