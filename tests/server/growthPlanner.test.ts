import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-planner-${process.pid}-${Date.now()}`),
    aiConfigured: true,
    generateStructured: vi.fn(),
    collectSignals: vi.fn(),
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
vi.mock("../../src/server/growth/signals", () => ({
  collectRepositorySignals: state.collectSignals,
}));

const {
  GROWTH_PLANNER_GENERATION_VERSION,
  generateGrowthContentPlan,
  generateMultipleGrowthContentPlans,
  regenerateGrowthContentPlan,
} = await import("../../src/server/growth/planner");
const store = await import("../../src/server/growth/store");
const { AiRequestError } = await import("../../src/server/ai/client");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

function profileInput() {
  return {
    language: "en",
    voice: "Direct",
    audience: "Maintainers",
    channels: { x: true, linkedin: false, mastodon: false, bluesky: false, discussion: false, blog: false },
    cadence: { x: 2, linkedin: 0, mastodon: 0, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [
      { id: "product", label: "Product", weight: 70, description: "Outcomes" },
      { id: "community", label: "Community", weight: 30, description: "Contributors" },
    ],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "UTC",
    postingWindows: [{ weekday: 1, hour: 10 }, { weekday: 5, hour: 14 }],
    color: "#2563EB",
  };
}

function signals(repository = "acme/rocket") {
  return {
    generatedOn: "2026-09-04",
    repository,
    repositoryMetadata: {
      nameWithOwner: repository,
      name: "rocket",
      owner: { login: "acme" },
      description: "A verified repository description",
      stargazerCount: 42,
      forkCount: 7,
      primaryLanguage: { name: "TypeScript" },
      updatedAt: "2026-09-04T00:00:00Z",
      pushedAt: "2026-09-04T00:00:00Z",
      visibility: "PUBLIC",
      isPrivate: false,
      isArchived: false,
      isFork: false,
      url: `https://github.com/${repository}`,
    },
    openIssues: [],
    openPullRequests: [],
    releases: [{ name: "Release v2", html_url: `https://github.com/${repository}/releases/v2` }],
    readme: { excerpt: "Verified README", mediaUrls: [] },
    additionalSources: [],
    recentCommits: [],
    starHistory: [],
    goals: [],
  };
}

function saveProfile(accountId = "account-a", repository = "acme/rocket") {
  return store.upsertGrowthProfile(accountId, repository, profileInput());
}

function addMeasuredHistory(
  accountId: string,
  repository: string,
  pillar: string,
  score: number,
  index: number,
) {
  const item = store.createContentItem({
    accountId,
    repository,
    channel: "x",
    format: "x-thread",
    pillar,
    status: "published",
    publishedAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    media: [{ kind: "image", url: "https://example.com/history.png", alt: "History" }],
  });
  store.upsertContentPerformance(accountId, {
    contentId: item.id,
    window: "7d",
    measuredAt: "2026-09-15T00:00:00.000Z",
    metrics: { starsDelta: score, forksDelta: 0 },
  });
  return item;
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.aiConfigured = true;
  state.collectSignals.mockReset();
  state.collectSignals.mockResolvedValue(signals());
  state.generateStructured.mockReset();
  state.generateStructured.mockImplementation(async (request: { input: string }) => {
    const input = JSON.parse(request.input) as { slots: Array<{ key: string; pillarId: string }> };
    return {
      provider: "test",
      model: "test",
      data: {
        assignments: input.slots.map((slot, index) => ({
          slotKey: slot.key,
          pillarId: index === 0 ? "community" : slot.pillarId,
          angle: `Verified angle ${index + 1}`,
          sources: [`https://github.com/acme/rocket/releases/v2`],
          cta: `Try action ${index + 1}`,
        })),
      },
    };
  });
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth editorial planner", () => {
  it("collects evidence once, makes one structured call, normalizes, and persists every slot", async () => {
    saveProfile();

    const result = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });

    expect(state.collectSignals).toHaveBeenCalledTimes(1);
    expect(state.collectSignals).toHaveBeenCalledWith("account-a", "acme/rocket");
    expect(state.generateStructured).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      aiEnabled: true,
      usedFallback: false,
      weightsAdjusted: false,
      plan: { status: "active" },
    });
    expect(result.contentItems).toHaveLength(2);
    expect(result.contentItems[0]).toMatchObject({
      planId: result.plan.id,
      accountId: "account-a",
      repository: "acme/rocket",
      channel: "x",
      format: "x-thread",
      pillar: "community",
      angle: "Verified angle 1",
      title: "",
      summary: "Try action 1",
      body: "",
      threadPosts: [],
      media: [],
      status: "idea",
      generationVersion: GROWTH_PLANNER_GENERATION_VERSION,
    });
    expect(result.contentItems[0].scheduledFor).toBe("2026-09-07T10:00:00.000Z");
    expect(store.getContentPlan("account-a", result.plan.id)).toEqual(result.plan);
  });

  it("uses deterministic evidence-grounded assignments when AI is unavailable or unusable", async () => {
    saveProfile();
    state.aiConfigured = false;
    const first = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    store.archiveContentPlan("account-a", first.plan.id);
    const second = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });

    expect(first.usedFallback).toBe(true);
    expect(second.usedFallback).toBe(true);
    expect(state.generateStructured).not.toHaveBeenCalled();
    expect(first.contentItems.map(({ pillar, angle, summary, sources, scheduledFor }) => ({
      pillar, angle, summary, sources, scheduledFor,
    }))).toEqual(second.contentItems.map(({ pillar, angle, summary, sources, scheduledFor }) => ({
      pillar, angle, summary, sources, scheduledFor,
    })));
    expect(first.contentItems[0].angle).toContain("verified repository description");

    store.archiveContentPlan("account-a", second.plan.id);
    state.aiConfigured = true;
    state.generateStructured.mockResolvedValueOnce({ provider: "test", model: "test", data: { assignments: [{ slotKey: "unknown" }] } });
    const malformed = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(malformed.usedFallback).toBe(true);
    expect(malformed.contentItems).toHaveLength(2);
  });

  it("uses eligible performance only for the plan snapshot and weighted slot distribution", async () => {
    const configured = profileInput();
    configured.cadence.x = 10;
    configured.pillars = [
      { id: "product", label: "Product", weight: 50, description: "Outcomes" },
      { id: "community", label: "Community", weight: 50, description: "Contributors" },
    ];
    const savedProfile = store.upsertGrowthProfile("account-a", "acme/rocket", configured);
    addMeasuredHistory("account-a", "acme/rocket", "product", 10, 0);
    addMeasuredHistory("account-a", "acme/rocket", "product", 10, 1);
    addMeasuredHistory("account-a", "acme/rocket", "community", 0, 2);
    addMeasuredHistory("account-b", "acme/rocket", "community", 100_000, 3);
    addMeasuredHistory("account-a", "acme/other", "community", 100_000, 4);
    state.aiConfigured = false;

    const result = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-10-05",
      periodEnd: "2026-10-11",
    });

    expect(result.weightsAdjusted).toBe(true);
    expect(result.plan.pillars.map(({ id, weight }) => ({ id, weight }))).toEqual([
      { id: "product", weight: 58 },
      { id: "community", weight: 42 },
    ]);
    expect(result.contentItems.reduce<Record<string, number>>((counts, item) => {
      counts[item.pillar] = (counts[item.pillar] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ product: 6, community: 4 });
    const ready = store.createContentItem({
      accountId: "account-a",
      repository: "acme/rocket",
      planId: result.plan.id,
      channel: "x",
      format: "x-thread",
      status: "ready",
      media: [{ kind: "image", url: "https://example.com/ready.png", alt: "Ready" }],
    });
    const regenerated = await regenerateGrowthContentPlan("account-a", result.plan.id);
    expect(regenerated).toMatchObject({
      weightsAdjusted: true,
      plan: { pillars: [{ weight: 58 }, { weight: 42 }] },
    });
    expect(store.getContentItem("account-a", ready.id)?.status).toBe("ready");
    expect(store.getGrowthProfile("account-a", "acme/rocket")).toEqual(savedProfile);
  });

  it("does not persist configured-provider failures or partial database writes", async () => {
    saveProfile();
    state.generateStructured.mockRejectedValueOnce(new AiRequestError("provider failed"));
    await expect(generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).rejects.toThrow("provider failed");
    expect(store.listContentPlans("account-a", "acme/rocket")).toEqual([]);
    expect(store.listContentItems("account-a", { repository: "acme/rocket" })).toEqual([]);

    state.aiConfigured = false;
    store.ensureGrowthSchema();
    getDatabase().exec(`
      CREATE TRIGGER fail_planner_items BEFORE INSERT ON content_items
      BEGIN SELECT RAISE(ABORT, 'forced content failure'); END;
    `);
    await expect(generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).rejects.toThrow("forced content failure");
    expect(store.listContentPlans("account-a", "acme/rocket")).toEqual([]);
    expect(store.listContentItems("account-a", { repository: "acme/rocket" })).toEqual([]);
  });

  it("regenerates atomically and skips only editable source items", async () => {
    saveProfile();
    state.aiConfigured = false;
    const source = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    const draft = store.createContentItem({
      accountId: "account-a",
      repository: "acme/rocket",
      planId: source.plan.id,
      channel: "x",
      format: "x-thread",
      status: "draft",
    });
    const media = [{ kind: "image" as const, url: "https://example.com/card.png", alt: "Card" }];
    const protectedItems = [
      store.createContentItem({ accountId: "account-a", repository: "acme/rocket", planId: source.plan.id, channel: "x", format: "x-thread", status: "ready", media }),
      store.createContentItem({ accountId: "account-a", repository: "acme/rocket", planId: source.plan.id, channel: "x", format: "x-thread", status: "scheduled", scheduledFor: "2026-09-12T10:00:00.000Z", media }),
      store.createContentItem({ accountId: "account-a", repository: "acme/rocket", planId: source.plan.id, channel: "x", format: "x-thread", status: "published", media }),
      store.createContentItem({ accountId: "account-a", repository: "acme/rocket", planId: source.plan.id, channel: "x", format: "x-thread", status: "skipped" }),
    ];

    store.ensureGrowthSchema();
    getDatabase().exec(`
      CREATE TRIGGER fail_replacement_items BEFORE INSERT ON content_items
      BEGIN SELECT RAISE(ABORT, 'forced replacement failure'); END;
    `);
    await expect(regenerateGrowthContentPlan("account-a", source.plan.id))
      .rejects.toThrow("forced replacement failure");
    expect(store.getContentPlan("account-a", source.plan.id)?.status).toBe("active");
    expect(store.getContentItem("account-a", draft.id)?.status).toBe("draft");
    expect(store.listContentPlans("account-a", "acme/rocket")).toHaveLength(1);

    getDatabase().exec("DROP TRIGGER fail_replacement_items");
    const result = await regenerateGrowthContentPlan("account-a", source.plan.id);
    expect(result).toMatchObject({
      sourcePlan: { id: source.plan.id, status: "archived" },
      plan: { status: "active", repository: "acme/rocket" },
      usedFallback: true,
      weightsAdjusted: false,
    });
    expect(result?.affectedContentItems.map(({ id }) => id)).toEqual([
      source.contentItems[0].id,
      source.contentItems[1].id,
      draft.id,
    ]);
    expect(result?.affectedContentItems.every(({ status }) => status === "skipped")).toBe(true);
    expect(protectedItems.map(({ id }) => store.getContentItem("account-a", id)?.status))
      .toEqual(["ready", "scheduled", "published", "skipped"]);
    expect(store.listContentPlans("account-a", "acme/rocket")).toHaveLength(2);
  });

  it("deconflicts and atomically creates plans in stable repository order with one assignment call each", async () => {
    const compact = profileInput();
    compact.cadence.x = 1;
    compact.postingWindows = [{ weekday: 1, hour: 10 }];
    store.upsertGrowthProfile("account-a", "zeta/repo", compact);
    store.upsertGrowthProfile("account-a", "alpha/repo", compact);
    state.collectSignals.mockImplementation(async (_accountId: string, repository: string) => signals(repository));

    const result = await generateMultipleGrowthContentPlans("account-a", {
      repositories: ["zeta/repo", "alpha/repo"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });

    expect(result.plans.map(({ plan }) => plan.repository)).toEqual(["alpha/repo", "zeta/repo"]);
    expect(result.plans.map(({ contentItems }) => contentItems[0].scheduledFor)).toEqual([
      "2026-09-07T10:00:00.000Z",
      "2026-09-08T10:00:00.000Z",
    ]);
    expect(result.plans.map(({ contentItems }) => contentItems[0].pillar)).toEqual([
      "product",
      "product",
    ]);
    expect(result).toMatchObject({ deconflictedItemCount: 1, remainingCollisionCount: 0 });
    expect(state.collectSignals.mock.calls.map(([, repository]) => repository))
      .toEqual(["alpha/repo", "zeta/repo"]);
    expect(state.generateStructured).toHaveBeenCalledTimes(2);
    expect(result.plans.every(({ aiEnabled, usedFallback, weightsAdjusted }) => (
      aiEnabled && !usedFallback && !weightsAdjusted
    ))).toBe(true);
  });

  it("uses per-repository fallback and leaves no partial multi-plan writes on failures", async () => {
    const compact = profileInput();
    compact.cadence.x = 1;
    saveProfile("account-a", "alpha/repo");
    store.upsertGrowthProfile("account-a", "zeta/repo", compact);
    state.collectSignals.mockImplementation(async (_accountId: string, repository: string) => signals(repository));
    state.generateStructured
      .mockResolvedValueOnce({ provider: "test", model: "test", data: { assignments: [] } })
      .mockRejectedValueOnce(new AiRequestError("second repository failed"));

    await expect(generateMultipleGrowthContentPlans("account-a", {
      repositories: ["zeta/repo", "alpha/repo"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).rejects.toThrow("second repository failed");
    expect(store.listContentPlans("account-a")).toEqual([]);
    expect(store.listContentItems("account-a")).toEqual([]);

    state.aiConfigured = false;
    const fallback = await generateMultipleGrowthContentPlans("account-a", {
      repositories: ["zeta/repo", "alpha/repo"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    expect(fallback.plans.every(({ usedFallback }) => usedFallback)).toBe(true);
    expect(state.generateStructured).toHaveBeenCalledTimes(2);
  });

  it("preflights every multi-plan overlap and rolls back the complete set on a store failure", async () => {
    const compact = profileInput();
    compact.cadence.x = 1;
    store.upsertGrowthProfile("account-a", "alpha/repo", compact);
    store.upsertGrowthProfile("account-a", "zeta/repo", compact);
    state.aiConfigured = false;
    store.createContentPlan({
      accountId: "account-a",
      repository: "zeta/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
      cadence: compact.cadence,
      pillars: compact.pillars,
      status: "active",
    });

    await expect(generateMultipleGrowthContentPlans("account-a", {
      repositories: ["alpha/repo", "zeta/repo"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).rejects.toBeInstanceOf(store.ActivePlanOverlapError);
    expect(state.collectSignals).not.toHaveBeenCalled();
    expect(store.listContentPlans("account-a", "alpha/repo")).toEqual([]);

    store.archiveContentPlan("account-a", store.listContentPlans("account-a", "zeta/repo")[0].id);
    store.ensureGrowthSchema();
    getDatabase().exec(`
      CREATE TRIGGER fail_zeta_multi BEFORE INSERT ON content_items
      WHEN NEW.repository = 'zeta/repo'
      BEGIN SELECT RAISE(ABORT, 'forced multi failure'); END;
    `);
    await expect(generateMultipleGrowthContentPlans("account-a", {
      repositories: ["alpha/repo", "zeta/repo"],
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).rejects.toThrow("forced multi failure");
    expect(store.listContentPlans("account-a", "alpha/repo")).toEqual([]);
    expect(store.listContentPlans("account-a", "zeta/repo")).toHaveLength(1);
  });

  it("rejects overlapping active plans per account and lists plans in descending period order", async () => {
    saveProfile();
    state.aiConfigured = false;
    const early = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    });
    await expect(generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-20",
    })).rejects.toBeInstanceOf(store.ActivePlanOverlapError);

    const late = await generateGrowthContentPlan("account-a", {
      repository: "acme/rocket",
      periodStart: "2026-09-21",
      periodEnd: "2026-09-27",
    });
    expect(store.listContentPlans("account-a", "acme/rocket").map(({ id }) => id))
      .toEqual([late.plan.id, early.plan.id]);
    expect(store.listContentPlans("account-b", "acme/rocket")).toEqual([]);

    saveProfile("account-b");
    await expect(generateGrowthContentPlan("account-b", {
      repository: "acme/rocket",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
    })).resolves.toMatchObject({ plan: { accountId: "account-b" } });
  });
});
