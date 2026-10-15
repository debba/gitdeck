import { describe, expect, it } from "vitest";
import {
  GROWTH_CHANNELS,
  type BuildGrowthPlanSlotsInput,
  type GrowthCadence,
  type GrowthChannelSelection,
} from "../../../src/types/growth";
import {
  buildGrowthPlanSlots,
  growthPlanPeriodFromStart,
  nextGrowthPlanPeriod,
} from "../../../src/utils/growth/planSlots";

const DISABLED_CHANNELS: GrowthChannelSelection = {
  x: false,
  linkedin: false,
  mastodon: false,
  bluesky: false,
  discussion: false,
  blog: false,
};

const ZERO_CADENCE: GrowthCadence = {
  x: 0,
  linkedin: 0,
  mastodon: 0,
  bluesky: 0,
  discussion: 0,
  blog: 0,
};

function slotInput(overrides: Partial<BuildGrowthPlanSlotsInput> = {}): BuildGrowthPlanSlotsInput {
  return {
    periodStart: "2025-03-03",
    periodEnd: "2025-03-09",
    channels: { ...DISABLED_CHANNELS, x: true },
    cadence: { ...ZERO_CADENCE, x: 3 },
    pillars: [{ id: "product", label: "Product", weight: 100, description: "" }],
    postingWindows: [
      { weekday: 1, hour: 9 },
      { weekday: 3, hour: 12 },
      { weekday: 5, hour: 16 },
    ],
    timezone: "UTC",
    ...overrides,
  };
}

function sortedSlotIdentity(slot: { scheduledFor: string; channel: string; key: string }): string {
  return `${slot.scheduledFor}:${slot.channel}:${slot.key}`;
}

describe("growth plan periods", () => {
  it("defaults to the complete ISO week after the current week", () => {
    expect(nextGrowthPlanPeriod(new Date("2026-09-07T08:00:00.000Z"))).toEqual({
      periodStart: "2026-09-14",
      periodEnd: "2026-09-20",
    });
    expect(nextGrowthPlanPeriod(new Date("2026-09-13T23:00:00.000Z"), 2)).toEqual({
      periodStart: "2026-09-14",
      periodEnd: "2026-09-27",
    });
  });

  it("builds only one-to-four complete weeks from Monday", () => {
    expect(growthPlanPeriodFromStart("2026-09-14", 4)).toEqual({
      periodStart: "2026-09-14",
      periodEnd: "2026-10-11",
    });
    expect(() => growthPlanPeriodFromStart("2026-09-15", 1)).toThrow(RangeError);
    expect(() => growthPlanPeriodFromStart("2026-09-14", 5)).toThrow(RangeError);
  });
});

describe("buildGrowthPlanSlots", () => {
  it("creates stable, sorted slots with the format for every enabled channel", () => {
    const channels = Object.fromEntries(GROWTH_CHANNELS.map((channel) => [channel, true])) as GrowthChannelSelection;
    const cadence = Object.fromEntries(GROWTH_CHANNELS.map((channel) => [channel, 1])) as GrowthCadence;
    const input = slotInput({ channels, cadence, postingWindows: [{ weekday: 2, hour: 11 }] });

    const slots = buildGrowthPlanSlots(input);

    expect(slots).toHaveLength(6);
    expect(Object.fromEntries(slots.map(({ channel, format }) => [channel, format]))).toEqual({
      bluesky: "post",
      blog: "doc",
      discussion: "discussion",
      linkedin: "linkedin-post",
      mastodon: "mastodon-post",
      x: "x-thread",
    });
    expect(slots.map(sortedSlotIdentity)).toEqual([...slots].sort((left, right) => (
      left.scheduledFor.localeCompare(right.scheduledFor)
      || left.channel.localeCompare(right.channel)
      || left.key.localeCompare(right.key)
    )).map(sortedSlotIdentity));
    expect(new Set(slots.map(({ key }) => key)).size).toBe(slots.length);
    expect(JSON.stringify(buildGrowthPlanSlots(input))).toBe(JSON.stringify(slots));
  });

  it("multiplies enabled cadence by up to four complete weeks and ignores disabled or zero-cadence channels", () => {
    const slots = buildGrowthPlanSlots(slotInput({
      periodEnd: "2025-03-30",
      channels: { ...DISABLED_CHANNELS, x: true, linkedin: true, mastodon: true },
      cadence: { ...ZERO_CADENCE, x: 3, linkedin: 2, bluesky: 5 },
    }));

    expect(slots.filter(({ channel }) => channel === "x")).toHaveLength(12);
    expect(slots.filter(({ channel }) => channel === "linkedin")).toHaveLength(8);
    expect(slots.some(({ channel }) => channel === "mastodon")).toBe(false);
    expect(slots.some(({ channel }) => channel === "bluesky")).toBe(false);
  });

  it("sorts posting windows and spreads lower cadence across their range", () => {
    const slots = buildGrowthPlanSlots(slotInput({
      cadence: { ...ZERO_CADENCE, x: 2 },
      postingWindows: [
        { weekday: 5, hour: 16 },
        { weekday: 1, hour: 9 },
        { weekday: 3, hour: 12 },
        { weekday: 1, hour: 9 },
      ],
    }));

    expect(slots.map(({ scheduledFor }) => scheduledFor)).toEqual([
      "2025-03-03T09:00:00.000Z",
      "2025-03-07T16:00:00.000Z",
    ]);
  });

  it("uses an evenly spread 10:00 local fallback when posting windows are empty", () => {
    const slots = buildGrowthPlanSlots(slotInput({ postingWindows: [] }));

    expect(slots.map(({ scheduledFor }) => scheduledFor)).toEqual([
      "2025-03-03T10:00:00.000Z",
      "2025-03-05T10:00:00.000Z",
      "2025-03-07T10:00:00.000Z",
    ]);
  });

  it("converts local posting windows to UTC across a daylight-saving boundary", () => {
    const slots = buildGrowthPlanSlots(slotInput({
      periodStart: "2025-03-24",
      periodEnd: "2025-04-06",
      cadence: { ...ZERO_CADENCE, x: 1 },
      postingWindows: [{ weekday: 6, hour: 10 }],
      timezone: "Europe/Rome",
    }));

    expect(slots.map(({ scheduledFor }) => scheduledFor)).toEqual([
      "2025-03-29T09:00:00.000Z",
      "2025-04-05T08:00:00.000Z",
    ]);
  });

  it("allocates pillars by positive weight without selecting zero-weight pillars", () => {
    const slots = buildGrowthPlanSlots(slotInput({
      cadence: { ...ZERO_CADENCE, x: 6 },
      pillars: [
        { id: "ignored", label: "Ignored", weight: 0, description: "" },
        { id: "product", label: "Product", weight: 2, description: "" },
        { id: "community", label: "Community", weight: 1, description: "" },
      ],
    }));

    expect(slots.map(({ pillarId }) => pillarId)).toEqual([
      "product",
      "community",
      "product",
      "product",
      "community",
      "product",
    ]);
    expect(slots.some(({ pillarId }) => pillarId === "ignored")).toBe(false);
  });

  it.each([
    ["invalid date", { periodStart: "2025/03/03" }],
    ["invalid calendar date", { periodStart: "2025-02-31" }],
    ["non-Monday start", { periodStart: "2025-03-04" }],
    ["non-Sunday end", { periodEnd: "2025-03-08" }],
    ["more than four weeks", { periodEnd: "2025-04-06" }],
    ["reversed period", { periodStart: "2025-03-10" }],
  ])("rejects an %s", (_label, overrides) => {
    expect(() => buildGrowthPlanSlots(slotInput(overrides))).toThrow(RangeError);
  });

  it("rejects invalid timezones and profiles without a positive-weight pillar", () => {
    expect(() => buildGrowthPlanSlots(slotInput({ timezone: "Mars/Olympus" }))).toThrow("IANA timezone");
    expect(() => buildGrowthPlanSlots(slotInput({
      pillars: [{ id: "ignored", label: "Ignored", weight: 0, description: "" }],
    }))).toThrow("positive weight");
  });
});
