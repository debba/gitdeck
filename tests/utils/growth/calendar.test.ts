import { describe, expect, it } from "vitest";
import type { GrowthContentItem } from "../../../src/types/growth";
import {
  buildGrowthCalendarMonth,
  buildGrowthCalendarWeek,
  calendarDateInTimezone,
  groupGrowthCalendarItems,
  groupGrowthQueueItems,
  growthCalendarUtcRange,
  normalizeCalendarDate,
  rescheduleGrowthCalendarItem,
  shiftCalendarDate,
  shiftCalendarMonth,
  shiftCalendarWeek,
} from "../../../src/utils/growth/calendar";

function contentItem(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: "plan-1",
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release story",
    title: "Release thread",
    summary: "Read the release",
    body: "Release body",
    threadPosts: [],
    media: [],
    sources: [],
    status: "idea",
    scheduledFor: "2026-03-31T22:30:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("growth calendar utilities", () => {
  it("builds a Monday-first six-week grid around the selected month", () => {
    const grid = buildGrowthCalendarMonth("2026-08-19");

    expect(grid.monthStart).toBe("2026-08-01");
    expect(grid.rangeStart).toBe("2026-07-27");
    expect(grid.rangeEnd).toBe("2026-09-06");
    expect(grid.days).toHaveLength(42);
    expect(grid.days.filter((day) => day.inCurrentMonth)).toHaveLength(31);
    expect(grid.days[0]).toEqual({ date: "2026-07-27", dayOfMonth: 27, inCurrentMonth: false });
  });

  it("builds and shifts a Monday-first seven-day week", () => {
    const grid = buildGrowthCalendarWeek("2026-10-15");

    expect(grid.rangeStart).toBe("2026-10-12");
    expect(grid.rangeEnd).toBe("2026-10-18");
    expect(grid.days).toHaveLength(7);
    expect(grid.days.map((day) => day.date)).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
      "2026-10-16", "2026-10-17", "2026-10-18",
    ]);
    expect(shiftCalendarWeek("2026-10-15", -1)).toBe("2026-10-08");
    expect(shiftCalendarDate("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("normalizes invalid dates and shifts months without overflowing shorter months", () => {
    expect(normalizeCalendarDate("2026-02-31", "2026-09-04")).toBe("2026-09-04");
    expect(normalizeCalendarDate("2026-02-14", "2026-09-04")).toBe("2026-02-14");
    expect(shiftCalendarMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftCalendarMonth("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("groups scheduled items by their local profile date and excludes skipped or unscheduled work", () => {
    const first = contentItem();
    const second = contentItem({ id: "content-2", scheduledFor: "2026-04-01T08:00:00.000Z" });
    const skipped = contentItem({ id: "skipped", status: "skipped" });
    const backlog = contentItem({ id: "backlog", scheduledFor: null });

    const grouped = groupGrowthCalendarItems([second, skipped, backlog, first], "Europe/Rome");

    expect(calendarDateInTimezone(first.scheduledFor!, "Europe/Rome")).toBe("2026-04-01");
    expect(calendarDateInTimezone(first.scheduledFor!, "America/Los_Angeles")).toBe("2026-03-31");
    expect(grouped.get("2026-04-01")?.map((item) => item.id)).toEqual(["content-1", "content-2"]);
    expect([...grouped.values()].flat().map((item) => item.id)).not.toContain("skipped");
  });

  it("groups a timezone-local Monday-through-Sunday queue by workflow and local time", () => {
    const week = buildGrowthCalendarWeek("2026-10-25");
    const groups = groupGrowthQueueItems([
      contentItem({ id: "later-draft", status: "draft", scheduledFor: "2026-10-20T14:00:00.000Z" }),
      contentItem({ id: "published", status: "published", scheduledFor: "2026-10-25T22:30:00.000Z" }),
      contentItem({ id: "outside", status: "ready", scheduledFor: "2026-10-25T23:30:00.000Z" }),
      contentItem({ id: "idea", status: "idea", scheduledFor: "2026-10-18T22:30:00.000Z" }),
      contentItem({ id: "earlier-draft", status: "draft", scheduledFor: "2026-10-20T08:00:00.000Z" }),
      contentItem({ id: "skipped", status: "skipped", scheduledFor: "2026-10-21T08:00:00.000Z" }),
      contentItem({ id: "backlog", status: "ready", scheduledFor: null }),
    ], week, "Europe/Rome");

    expect(week).toMatchObject({ rangeStart: "2026-10-19", rangeEnd: "2026-10-25" });
    expect(groups.needsDraft.map((item) => item.id)).toEqual(["idea"]);
    expect(groups.draft.map((item) => item.id)).toEqual(["earlier-draft", "later-draft"]);
    expect(groups.published.map((item) => item.id)).toEqual(["published"]);
    expect(Object.values(groups).flat().map((item) => item.id)).not.toContain("outside");
    expect(Object.values(groups).flat().map((item) => item.id)).not.toContain("skipped");
  });

  it("converts month and week grids to inclusive UTC API bounds across DST", () => {
    expect(growthCalendarUtcRange(buildGrowthCalendarMonth("2026-10-15"), "Europe/Rome")).toEqual({
      scheduledFrom: "2026-09-27T22:00:00.000Z",
      scheduledTo: "2026-11-08T22:59:59.999Z",
    });
    expect(growthCalendarUtcRange(buildGrowthCalendarWeek("2026-10-25"), "Europe/Rome")).toEqual({
      scheduledFrom: "2026-10-18T22:00:00.000Z",
      scheduledTo: "2026-10-25T22:59:59.999Z",
    });
  });

  it("reschedules across DST while preserving local time, milliseconds, and editorial status", () => {
    const moved = rescheduleGrowthCalendarItem(contentItem({
      status: "draft",
      scheduledFor: "2026-03-27T08:30:15.250Z",
    }), "2026-03-30", "Europe/Rome");

    expect(moved.scheduledFor).toBe("2026-03-30T07:30:15.250Z");
    expect(moved.status).toBe("draft");
    expect(calendarDateInTimezone(moved.scheduledFor!, "Europe/Rome")).toBe("2026-03-30");
  });

  it("normalizes DST gaps forward and chooses the post-transition overlap", () => {
    expect(rescheduleGrowthCalendarItem(contentItem({
      scheduledFor: "2026-03-28T01:30:00.000Z",
    }), "2026-03-29", "Europe/Rome").scheduledFor).toBe("2026-03-29T01:30:00.000Z");

    expect(rescheduleGrowthCalendarItem(contentItem({
      scheduledFor: "2026-10-24T00:30:00.000Z",
    }), "2026-10-25", "Europe/Rome").scheduledFor).toBe("2026-10-25T01:30:00.000Z");
  });
});
