import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    tmpDir: resolve(tmpdir(), `gitdeck-growth-calendar-${process.pid}-${Date.now()}`),
  };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: state.tmpDir }));

const store = await import("../../src/server/growth/store");
const { getGrowthUnifiedCalendar } = await import("../../src/server/growth/calendar");
const { closeDatabase } = await import("../../src/server/sqlite");

const media = [{ kind: "image" as const, url: "https://example.com/card.png", alt: "Card" }];

function profileInput(overrides: Record<string, unknown> = {}) {
  return {
    language: "en",
    voice: "Practical",
    audience: "Maintainers",
    channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product outcomes", weight: 100, description: "Outcomes" }],
    hashtags: [],
    avoid: "",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 10 }],
    color: "#BE123C",
    ...overrides,
  };
}

function createDated(input: {
  accountId?: string;
  repository: string;
  scheduledFor: string | null;
  status?: "idea" | "draft" | "ready" | "scheduled" | "published" | "skipped";
  title: string;
}) {
  const status = input.status ?? "idea";
  return store.createContentItem({
    accountId: input.accountId ?? "account-a",
    repository: input.repository,
    channel: "x",
    format: "x-thread",
    pillar: "product",
    title: input.title,
    status,
    scheduledFor: input.scheduledFor,
    ...(["ready", "scheduled", "published"].includes(status) ? { media } : {}),
  });
}

beforeEach(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

afterAll(async () => {
  closeDatabase();
  await rm(state.tmpDir, { recursive: true, force: true });
});

describe("unified Growth calendar service", () => {
  it("returns bounded profile-only and content-only repositories with account-scoped metadata", () => {
    store.upsertGrowthProfile("account-a", "acme/rocket", profileInput());
    store.upsertGrowthProfile("account-a", "acme/zulu", profileInput({
      timezone: "Asia/Tokyo",
      color: "#047857",
      postingWindows: [],
    }));
    store.upsertGrowthProfile("account-b", "private/profile", profileInput());

    const fromEdge = createDated({
      repository: "acme/rocket",
      scheduledFor: "2026-10-14T08:00:00.000Z",
      title: "From edge",
    });
    const toEdge = createDated({
      repository: "Acme/alpha",
      scheduledFor: "2026-10-14T09:00:00.000Z",
      status: "published",
      title: "To edge",
    });
    createDated({
      repository: "acme/rocket",
      scheduledFor: "2026-10-14T07:59:59.999Z",
      title: "Before range",
    });
    createDated({
      repository: "acme/rocket",
      scheduledFor: "2026-10-14T09:00:00.001Z",
      title: "After range",
    });
    createDated({
      repository: "acme/rocket",
      scheduledFor: "2026-10-14T08:30:00.000Z",
      status: "skipped",
      title: "Skipped",
    });
    createDated({
      repository: "acme/rocket",
      scheduledFor: null,
      title: "Backlog",
    });
    createDated({
      accountId: "account-b",
      repository: "acme/rocket",
      scheduledFor: "2026-10-14T08:30:00.000Z",
      title: "Private account item",
    });

    const calendar = getGrowthUnifiedCalendar("account-a", {
      scheduledFrom: "2026-10-14T08:00:00Z",
      scheduledTo: "2026-10-14T09:00:00Z",
    });

    expect(calendar.repositories.map(({ repository }) => repository)).toEqual([
      "Acme/alpha",
      "acme/rocket",
      "acme/zulu",
    ]);
    expect(calendar.repositories[0]).toMatchObject({
      timezone: "UTC",
      postingWindows: [],
      pillarLabels: expect.arrayContaining([{ id: "product", label: "Product value" }]),
      contentItems: [{ id: toEdge.id }],
    });
    expect(calendar.repositories[1]).toMatchObject({
      color: "#BE123C",
      timezone: "Europe/Rome",
      postingWindows: [{ weekday: 1, hour: 10 }],
      pillarLabels: [{ id: "product", label: "Product outcomes" }],
      contentItems: [{ id: fromEdge.id }],
    });
    expect(calendar.repositories[2]).toMatchObject({
      color: "#047857",
      timezone: "Asia/Tokyo",
      contentItems: [],
    });
    expect(JSON.stringify(calendar)).not.toContain("Private account item");
    expect(JSON.stringify(calendar)).not.toContain("private/profile");
    expect(JSON.stringify(calendar)).not.toContain("Skipped");
  });

  it("returns an empty model and rejects malformed direct ranges without reading beyond them", () => {
    expect(getGrowthUnifiedCalendar("account-empty", {
      scheduledFrom: "2026-10-14T08:00:00.000Z",
      scheduledTo: "2026-10-14T09:00:00.000Z",
    })).toEqual({ repositories: [] });

    const invalid = [
      { scheduledFrom: "invalid", scheduledTo: "2026-10-14T09:00:00.000Z" },
      { scheduledFrom: "2026-10-14T08:00:00+00:00", scheduledTo: "2026-10-14T09:00:00.000Z" },
      { scheduledFrom: "2026-02-30T08:00:00Z", scheduledTo: "2026-10-14T09:00:00.000Z" },
      { scheduledFrom: "2026-10-14T10:00:00.000Z", scheduledTo: "2026-10-14T09:00:00.000Z" },
    ];
    for (const filters of invalid) {
      expect(() => getGrowthUnifiedCalendar("account-a", filters))
        .toThrow("invalid unified calendar date range");
    }
  });
});
