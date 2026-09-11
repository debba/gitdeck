import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-drafter-${process.pid}-${Date.now()}`),
    aiConfigured: false,
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
  GrowthContentDraftConflictError,
  draftGrowthContentItem,
} = await import("../../src/server/growth/drafter");
const store = await import("../../src/server/growth/store");
const { AiRequestError } = await import("../../src/server/ai/client");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

function signals(repository = "acme/rocket") {
  return {
    generatedOn: "2026-09-04",
    repository,
    repositoryMetadata: {
      nameWithOwner: repository,
      name: "rocket",
      owner: { login: "acme" },
      description: "A verified deployment dashboard",
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
    readme: { excerpt: "Verified README guidance", mediaUrls: ["https://cdn.example.com/readme.png"] },
    additionalSources: [{
      type: "website",
      url: "https://project.example/releases",
      excerpt: "Verified project release notes",
      mediaUrls: ["https://project.example/release.mp4"],
    }],
    recentCommits: [],
    starHistory: [],
    goals: [],
  };
}

function profileInput() {
  return {
    language: "en",
    voice: "Direct and practical",
    audience: "Open-source maintainers",
    channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product", weight: 100, description: "Product evidence" }],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "UTC",
    postingWindows: [],
    color: "#2563EB",
  };
}

function insertAsset(accountId = "account-a", repository = "acme/rocket") {
  store.ensureGrowthSchema();
  getDatabase().prepare(`
    INSERT INTO growth_assets
      (id, account_id, repository, kind, origin, path, url, title, alt, width, height, card_template, card_data, created_at)
    VALUES (?, ?, ?, 'image', 'upload', ?, NULL, 'Dashboard', 'Rocket deployment dashboard', 1200, 630, NULL, NULL, ?)
  `).run(accountId === "account-a" ? "asset-1" : `asset-${accountId}`, accountId, repository, "rocket/dashboard.png", "2026-09-04T00:00:00.000Z");
}

function createIdea(format: "x-thread" | "linkedin-post" | "mastodon-post" = "x-thread") {
  const channel = format === "x-thread" ? "x" : format === "linkedin-post" ? "linkedin" : "mastodon";
  return store.createContentItem({
    accountId: "account-a",
    repository: "acme/rocket",
    channel,
    format,
    angle: "Explain the verified v2 release",
    pillar: "product",
    summary: "Try the repository and share feedback",
    sources: ["https://github.com/acme/rocket/releases/v2"],
    status: "idea",
    scheduledFor: "2026-09-07T10:00:00.000Z",
  });
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
  state.aiConfigured = false;
  state.collectSignals.mockReset();
  state.collectSignals.mockResolvedValue(signals());
  state.generateStructured.mockReset();
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("Growth content drafter", () => {
  it("creates deterministic evidence-grounded fallback copy and uses an account-scoped asset", async () => {
    store.upsertGrowthProfile("account-a", "acme/rocket", profileInput());
    insertAsset();
    insertAsset("account-b");
    const idea = createIdea();

    const result = await draftGrowthContentItem("account-a", idea.id);

    expect(result).toMatchObject({
      aiEnabled: false,
      usedFallback: true,
      cached: false,
      mediaRequired: false,
      contentItem: {
        id: idea.id,
        status: "draft",
        scheduledFor: idea.scheduledFor,
        media: [{ assetId: "asset-1", kind: "image", alt: "Rocket deployment dashboard" }],
      },
    });
    expect(result?.contentItem.body).toContain("A verified deployment dashboard");
    expect(result?.contentItem.threadPosts).toHaveLength(5);
    expect(state.generateStructured).not.toHaveBeenCalled();
    expect(store.listGrowthAssets("account-a", "acme/rocket")).toHaveLength(1);
    expect(store.listGrowthAssets("account-a", "acme/other")).toEqual([]);
  });

  it("surfaces the media requirement when no verified candidate exists", async () => {
    state.collectSignals.mockResolvedValueOnce({ ...signals(), readme: { excerpt: "Verified README", mediaUrls: [] }, additionalSources: [] });
    const result = await draftGrowthContentItem("account-a", createIdea("linkedin-post").id);
    expect(result).toMatchObject({ mediaRequired: true, contentItem: { status: "draft", media: [] } });
  });

  it("normalizes one AI answer, enforces source and media allowlists, and sends profile context", async () => {
    state.aiConfigured = true;
    store.upsertGrowthProfile("account-a", "acme/rocket", profileInput());
    const idea = createIdea("linkedin-post");
    state.generateStructured.mockResolvedValueOnce({
      provider: "test",
      model: "test",
      data: {
        title: "Rocket v2, grounded in the repository",
        body: "The repository lists Release v2. Review the implementation and share feedback. #opensource",
        threadPosts: [],
        sources: ["https://evil.example/invented", "https://github.com/acme/rocket/releases/v2"],
        media: [
          { url: "https://evil.example/fake.png", alt: "Fake" },
          { candidateKey: "url:https://project.example/release.mp4", alt: "Release v2 demo", caption: "Project demo" },
        ],
      },
    });

    const result = await draftGrowthContentItem("account-a", idea.id);

    expect(state.generateStructured).toHaveBeenCalledTimes(1);
    const requestInput = JSON.parse(state.generateStructured.mock.calls[0][0].input) as Record<string, any>;
    expect(requestInput.verifiedSignals).toMatchObject({
      slot: { angle: idea.angle, pillar: "product", cta: idea.summary },
      profile: { voice: "Direct and practical", audience: "Open-source maintainers", language: "en", avoid: "Hype" },
    });
    expect(result?.contentItem.sources).toEqual(["https://github.com/acme/rocket/releases/v2"]);
    expect(result?.contentItem.media).toEqual([{
      url: "https://project.example/release.mp4",
      kind: "video",
      alt: "Release v2 demo",
      caption: "Project demo",
    }]);
    expect(result).toMatchObject({ aiEnabled: true, usedFallback: false, mediaRequired: false });
  });

  it("rejects platform-invalid AI output without changing the idea", async () => {
    state.aiConfigured = true;
    const idea = createIdea("mastodon-post");
    state.generateStructured.mockResolvedValueOnce({
      provider: "test",
      model: "test",
      data: { title: "Invalid", body: "x".repeat(501), threadPosts: [], sources: [], media: [] },
    });

    await expect(draftGrowthContentItem("account-a", idea.id)).rejects.toBeInstanceOf(AiRequestError);
    expect(store.getContentItem("account-a", idea.id)).toEqual(idea);
  });

  it.each(["ready", "scheduled", "published", "skipped"] as const)(
    "rejects the protected %s status before collecting signals",
    async (status) => {
      const item = store.createContentItem({
        accountId: "account-a",
        repository: "acme/rocket",
        channel: "linkedin",
        format: "linkedin-post",
        status,
        scheduledFor: status === "scheduled" ? "2026-09-07T10:00:00.000Z" : null,
        media: status === "skipped" ? [] : [{ kind: "image", url: "https://example.com/card.png", alt: "Release card" }],
      });

      await expect(draftGrowthContentItem("account-a", item.id, { refresh: true }))
        .rejects.toBeInstanceOf(GrowthContentDraftConflictError);
      expect(state.collectSignals).not.toHaveBeenCalled();
      expect(store.getContentItem("account-a", item.id)?.status).toBe(status);
    },
  );

  it("caches populated drafts and refreshes editable content in place", async () => {
    state.aiConfigured = true;
    const idea = createIdea("linkedin-post");
    state.generateStructured.mockResolvedValue({
      provider: "test",
      model: "test",
      data: { title: "First title", body: "Verified repository update.", threadPosts: [], sources: [], media: [] },
    });
    const first = await draftGrowthContentItem("account-a", idea.id);
    const cached = await draftGrowthContentItem("account-a", idea.id);
    expect(cached).toMatchObject({ cached: true, contentItem: { id: idea.id, title: "First title" } });
    expect(state.generateStructured).toHaveBeenCalledTimes(1);

    state.generateStructured.mockResolvedValueOnce({
      provider: "test",
      model: "test",
      data: { title: "Refreshed title", body: "Refreshed verified update.", threadPosts: [], sources: [], media: [] },
    });
    const refreshed = await draftGrowthContentItem("account-a", idea.id, { refresh: true });
    expect(refreshed).toMatchObject({ cached: false, contentItem: { id: idea.id, title: "Refreshed title" } });
    expect(state.generateStructured).toHaveBeenCalledTimes(2);
    expect(await draftGrowthContentItem("account-b", idea.id)).toBeNull();
  });
});
