import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";

const { TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return { TMP_DIR: resolve(tmpdir(), `gitdeck-growth-recycling-${process.pid}-${Date.now()}`) };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: TMP_DIR }));

const store = await import("../../src/server/growth/store");
const {
  EvergreenRecycleUnavailableError,
  recycleEvergreenContent,
} = await import("../../src/server/growth/recycling");
const { closeDatabase } = await import("../../src/server/sqlite");

const NOW = new Date("2026-09-10T12:00:00.000Z");

beforeEach(async () => {
  closeDatabase();
  await rm(TMP_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  closeDatabase();
  await rm(TMP_DIR, { recursive: true, force: true });
});

function eligibleIntervention() {
  const source = store.createContentItem({
    accountId: "account-a",
    repository: "acme/rocket",
    channel: "x",
    format: "x-thread",
    title: "Contributor guide",
    body: "Keep this published copy.",
    media: [{ kind: "image", url: "https://example.com/guide.png", alt: "Guide" }],
    sources: ["https://example.com/guide"],
    status: "published",
    publishedAt: "2026-07-01T12:00:00.000Z",
    evergreen: 1,
  });
  const intervention = store.upsertGrowthRuleIntervention({
    accountId: "account-a",
    repository: "acme/rocket",
    category: "marketing",
    title: "Recycle contributor guide",
    action: "Draft a new angle.",
    ruleKey: `evergreen:${source.id}`,
  });
  return { source, intervention };
}

describe("Growth evergreen recycling", () => {
  it("returns one new idea and then the same duplicate without changing its source", () => {
    const { source, intervention } = eligibleIntervention();
    const first = recycleEvergreenContent("account-a", intervention.id, NOW);
    const repeated = recycleEvergreenContent("account-a", intervention.id, NOW);

    expect(first).toMatchObject({ duplicate: false, contentItem: {
      interventionId: intervention.id,
      status: "idea",
      body: "",
      media: [],
      evergreen: 0,
    } });
    expect(repeated).toEqual({ contentItem: first.contentItem, duplicate: true });
    expect(store.getContentItem("account-a", source.id)).toMatchObject({
      status: "published",
      title: "Contributor guide",
      body: "Keep this published copy.",
      evergreen: 1,
    });
  });

  it("uses one indistinguishable unavailable error for missing, foreign, and stale requests", () => {
    const { intervention } = eligibleIntervention();
    const assertions = [
      () => recycleEvergreenContent("account-a", "missing", NOW),
      () => recycleEvergreenContent("account-b", intervention.id, NOW),
      () => recycleEvergreenContent("account-a", intervention.id, new Date("2026-07-10T12:00:00.000Z")),
      () => recycleEvergreenContent("", intervention.id, NOW),
      () => recycleEvergreenContent("account-a", intervention.id, new Date("invalid")),
    ];
    for (const run of assertions) {
      expect(run).toThrow(EvergreenRecycleUnavailableError);
      expect(run).toThrow("Evergreen intervention is unavailable or no longer eligible.");
    }
  });
});
