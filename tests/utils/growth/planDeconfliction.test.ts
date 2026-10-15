import { describe, expect, it } from "vitest";
import type {
  BuildGrowthPlanSlotsInput,
  GrowthPlanSlot,
} from "../../../src/types/growth";
import { calendarDateInTimezone } from "../../../src/utils/growth/calendar";
import { deconflictGrowthPlanSlots } from "../../../src/utils/growth/planDeconfliction";
import { buildGrowthPlanSlots } from "../../../src/utils/growth/planSlots";

function slotInput(
  timezone: string,
  weekday = 1,
  hour = 9,
): BuildGrowthPlanSlotsInput {
  return {
    periodStart: "2026-10-26",
    periodEnd: "2026-11-01",
    channels: { x: true, linkedin: false, mastodon: false, bluesky: false, discussion: false, blog: false },
    cadence: { x: 1, linkedin: 0, mastodon: 0, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product", weight: 100, description: "" }],
    postingWindows: [{ weekday, hour }],
    timezone,
  };
}

function slot(key: string): GrowthPlanSlot {
  return {
    key,
    channel: "x",
    format: "x-thread",
    pillarId: "product",
    scheduledFor: "2026-10-26T09:00:00.000Z",
  };
}

describe("deconflictGrowthPlanSlots", () => {
  it("uses stable repository order and the nearest free date with forward preference", () => {
    const original = buildGrowthPlanSlots(slotInput("UTC"))[0];
    const result = deconflictGrowthPlanSlots([
      { repository: "zeta/repo", timezone: "UTC", slots: [{ ...original, key: "zeta" }] },
      { repository: "Alpha/repo", timezone: "UTC", slots: [{ ...original, key: "alpha" }] },
      { repository: "beta/repo", timezone: "UTC", slots: [{ ...original, key: "beta" }] },
    ], "2026-10-26", "2026-11-01");

    expect(result.repositories.map(({ repository }) => repository)).toEqual([
      "Alpha/repo",
      "beta/repo",
      "zeta/repo",
    ]);
    expect(result.repositories.map(({ slots }) => slots[0].scheduledFor)).toEqual([
      "2026-10-26T09:00:00.000Z",
      "2026-10-27T09:00:00.000Z",
      "2026-10-28T09:00:00.000Z",
    ]);
    expect(result).toMatchObject({ deconflictedItemCount: 2, remainingCollisionCount: 0 });
  });

  it("preserves slot identity, content fields, counts, timezone, and local wall-clock time across DST", () => {
    const utcSlot = buildGrowthPlanSlots(slotInput("UTC", 6, 1))[0];
    const newYorkSlot = buildGrowthPlanSlots(slotInput("America/New_York", 6, 1))[0];
    const result = deconflictGrowthPlanSlots([
      { repository: "acme/anchor", timezone: "UTC", slots: [utcSlot] },
      { repository: "acme/new-york", timezone: "America/New_York", slots: [newYorkSlot] },
    ], "2026-10-26", "2026-11-01");
    const newYork = result.repositories.find(({ repository }) => repository === "acme/new-york")!;

    expect(newYork.timezone).toBe("America/New_York");
    expect(newYork.slots).toHaveLength(1);
    expect(newYork.slots[0]).toMatchObject({
      key: newYorkSlot.key,
      channel: newYorkSlot.channel,
      format: newYorkSlot.format,
      pillarId: newYorkSlot.pillarId,
      scheduledFor: "2026-11-01T06:00:00.000Z",
    });
    expect(calendarDateInTimezone(newYork.slots[0].scheduledFor, newYork.timezone)).toBe("2026-11-01");
  });

  it("leaves only unavoidable collisions after every period date is occupied", () => {
    const result = deconflictGrowthPlanSlots([
      {
        repository: "acme/crowded",
        timezone: "UTC",
        slots: Array.from({ length: 8 }, (_, index) => slot(`slot-${index}`)),
      },
    ], "2026-10-26", "2026-11-01");
    const localDates = result.repositories[0].slots.map((entry) => (
      calendarDateInTimezone(entry.scheduledFor, "UTC")
    ));

    expect(result.deconflictedItemCount).toBe(6);
    expect(result.remainingCollisionCount).toBe(1);
    expect(new Set(localDates)).toHaveLength(7);
    expect(result.repositories[0].slots).toHaveLength(8);
  });

  it("is deterministic without mutating input and rejects slots outside a complete-week period", () => {
    const repositories = [{
      repository: "acme/repo",
      timezone: "UTC",
      slots: [slot("slot-1"), slot("slot-2")],
    }];
    const before = JSON.stringify(repositories);
    expect(deconflictGrowthPlanSlots(repositories, "2026-10-26", "2026-11-01"))
      .toEqual(deconflictGrowthPlanSlots(repositories, "2026-10-26", "2026-11-01"));
    expect(JSON.stringify(repositories)).toBe(before);
    expect(() => deconflictGrowthPlanSlots(repositories, "2026-10-27", "2026-11-01"))
      .toThrow("complete ISO weeks");
    expect(() => deconflictGrowthPlanSlots([{
      ...repositories[0],
      slots: [{ ...slot("outside"), scheduledFor: "2026-11-02T09:00:00.000Z" }],
    }], "2026-10-26", "2026-11-01")).toThrow("inside the requested period");
  });
});
