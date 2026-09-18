import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-rules-${process.pid}-${Date.now()}`),
    collectSignals: vi.fn(),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));
vi.mock("../../src/server/growth/signals", () => ({
  collectRepositorySignals: state.collectSignals,
}));

const store = await import("../../src/server/growth/store");
const { scanRepositoryGrowthOpportunities } = await import("../../src/server/growth/rules");
const { closeDatabase } = await import("../../src/server/sqlite");

const NOW = new Date("2026-09-10T12:00:00.000Z");

function signals(name = "Rocket 1.0") {
  return {
    generatedOn: "2026-09-10",
    repository: "acme/rocket",
    repositoryMetadata: null,
    openIssues: [],
    openPullRequests: [],
    mergedPullRequests: [],
    releases: [{
      name,
      tag_name: "v1.0.0",
      html_url: "https://github.com/acme/rocket/releases/tag/v1.0.0",
      published_at: "2026-09-06T12:00:00.000Z",
    }],
    readme: null,
    additionalSources: [],
    recentCommits: [],
    starHistory: [],
    goals: [],
  };
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.collectSignals.mockReset();
  state.collectSignals.mockResolvedValue(signals());
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth opportunity scanning", () => {
  it("collects server signals and persists the complete detected rule set", async () => {
    const result = await scanRepositoryGrowthOpportunities("account-a", "acme/rocket", NOW);

    expect(state.collectSignals).toHaveBeenCalledWith("account-a", "acme/rocket");
    expect(result.scannedAt).toBe(NOW.toISOString());
    expect(result.interventions).toEqual([
      expect.objectContaining({
        accountId: "account-a",
        repository: "acme/rocket",
        origin: "rule",
        ruleKey: "release:v1.0.0",
        status: "proposed",
      }),
    ]);
  });

  it("upserts by account, repository, and rule key while preserving status", async () => {
    const first = await scanRepositoryGrowthOpportunities("account-a", "acme/rocket", NOW);
    const id = first.interventions[0].id;
    store.updateGrowthInterventionStatus("account-a", id, "dismissed");
    state.collectSignals.mockResolvedValue(signals("Rocket 1.0 updated"));

    const repeated = await scanRepositoryGrowthOpportunities("account-a", "acme/rocket", NOW);
    expect(repeated.interventions[0]).toMatchObject({
      id,
      status: "dismissed",
      action: expect.stringContaining("Rocket 1.0 updated"),
    });
    expect(store.listGrowthInterventions("account-a", { repository: "acme/rocket" })).toHaveLength(1);

    const otherAccount = await scanRepositoryGrowthOpportunities("account-b", "acme/rocket", NOW);
    expect(otherAccount.interventions[0].id).not.toBe(id);
    expect(store.listGrowthInterventions("account-b", { repository: "acme/rocket" })).toHaveLength(1);
  });

  it("never mutates a non-rule row with a colliding rule key", async () => {
    const manual = store.createGrowthIntervention({
      accountId: "account-a",
      repository: "acme/rocket",
      category: "product",
      title: "Keep this manual action",
      action: "Do not change this copy.",
      origin: "manual",
      ruleKey: "release:v1.0.0",
      dedupeKey: "manual-collision",
      status: "accepted",
    });

    const result = await scanRepositoryGrowthOpportunities("account-a", "acme/rocket", NOW);
    expect(result.interventions[0].id).not.toBe(manual.id);
    expect(store.getGrowthIntervention("account-a", manual.id)).toEqual(manual);
  });

  it("uses only content from the scanned account and repository for suppression", async () => {
    store.createContentItem({
      accountId: "account-b",
      repository: "acme/rocket",
      channel: "x",
      format: "x-thread",
      status: "published",
      media: [{ kind: "image", url: "https://example.com/card.png", alt: "Card" }],
      sources: ["https://github.com/acme/rocket/releases/tag/v1.0.0"],
    });
    store.createContentItem({
      accountId: "account-a",
      repository: "acme/other",
      channel: "x",
      format: "x-thread",
      status: "published",
      media: [{ kind: "image", url: "https://example.com/card.png", alt: "Card" }],
      sources: ["https://github.com/acme/rocket/releases/tag/v1.0.0"],
    });
    expect((await scanRepositoryGrowthOpportunities("account-a", "acme/rocket", NOW)).interventions).toHaveLength(1);

    store.createContentItem({
      accountId: "account-a",
      repository: "acme/rocket",
      channel: "x",
      format: "x-thread",
      status: "published",
      media: [{ kind: "image", url: "https://example.com/card.png", alt: "Card" }],
      sources: ["https://github.com/acme/rocket/releases/tag/v1.0.0"],
    });
    expect((await scanRepositoryGrowthOpportunities("account-a", "acme/rocket", NOW)).interventions).toEqual([]);
  });
});
