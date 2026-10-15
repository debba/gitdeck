import { describe, expect, it } from "vitest";
import type { GrowthContentItem, GrowthProfile } from "../../../src/types/growth";
import { createDefaultGrowthProfile } from "../../../src/utils/growth/profileDefaults";
import {
  buildGrowthUnifiedCalendar,
  filterGrowthUnifiedCalendar,
  growthUnifiedCalendarFilterOptions,
  growthUnifiedCalendarUtcRange,
  growthUnifiedPillarFilterValue,
  readGrowthUnifiedCalendarFilters,
  writeGrowthUnifiedCalendarFilters,
} from "../../../src/utils/growth/unifiedCalendar";

function contentItem(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "item-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: null,
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release",
    title: "Release",
    summary: "Release summary",
    body: "Release body",
    threadPosts: [],
    media: [],
    sources: [],
    status: "idea",
    scheduledFor: "2026-10-14T08:00:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function profile(repository: string, overrides: Partial<GrowthProfile> = {}): GrowthProfile {
  return {
    ...createDefaultGrowthProfile("account-a", repository),
    ...overrides,
  };
}

describe("unified Growth calendar read model", () => {
  it("keeps profile-only and content-only repositories separate with stable metadata and ordering", () => {
    const romeProfile = profile("acme/rome", {
      color: "#BE123C",
      timezone: "Europe/Rome",
      postingWindows: [{ weekday: 5, hour: 16 }, { weekday: 1, hour: 9 }],
      pillars: [
        { id: "release", label: "Releases", weight: 60, description: "Ship" },
        { id: "community", label: "Community", weight: 40, description: "People" },
      ],
    });
    const sameInstantInRome = contentItem({
      id: "rome-item",
      repository: "acme/rome",
      scheduledFor: "2026-10-14T22:30:00.000Z",
    });
    const contentOnly = contentItem({
      id: "alpha-item",
      repository: "Acme/alpha",
      scheduledFor: "2026-10-14T22:30:00.000Z",
    });
    const profileOnly = profile("acme/zulu", { color: "#047857", timezone: "Asia/Tokyo" });

    const calendar = buildGrowthUnifiedCalendar(
      "account-a",
      [sameInstantInRome, contentOnly],
      [profileOnly, romeProfile],
    );

    expect(calendar.repositories.map(({ repository }) => repository)).toEqual([
      "Acme/alpha",
      "acme/rome",
      "acme/zulu",
    ]);
    expect(calendar.repositories[0]).toMatchObject({
      repository: "Acme/alpha",
      color: createDefaultGrowthProfile("account-a", "Acme/alpha").color,
      timezone: "UTC",
      postingWindows: [],
    });
    expect(calendar.repositories[1]).toMatchObject({
      color: "#BE123C",
      timezone: "Europe/Rome",
      postingWindows: [{ weekday: 5, hour: 16 }, { weekday: 1, hour: 9 }],
      pillarLabels: [
        { id: "release", label: "Releases" },
        { id: "community", label: "Community" },
      ],
    });
    expect(calendar.repositories[2].contentItems).toEqual([]);
    expect(calendar.repositories[0].contentItems[0].scheduledFor)
      .toBe(calendar.repositories[1].contentItems[0].scheduledFor);
  });

  it("retains every dated editorial status except skipped and sorts items independently of input order", () => {
    const statuses = ["idea", "draft", "ready", "scheduled", "published"] as const;
    const visible = statuses.map((status, index) => contentItem({
      id: `visible-${status}`,
      status,
      scheduledFor: `2026-10-14T${String(12 - index).padStart(2, "0")}:00:00.000Z`,
    }));
    const excluded = [
      contentItem({ id: "skipped", status: "skipped" }),
      contentItem({ id: "undated", scheduledFor: null }),
      contentItem({ id: "invalid-date", scheduledFor: "not-a-date" }),
      contentItem({ id: "foreign-item", accountId: "account-b", repository: "private/repo" }),
    ];
    const foreignProfile = profile("private/profile", { accountId: "account-b" });

    const first = buildGrowthUnifiedCalendar(
      "account-a",
      [...visible, ...excluded].reverse(),
      [foreignProfile],
    );
    const second = buildGrowthUnifiedCalendar(
      "account-a",
      [...visible, ...excluded],
      [foreignProfile],
    );

    expect(first).toEqual(second);
    expect(first.repositories).toHaveLength(1);
    expect(first.repositories[0].contentItems.map(({ status }) => status)).toEqual([
      "published",
      "scheduled",
      "ready",
      "draft",
      "idea",
    ]);
    expect(first.repositories.flatMap(({ contentItems }) => contentItems).map(({ id }) => id)).toEqual([
      "visible-published",
      "visible-scheduled",
      "visible-ready",
      "visible-draft",
      "visible-idea",
    ]);
  });

  it("builds stable filter choices and keeps equal pillar IDs repository-qualified", () => {
    const calendar = buildGrowthUnifiedCalendar("account-a", [
      contentItem({ id: "rome-product", repository: "acme/rome", channel: "x", status: "draft" }),
      contentItem({ id: "tokyo-product", repository: "acme/tokyo", channel: "linkedin", status: "ready" }),
    ], [
      profile("acme/rome", {
        pillars: [{ id: "product", label: "Rome product", weight: 100, description: "" }],
      }),
      profile("acme/tokyo", {
        pillars: [{ id: "product", label: "Tokyo product", weight: 100, description: "" }],
      }),
    ]);

    const options = growthUnifiedCalendarFilterOptions(calendar);
    expect(options.repositories).toEqual(["acme/rome", "acme/tokyo"]);
    expect(options.channels).toEqual(["x", "linkedin"]);
    expect(options.statuses).toEqual(["draft", "ready"]);
    expect(options.pillars).toEqual([
      {
        value: "acme/rome::product",
        repository: "acme/rome",
        id: "product",
        label: "Rome product",
      },
      {
        value: "acme/tokyo::product",
        repository: "acme/tokyo",
        id: "product",
        label: "Tokyo product",
      },
    ]);
  });

  it("combines repository, channel, pillar, and status filters without changing source choices", () => {
    const rome = contentItem({
      id: "rome-product",
      repository: "acme/rome",
      channel: "x",
      pillar: "product",
      status: "draft",
      scheduledFor: "2026-10-14T22:30:00.000Z",
    });
    const tokyo = contentItem({
      id: "tokyo-product",
      repository: "acme/tokyo",
      channel: "x",
      pillar: "product",
      status: "draft",
      scheduledFor: "2026-10-14T15:30:00.000Z",
    });
    const calendar = buildGrowthUnifiedCalendar("account-a", [rome, tokyo], [
      profile("acme/rome", { timezone: "Europe/Rome", color: "#BE123C" }),
      profile("acme/tokyo", { timezone: "Asia/Tokyo", color: "#047857" }),
    ]);

    const filtered = filterGrowthUnifiedCalendar(calendar, {
      repository: "acme/tokyo",
      channel: "x",
      pillar: growthUnifiedPillarFilterValue("acme/tokyo", "product"),
      status: "draft",
    }, { rangeStart: "2026-10-15", rangeEnd: "2026-10-15" });

    expect(filtered.itemCount).toBe(1);
    expect(filtered.itemsByDate.get("2026-10-15")?.map(({ id }) => id)).toEqual(["tokyo-product"]);
    expect(filtered.itemPresentations.get("tokyo-product")).toEqual({
      repository: "acme/tokyo",
      color: "#047857",
      timezone: "Asia/Tokyo",
      pillarLabel: "Product value",
    });
    expect(filtered.itemPresentations.has("rome-product")).toBe(false);
    expect(growthUnifiedCalendarFilterOptions(calendar).repositories).toHaveLength(2);
  });

  it("groups timezone date edges and builds UTC bounds for every possible profile offset", () => {
    const calendar = buildGrowthUnifiedCalendar("account-a", [
      contentItem({ id: "tokyo-edge", repository: "acme/tokyo", scheduledFor: "2026-09-30T15:30:00.000Z" }),
      contentItem({ id: "la-edge", repository: "acme/la", scheduledFor: "2026-10-02T06:30:00.000Z" }),
    ], [
      profile("acme/tokyo", { timezone: "Asia/Tokyo" }),
      profile("acme/la", { timezone: "America/Los_Angeles" }),
    ]);
    const visible = filterGrowthUnifiedCalendar(calendar, {
      repository: "",
      channel: "",
      pillar: "",
      status: "",
    }, { rangeStart: "2026-10-01", rangeEnd: "2026-10-01" });

    expect(visible.itemsByDate.get("2026-10-01")?.map(({ id }) => id).sort()).toEqual([
      "la-edge",
      "tokyo-edge",
    ]);
    expect(growthUnifiedCalendarUtcRange({ rangeStart: "2026-10-01", rangeEnd: "2026-10-01" })).toEqual({
      scheduledFrom: "2026-09-30T10:00:00.000Z",
      scheduledTo: "2026-10-02T11:59:59.999Z",
    });
  });

  it("restores supported URL filters and serializes explicit All values by omission", () => {
    const filters = readGrowthUnifiedCalendarFilters(
      "?view=week&repository=acme%2Frome&channel=x&pillar=acme%2Frome%3A%3Aproduct&status=draft",
    );
    expect(filters).toEqual({
      repository: "acme/rome",
      channel: "x",
      pillar: "acme/rome::product",
      status: "draft",
    });
    expect(writeGrowthUnifiedCalendarFilters(new URLSearchParams("view=week&date=2026-10-15"), filters).toString())
      .toBe("view=week&date=2026-10-15&repository=acme%2Frome&channel=x&pillar=acme%2Frome%3A%3Aproduct&status=draft");
    expect(readGrowthUnifiedCalendarFilters("?channel=invalid&status=invalid")).toEqual({
      repository: "",
      channel: "",
      pillar: "",
      status: "",
    });
  });
});
