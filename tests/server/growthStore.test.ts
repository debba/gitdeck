import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import type { GrowthContentMedia, GrowthProfileInput } from "../../src/types/growth";
import type { GoalSuggestion } from "../../src/types/goals";

const { TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return { TMP_DIR: resolve(tmpdir(), `gitdeck-growth-store-${process.pid}-${Date.now()}`) };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: TMP_DIR }));

const store = await import("../../src/server/growth/store");
const growthSettings = await import("../../src/server/growth/settings");
const goalStore = await import("../../src/server/goalStore");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

const MEDIA: GrowthContentMedia[] = [
  { kind: "image", url: "https://example.com/card.png", alt: "Release card" },
];

function profileInput(overrides: Partial<GrowthProfileInput> = {}): GrowthProfileInput {
  return {
    language: "en",
    voice: "Practical and direct",
    audience: "Open-source maintainers",
    channels: {
      x: true,
      linkedin: true,
      mastodon: true,
      bluesky: false,
      discussion: false,
      blog: false,
    },
    cadence: {
      x: 3,
      linkedin: 1,
      mastodon: 3,
      bluesky: 0,
      discussion: 0,
      blog: 0,
    },
    pillars: [
      { id: "product", label: "Product", weight: 100, description: "Product outcomes" },
    ],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 10 }],
    color: "#2563EB",
    ...overrides,
  };
}

function createDraft(accountId = "account-a", repository = "owner/repo") {
  return store.createContentItem({
    accountId,
    repository,
    channel: "x",
    format: "x-thread",
    status: "draft",
    title: "Release thread",
  });
}

describe("Growth Studio store", () => {
  beforeEach(async () => {
    closeDatabase();
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    closeDatabase();
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it("creates the complete schema idempotently and returns non-persisted profile defaults", () => {
    store.ensureGrowthSchema();
    store.ensureGrowthSchema();

    const tables = getDatabase().prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual([
      "content_items",
      "content_performance",
      "content_plans",
      "growth_assets",
      "growth_interventions",
      "growth_profiles",
    ]);

    const profile = store.getGrowthProfile("account-a", "owner/repo");
    expect(profile).toMatchObject({
      accountId: "account-a",
      repository: "owner/repo",
      language: "en",
      voice: "",
      audience: "",
      timezone: "UTC",
      channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
      cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
      hashtags: [],
      avoid: "",
      postingWindows: [],
    });
    expect(profile.pillars).toHaveLength(5);
    expect(profile.pillars.every(({ weight }) => weight === 20)).toBe(true);
    expect(profile.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(store.getGrowthProfile("account-b", "owner/repo").color).toBe(profile.color);

    const count = getDatabase().prepare("SELECT COUNT(*) AS count FROM growth_profiles").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("upserts profiles with decoded JSON fields and account scoping", () => {
    const saved = store.upsertGrowthProfile("account-a", "owner/repo", profileInput());
    expect(saved.voice).toBe("Practical and direct");
    expect(saved.pillars).toEqual([
      { id: "product", label: "Product", weight: 100, description: "Product outcomes" },
    ]);
    expect(saved.postingWindows).toEqual([{ weekday: 1, hour: 10 }]);
    expect(saved.updatedAt).not.toBe("");

    const updated = store.upsertGrowthProfile(
      "account-a",
      "owner/repo",
      profileInput({ voice: "Technical", hashtags: ["#gitdeck"] }),
    );
    expect(updated.voice).toBe("Technical");
    expect(updated.hashtags).toEqual(["#gitdeck"]);
    expect(store.getGrowthProfile("account-b", "owner/repo").voice).toBe("");
  });

  it("inherits account settings only for unpersisted profiles and preserves defensive isolation", () => {
    const persisted = store.upsertGrowthProfile("account-a", "owner/saved", profileInput());
    growthSettings.saveGrowthSettings("account-a", {
      timezone: "America/New_York",
      cadence: { x: 6, linkedin: 2, mastodon: 1, bluesky: 0, discussion: 0, blog: 0 },
      pillars: [{ id: "community", label: "Community", weight: 100, description: "Participation" }],
    });

    const inherited = store.getGrowthProfile("account-a", "owner/new");
    expect(inherited).toMatchObject({
      timezone: "America/New_York",
      cadence: { x: 6, linkedin: 2, mastodon: 1 },
      pillars: [{ id: "community", label: "Community", weight: 100, description: "Participation" }],
      language: "en",
      voice: "",
      audience: "",
      hashtags: [],
      avoid: "",
      postingWindows: [],
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(store.getGrowthProfile("account-a", "owner/saved")).toEqual(persisted);
    expect(store.getGrowthProfile("account-b", "owner/new").timezone).toBe("UTC");

    inherited.cadence.x = 0;
    inherited.pillars[0].label = "Changed";
    expect(store.getGrowthProfile("account-a", "owner/new").cadence.x).toBe(6);
    expect(store.getGrowthProfile("account-a", "owner/new").pillars[0].label).toBe("Community");
    expect((getDatabase().prepare("SELECT COUNT(*) AS count FROM growth_profiles").get() as { count: number }).count).toBe(1);

    growthSettings.resetGrowthSettings("account-a");
    expect(store.getGrowthProfile("account-a", "owner/new")).toMatchObject({
      timezone: "UTC",
      cadence: { x: 3, linkedin: 1, mastodon: 3 },
    });
    expect(store.getGrowthProfile("account-a", "owner/saved")).toEqual(persisted);
  });

  it("returns effective workspace colours for persisted, default, and account-isolated profiles", () => {
    store.upsertGrowthProfile("account-a", "owner/profile-only", profileInput({ color: "#BE123C" }));
    store.upsertGrowthProfile("account-b", "owner/shared", profileInput({ color: "#ABCDEF" }));

    const profileOnly = store.getGrowthWorkspaceSummary("account-a", "owner/profile-only");
    const goalOnly = store.getGrowthWorkspaceSummary("account-a", "owner/goal-only");
    const isolated = store.getGrowthWorkspaceSummary("account-a", "owner/shared");

    expect(profileOnly).toMatchObject({ repository: "owner/profile-only", color: "#BE123C" });
    expect(goalOnly.color).toBe(store.getGrowthProfile("account-a", "owner/goal-only").color);
    expect(isolated.color).toBe(store.getGrowthProfile("account-a", "owner/shared").color);
    expect(isolated.color).not.toBe("#ABCDEF");
    expect(store.listPersistedGrowthProfileRepositories("account-a")).toEqual(["owner/profile-only"]);
  });

  it("creates, lists, and updates interventions without crossing accounts", () => {
    const intervention = store.createGrowthIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      goalId: "goal-1",
      category: "marketing",
      title: "Share the release",
      action: "Publish a release thread.",
      origin: "manual",
      dedupeKey: "owner/repo:goal-1:share-release",
    });
    store.createGrowthIntervention({
      accountId: "account-a",
      repository: "owner/other",
      category: "community",
      title: "Welcome contributors",
      action: "Thank first-time contributors.",
      origin: "rule",
      ruleKey: "new-contributors",
      dedupeKey: "owner/other:new-contributors",
      status: "accepted",
    });

    expect(store.listGrowthInterventions("account-a", { repository: "owner/repo" })).toEqual([intervention]);
    expect(store.listGrowthInterventions("account-a", { goalId: "goal-1" })).toHaveLength(1);
    expect(store.listGrowthInterventions("account-a", { goalId: null })).toHaveLength(1);
    expect(store.listGrowthInterventions("account-b")).toEqual([]);
    expect(store.updateGrowthInterventionStatus("account-b", intervention.id, "done")).toBeNull();

    const accepted = store.updateGrowthInterventionStatus("account-a", intervention.id, "accepted");
    expect(accepted?.status).toBe("accepted");
    expect(store.listGrowthInterventions("account-a", { status: "accepted" })).toHaveLength(2);
  });

  it("upserts rule interventions by stable key without crossing accounts or changing decisions", () => {
    const first = store.upsertGrowthRuleIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      category: "marketing",
      title: "Share release v1",
      action: "Publish the release follow-up.",
      ruleKey: "release:v1",
    });
    store.updateGrowthInterventionStatus("account-a", first.id, "done");
    const repeated = store.upsertGrowthRuleIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      category: "product",
      title: "Share the v1 release",
      action: "Publish updated release copy.",
      ruleKey: "release:v1",
    });
    const otherAccount = store.upsertGrowthRuleIntervention({
      accountId: "account-b",
      repository: "owner/repo",
      category: "marketing",
      title: "Share release v1",
      action: "Publish the release follow-up.",
      ruleKey: "release:v1",
    });

    expect(repeated).toMatchObject({
      id: first.id,
      status: "done",
      origin: "rule",
      category: "product",
      action: "Publish updated release copy.",
    });
    expect(otherAccount.id).not.toBe(first.id);
    expect(store.listGrowthInterventions("account-a", { repository: "owner/repo" })).toHaveLength(1);
    expect(store.listGrowthInterventions("account-b", { repository: "owner/repo" })).toHaveLength(1);
  });

  it("atomically recycles an eligible rule source into one blank linked idea", () => {
    const source = store.createContentItem({
      accountId: "account-a",
      repository: "owner/repo",
      planId: null,
      goalIds: ["goal-1"],
      channel: "linkedin",
      format: "linkedin-post",
      pillar: "education",
      angle: "Original angle",
      title: "Evergreen guide",
      summary: "Original summary",
      body: "Original body",
      media: MEDIA,
      sources: ["https://example.com/guide"],
      status: "published",
      publishedAt: "2026-07-01T00:00:00.000Z",
      publishedUrl: "https://social.example/guide",
      evergreen: 1,
    });
    const intervention = store.upsertGrowthRuleIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      category: "marketing",
      title: "Recycle evergreen guide",
      action: "Create a fresh angle.",
      ruleKey: `evergreen:${source.id}`,
    });
    const sourceBefore = store.getContentItem("account-a", source.id);
    const now = new Date("2026-09-10T00:00:00.000Z");

    const first = store.recycleEvergreenIntervention("account-a", intervention.id, now);
    const repeated = store.recycleEvergreenIntervention("account-a", intervention.id, now);

    expect(first).toMatchObject({ duplicate: false, contentItem: {
      repository: "owner/repo",
      planId: null,
      interventionId: intervention.id,
      goalIds: ["goal-1"],
      channel: "linkedin",
      format: "linkedin-post",
      pillar: "education",
      angle: "",
      title: "",
      summary: "",
      body: "",
      threadPosts: [],
      media: [],
      sources: ["https://example.com/guide"],
      status: "idea",
      scheduledFor: null,
      publishedAt: null,
      publishedUrl: null,
      generatedAt: null,
      evergreen: 0,
    } });
    expect(repeated).toMatchObject({ duplicate: true, contentItem: { id: first?.contentItem.id } });
    expect(store.listContentItems("account-a", { repository: "owner/repo" })).toHaveLength(2);
    expect(store.getContentItem("account-a", source.id)).toEqual(sourceBefore);
    expect(store.recycleEvergreenIntervention("account-b", intervention.id, now)).toBeNull();
  });

  it("rejects stale or unrelated interventions during evergreen recycling", () => {
    const source = store.createContentItem({
      accountId: "account-a",
      repository: "owner/repo",
      channel: "x",
      format: "x-thread",
      media: MEDIA,
      status: "published",
      publishedAt: "2026-08-01T00:00:00.000Z",
      evergreen: 1,
    });
    const stale = store.upsertGrowthRuleIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      category: "marketing",
      title: "Recycle later",
      action: "Wait until eligible.",
      ruleKey: `evergreen:${source.id}`,
    });
    const manual = store.createGrowthIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      category: "marketing",
      title: "Manual",
      action: "Do it manually.",
      origin: "manual",
      ruleKey: `evergreen:${source.id}`,
      dedupeKey: "manual-evergreen",
    });

    expect(store.recycleEvergreenIntervention(
      "account-a",
      stale.id,
      new Date("2026-09-10T00:00:00.000Z"),
    )).toBeNull();
    expect(store.recycleEvergreenIntervention(
      "account-a",
      manual.id,
      new Date("2027-01-01T00:00:00.000Z"),
    )).toBeNull();
    expect(store.listContentItems("account-a", { repository: "owner/repo" })).toEqual([source]);
  });

  it("creates, reads, and stably lists assets in one account and repository", () => {
    const first = store.createGrowthAsset({
      accountId: "account-a",
      repository: "owner/repo",
      kind: "image",
      origin: "upload",
      path: "first.png",
      title: "First image",
      alt: "First image alt",
      width: 1200,
      height: 630,
    });
    const second = store.createGrowthAsset({
      accountId: "account-a",
      repository: "owner/repo",
      kind: "video",
      origin: "website",
      url: "https://example.com/demo.webm",
      title: "Demo",
      alt: "Demo video",
    });
    store.createGrowthAsset({
      accountId: "account-a",
      repository: "owner/other",
      kind: "image",
      origin: "readme",
      url: "https://example.com/other.png",
      title: "Other",
      alt: "Other repository image",
    });
    store.createGrowthAsset({
      accountId: "account-b",
      repository: "owner/repo",
      kind: "image",
      origin: "upload",
      path: "private.png",
      title: "Private",
      alt: "Private image",
    });

    const listed = store.listGrowthAssets("account-a", "owner/repo");
    expect(listed).toHaveLength(2);
    expect(listed).toEqual([...listed].sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )));
    expect(new Set(listed.map(({ id }) => id))).toEqual(new Set([first.id, second.id]));
    expect(store.getGrowthAsset("account-a", first.id)).toEqual(first);
    expect(store.getGrowthAsset("account-b", first.id)).toBeNull();
    expect(store.listGrowthAssets("account-a", "owner/other")).toHaveLength(1);
    expect(store.listGrowthAssets("account-b", "owner/repo")).toHaveLength(1);

    const tables = getDatabase().prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'growth_assets'",
    ).get() as { count: number };
    expect(tables.count).toBe(1);
  });

  it("validates asset-backed content media against its account and repository", () => {
    const owned = store.createGrowthAsset({
      accountId: "account-a",
      repository: "owner/repo",
      kind: "image",
      origin: "upload",
      path: "owned.png",
      title: "Owned",
      alt: "Owned image",
    });
    const otherRepository = store.createGrowthAsset({
      accountId: "account-a",
      repository: "owner/other",
      kind: "image",
      origin: "upload",
      path: "other.png",
      title: "Other",
      alt: "Other image",
    });
    const otherAccount = store.createGrowthAsset({
      accountId: "account-b",
      repository: "owner/repo",
      kind: "image",
      origin: "upload",
      path: "private.png",
      title: "Private",
      alt: "Private image",
    });
    const validMedia: GrowthContentMedia[] = [{ assetId: owned.id, kind: "image", alt: "Release card" }];

    for (const assetId of ["missing", otherRepository.id, otherAccount.id]) {
      expect(() => store.createContentItem({
        accountId: "account-a",
        repository: "owner/repo",
        channel: "x",
        format: "x-thread",
        status: "draft",
        media: [{ assetId, kind: "image", alt: "Invalid asset" }],
      })).toThrowError("Media attachment is invalid.");
    }
    expect(() => store.createContentItem({
      accountId: "account-a",
      repository: "owner/repo",
      channel: "x",
      format: "x-thread",
      status: "draft",
      media: [{ assetId: owned.id, kind: "video", alt: "Wrong kind" }],
    })).toThrow(store.InvalidMediaAttachmentError);

    const draft = createDraft();
    expect(() => store.updateContentItem("account-a", draft.id, {
      media: [{ assetId: otherAccount.id, kind: "image", alt: "Private" }],
    })).toThrowError("Media attachment is invalid.");
    expect(store.getContentItem("account-a", draft.id)?.media).toEqual([]);

    const ready = store.updateContentItem("account-a", draft.id, { status: "ready", media: validMedia });
    expect(ready).toMatchObject({ status: "ready", media: validMedia });
    expect(() => store.updateContentItem("account-a", draft.id, { media: [] })).toThrow(store.MediaRequiredError);
    expect(store.getContentItem("account-a", draft.id)?.media).toEqual(validMedia);

    const scheduled = store.rescheduleContentItem("account-a", draft.id, "2026-09-08T10:00:00Z");
    expect(scheduled?.status).toBe("scheduled");
    expect(() => store.updateContentItem("account-a", draft.id, { media: [] })).toThrow(store.MediaRequiredError);

    const published = store.markContentItemPublished("account-a", draft.id);
    expect(published?.status).toBe("published");
    expect(() => store.updateContentItem("account-a", draft.id, { media: [] })).toThrow(store.MediaRequiredError);
    expect(store.updateContentItem("account-a", draft.id, { title: "Media preserved" })).toMatchObject({
      title: "Media preserved",
      media: validMedia,
    });
  });

  it("creates and archives account-scoped content plans", () => {
    const input = profileInput();
    const plan = store.createContentPlan({
      accountId: "account-a",
      repository: "owner/repo",
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
      cadence: input.cadence,
      pillars: input.pillars,
      status: "active",
    });
    expect(plan.status).toBe("active");
    expect(plan.cadence.x).toBe(3);
    expect(store.archiveContentPlan("account-b", plan.id)).toBeNull();
    expect(store.archiveContentPlan("account-a", plan.id)?.status).toBe("archived");
  });

  it("creates multiple plans in one transaction after account and overlap validation", () => {
    const input = profileInput();
    const planInput = (repository: string) => ({
      accountId: "account-a",
      repository,
      periodStart: "2026-09-07",
      periodEnd: "2026-09-13",
      cadence: input.cadence,
      pillars: input.pillars,
      status: "active" as const,
    });
    const itemInputs = [{ channel: "x" as const, format: "x-thread" as const, status: "idea" as const }];
    const created = store.createMultipleContentPlansWithItems("account-a", [
      { planInput: planInput("owner/alpha"), itemInputs },
      { planInput: planInput("owner/zeta"), itemInputs },
    ]);
    expect(created.map(({ plan }) => plan.repository)).toEqual(["owner/alpha", "owner/zeta"]);
    expect(created.every(({ plan, contentItems }) => contentItems[0].planId === plan.id)).toBe(true);

    expect(() => store.createMultipleContentPlansWithItems("account-b", [
      { planInput: planInput("owner/other"), itemInputs },
      { planInput: planInput("owner/last"), itemInputs },
    ])).toThrow("account-owned repositories");
    expect(store.listContentPlans("account-b")).toEqual([]);

    getDatabase().exec(`
      CREATE TRIGGER fail_multi_store BEFORE INSERT ON content_items
      WHEN NEW.repository = 'owner/fail'
      BEGIN SELECT RAISE(ABORT, 'forced multi store failure'); END;
    `);
    expect(() => store.createMultipleContentPlansWithItems("account-a", [
      { planInput: planInput("owner/before-fail"), itemInputs },
      { planInput: planInput("owner/fail"), itemInputs },
    ])).toThrow("forced multi store failure");
    expect(store.listContentPlans("account-a", "owner/before-fail")).toEqual([]);
    expect(store.listContentPlans("account-a", "owner/fail")).toEqual([]);
  });

  it("filters content items by account, repository, status, and scheduled date range", () => {
    store.createContentItem({
      accountId: "account-a",
      repository: "owner/repo",
      channel: "linkedin",
      format: "linkedin-post",
      status: "scheduled",
      scheduledFor: "2026-09-08T10:00:00Z",
      media: MEDIA,
      title: "Tuesday post",
    });
    const thursday = store.createContentItem({
      accountId: "account-a",
      repository: "owner/repo",
      channel: "mastodon",
      format: "mastodon-post",
      status: "scheduled",
      scheduledFor: "2026-09-10T10:00:00Z",
      media: MEDIA,
      title: "Thursday post",
    });
    createDraft("account-a", "owner/repo");
    store.createContentItem({
      accountId: "account-a",
      repository: "owner/other",
      channel: "x",
      format: "x-thread",
      status: "scheduled",
      scheduledFor: "2026-09-10T10:00:00Z",
      media: MEDIA,
    });
    store.createContentItem({
      accountId: "account-b",
      repository: "owner/repo",
      channel: "x",
      format: "x-thread",
      status: "scheduled",
      scheduledFor: "2026-09-10T10:00:00Z",
      media: MEDIA,
    });

    expect(store.listContentItems("account-a", { repository: "owner/repo" })).toHaveLength(3);
    expect(store.listContentItems("account-a", { repository: "owner/repo", status: "draft" })).toHaveLength(1);
    expect(store.listContentItems("account-b")).toHaveLength(1);
    expect(store.listContentItems("account-a", {
      repository: "owner/repo",
      scheduledFrom: "2026-09-09T00:00:00Z",
      scheduledTo: "2026-09-11T00:00:00Z",
    })).toEqual([thursday]);
  });

  it("enforces media and scheduling invariants across content status changes", () => {
    for (const status of ["ready", "scheduled", "published"] as const) {
      expect(() => store.createContentItem({
        accountId: "account-a",
        repository: "owner/repo",
        channel: "x",
        format: "x-thread",
        status,
        scheduledFor: status === "scheduled" ? "2026-09-08T10:00:00Z" : null,
      })).toThrow(store.MediaRequiredError);
    }

    const draft = createDraft();
    expect(() => store.updateContentItem("account-a", draft.id, { status: "ready" }))
      .toThrow(store.MediaRequiredError);
    expect(store.getContentItem("account-a", draft.id)?.status).toBe("draft");

    const ready = store.updateContentItem("account-a", draft.id, { media: MEDIA, status: "ready" });
    expect(ready?.status).toBe("ready");
    expect(() => store.rescheduleContentItem("account-a", draft.id, "not-a-date"))
      .toThrow(store.ScheduleRequiredError);

    const scheduled = store.rescheduleContentItem("account-a", draft.id, "2026-09-08T10:00:00Z");
    expect(scheduled).toMatchObject({ status: "scheduled", scheduledFor: "2026-09-08T10:00:00Z" });
    expect(store.rescheduleContentItem("account-a", draft.id, null)).toMatchObject({
      status: "ready",
      scheduledFor: null,
    });

    expect(() => store.markContentItemPublished("account-a", draft.id, "ftp://example.com/post"))
      .toThrow(store.InvalidPublishedUrlError);
    const published = store.markContentItemPublished("account-a", draft.id, " https://example.com/post ");
    expect(published?.status).toBe("published");
    expect(published?.publishedUrl).toBe("https://example.com/post");
    expect(published?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("updates and deletes content only within the owning account", () => {
    const item = createDraft();
    expect(store.updateContentItem("account-b", item.id, { title: "Wrong account" })).toBeNull();
    expect(store.deleteContentItem("account-b", item.id)).toBe(false);
    expect(store.updateContentItem("account-a", item.id, {
      title: "Updated title",
      body: "Updated body",
      evergreen: 1,
    })).toMatchObject({ title: "Updated title", body: "Updated body", evergreen: 1 });
    expect(store.deleteContentItem("account-a", item.id)).toBe(true);
    expect(store.getContentItem("account-a", item.id)).toBeNull();
  });

  it("upserts and filters performance within its account and cascades content deletion", () => {
    const item = createDraft("account-a", "owner/repo");
    const otherRepository = createDraft("account-a", "owner/other");
    const otherAccount = createDraft("account-b", "owner/repo");
    const measuredAt = "2026-09-10T00:00:00.000Z";

    expect(store.upsertContentPerformance("account-b", {
      contentId: item.id,
      window: "48h",
      measuredAt,
      metrics: { starsDelta: 99, forksDelta: 99 },
    })).toBeNull();
    const first = store.upsertContentPerformance("account-a", {
      contentId: item.id,
      window: "48h",
      measuredAt,
      metrics: { starsDelta: 4, forksDelta: -1 },
    });
    store.upsertContentPerformance("account-a", {
      contentId: otherRepository.id,
      window: "7d",
      measuredAt,
      metrics: { starsDelta: 8, forksDelta: 2 },
    });
    store.upsertContentPerformance("account-b", {
      contentId: otherAccount.id,
      window: "48h",
      measuredAt,
      metrics: { starsDelta: 1, forksDelta: 0 },
    });

    expect(first).toMatchObject({
      accountId: "account-a",
      contentId: item.id,
      window: "48h",
      metrics: { starsDelta: 4, forksDelta: -1 },
    });
    expect(store.listContentPerformance("account-a", { repository: "owner/repo" })).toEqual([first]);
    expect(store.listContentPerformance("account-a", { contentId: otherRepository.id, window: "7d" }))
      .toHaveLength(1);
    expect(store.listContentPerformance("account-b")).toHaveLength(1);

    const updated = store.upsertContentPerformance("account-a", {
      contentId: item.id,
      window: "48h",
      measuredAt: "2026-09-11T00:00:00.000Z",
      metrics: { starsDelta: -2, forksDelta: 3 },
    });
    expect(updated).toMatchObject({
      measuredAt: "2026-09-11T00:00:00.000Z",
      metrics: { starsDelta: -2, forksDelta: 3 },
    });
    expect(store.listContentPerformance("account-a", { contentId: item.id })).toHaveLength(1);

    expect(store.deleteContentItem("account-a", item.id)).toBe(true);
    expect(store.listContentPerformance("account-a", { contentId: item.id })).toEqual([]);
  });

  it("migrates legacy suggestions and proposals once per account with complete mapping", () => {
    const database = getDatabase();
    database.exec(`
      CREATE TABLE repository_goals (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        repository TEXT NOT NULL,
        metric TEXT NOT NULL,
        target_value INTEGER NOT NULL,
        current_value INTEGER NOT NULL,
        deadline TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        suggestions TEXT NOT NULL DEFAULT '[]',
        suggestions_generated_at TEXT
      )
    `);
    const legacySuggestions: GoalSuggestion[] = [
      {
        category: "marketing",
        title: "Share the release",
        action: "Tell maintainers what changed.",
        proposalsGeneratedAt: "2026-09-03T12:00:00.000Z",
        proposalsVersion: 7,
        proposals: [
          {
            title: "Release thread",
            format: "x-thread",
            summary: "A release overview",
            content: "First post\n\nSecond post",
            threadPosts: ["First post", "Second post"],
            mediaSuggestions: [{
              kind: "image",
              title: "Release screenshot",
              sourceUrl: "https://example.com/release.png",
              guidance: "Show the new workflow.",
            }],
          },
          {
            title: "Community discussion",
            format: "discussion",
            summary: "Invite feedback",
            content: "What should come next?",
          },
        ],
      },
      {
        category: "community",
        title: "Welcome contributors",
        action: "Document one contribution path.",
      },
    ];
    const insertGoal = database.prepare(
      `INSERT INTO repository_goals
        (id, account_id, repository, metric, target_value, current_value, deadline, created_at, updated_at, suggestions, suggestions_generated_at)
       VALUES (?, ?, ?, 'stars', 100, 10, '2026-12-01', ?, ?, ?, ?)`,
    );
    insertGoal.run(
      "goal-a",
      "account-a",
      "owner/repo",
      "2026-09-01T00:00:00.000Z",
      "2026-09-02T00:00:00.000Z",
      JSON.stringify(legacySuggestions),
      "2026-09-02T00:00:00.000Z",
    );
    insertGoal.run(
      "goal-b",
      "account-b",
      "owner/private",
      "2026-09-01T00:00:00.000Z",
      "2026-09-02T00:00:00.000Z",
      JSON.stringify(legacySuggestions.slice(0, 1)),
      "2026-09-02T00:00:00.000Z",
    );

    store.migrateLegacySuggestions("account-a");
    store.migrateLegacySuggestions("account-a");

    const interventions = store.listGrowthInterventions("account-a", { goalId: "goal-a" });
    expect(interventions).toHaveLength(2);
    expect(interventions.map(({ title }) => title)).toEqual(["Share the release", "Welcome contributors"]);
    expect(interventions[0]).toMatchObject({
      repository: "owner/repo",
      category: "marketing",
      origin: "ai",
      status: "proposed",
      dedupeKey: "owner/repo:goal-a:share-the-release",
    });
    const items = store.listContentItems("account-a", { repository: "owner/repo" });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      interventionId: interventions[0].id,
      goalIds: ["goal-a"],
      channel: "x",
      format: "x-thread",
      body: "First post\n\nSecond post",
      threadPosts: ["First post", "Second post"],
      media: [{
        kind: "image",
        url: "https://example.com/release.png",
        alt: "Release screenshot",
        caption: "Show the new workflow.",
      }],
      status: "draft",
      generatedAt: "2026-09-03T12:00:00.000Z",
      generationVersion: 7,
    });
    expect(items[1].channel).toBe("other");
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM growth_interventions WHERE account_id = 'account-b'",
    ).get()).toEqual({ count: 0 });
    expect(database.prepare(
      "SELECT value FROM preferences WHERE scope = 'growth' AND key = ?",
    ).get("migratedSuggestionsV1:account-a")).toEqual({ value: "true" });
    expect(database.prepare(
      "SELECT suggestions FROM repository_goals WHERE id = 'goal-a'",
    ).get()).toEqual({ suggestions: JSON.stringify(legacySuggestions) });

    const projected = goalStore.findGoal("account-a", "goal-a");
    expect(projected?.suggestions).toHaveLength(2);
    expect(projected?.suggestions[0]).toMatchObject({
      title: "Share the release",
      proposalsVersion: 7,
      proposalsGeneratedAt: "2026-09-03T12:00:00.000Z",
      proposals: [
        { title: "Release thread", format: "x-thread" },
        { title: "Community discussion", format: "discussion" },
      ],
    });
  });

  it("persists new goal advice as growth rows while preserving legacy JSON", () => {
    const goal = goalStore.createGoal({
      accountId: "account-a",
      repository: "owner/repo",
      metric: "stars",
      targetValue: 100,
      deadline: "2026-12-01",
    });
    goalStore.saveGoalSuggestions("account-a", goal.id, [{
      category: "marketing",
      title: "Share the release",
      action: "Publish a release thread.",
    }]);
    const intervention = store.listGrowthInterventions("account-a", { goalId: goal.id })[0];
    store.updateGrowthInterventionStatus("account-a", intervention.id, "accepted");
    goalStore.saveGoalSuggestions("account-a", goal.id, [{
      category: "marketing",
      title: " SHARE the release! ",
      action: "Publish an updated release thread.",
    }]);
    store.upsertGrowthIntervention({
      accountId: "account-a",
      repository: "owner/repo",
      goalId: goal.id,
      category: "marketing",
      title: "Share the release",
      action: "Publish an updated release thread.",
      origin: "ai",
      dedupeKey: "new-backlog-key",
    });
    goalStore.saveGoalSuggestions("account-a", goal.id, [{
      category: "marketing",
      title: " SHARE the release! ",
      action: "Publish an updated release thread.",
    }]);

    expect(store.listGrowthInterventions("account-a", { goalId: goal.id })).toEqual([
      expect.objectContaining({
        id: intervention.id,
        status: "accepted",
        action: "Publish an updated release thread.",
      }),
    ]);
    expect(getDatabase().prepare(
      "SELECT suggestions FROM repository_goals WHERE id = ?",
    ).get(goal.id)).toEqual({ suggestions: "[]" });

    const saved = goalStore.saveGoalProposals("account-a", goal.id, 0, [{
      title: "Release post",
      format: "linkedin-post",
      summary: "A concise release summary",
      content: "The release is ready to try.",
      mediaSuggestions: [{
        kind: "image",
        title: "Product screenshot",
        sourceUrl: "https://example.com/product.png",
        guidance: "Highlight the updated screen.",
      }],
    }], 4);
    expect(saved).toMatchObject({
      title: " SHARE the release! ",
      proposalsVersion: 4,
      proposals: [{ title: "Release post", format: "linkedin-post" }],
    });
    expect(store.listContentItems("account-a")).toEqual([
      expect.objectContaining({
        interventionId: intervention.id,
        channel: "linkedin",
        generationVersion: 4,
        status: "draft",
      }),
    ]);

    expect(goalStore.deleteGoal("account-a", goal.id)).toBe(true);
    expect(store.listGrowthInterventions("account-a", { goalId: null })).toEqual([
      expect.objectContaining({ id: intervention.id }),
    ]);
    expect(store.listContentItems("account-a")[0].goalIds).toEqual([]);
  });
});
