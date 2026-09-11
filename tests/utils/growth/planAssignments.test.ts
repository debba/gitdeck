import { describe, expect, it } from "vitest";
import type { GrowthPillar, GrowthPlanSlot } from "../../../src/types/growth";
import { normalizeGrowthPlanAssignments } from "../../../src/utils/growth/planAssignments";

const pillars: GrowthPillar[] = [
  { id: "product", label: "Product", weight: 70, description: "" },
  { id: "community", label: "Community", weight: 30, description: "" },
  { id: "disabled", label: "Disabled", weight: 0, description: "" },
];
const slots: GrowthPlanSlot[] = [
  { key: "2026-09-07:x:01", channel: "x", format: "x-thread", pillarId: "product", scheduledFor: "2026-09-07T10:00:00.000Z" },
  { key: "2026-09-07:linkedin:01", channel: "linkedin", format: "linkedin-post", pillarId: "community", scheduledFor: "2026-09-09T10:00:00.000Z" },
];
const evidence = [
  { label: "Release v2", url: "https://example.com/releases/v2" },
  { label: "Contributor guide", url: "https://example.com/contributing" },
];

describe("normalizeGrowthPlanAssignments", () => {
  it("accepts one assignment per known slot and constrains pillars and sources to evidence", () => {
    const result = normalizeGrowthPlanAssignments("acme/rocket", slots, pillars, evidence, [
      {
        slotKey: slots[0].key,
        pillarId: "community",
        angle: "  A verified\nrelease angle  ",
        sources: ["https://example.com/releases/v2", "https://fabricated.example/claim"],
        cta: "  Try the release  ",
      },
      {
        slotKey: slots[1].key,
        pillarId: "disabled",
        angle: "Welcome contributors",
        sources: [],
        cta: "Read the guide",
      },
    ]);

    expect(result.usedFallback).toBe(false);
    expect(result.assignments).toEqual([
      {
        slotKey: slots[0].key,
        pillarId: "community",
        angle: "A verified release angle",
        sources: ["https://example.com/releases/v2"],
        cta: "Try the release",
      },
      {
        slotKey: slots[1].key,
        pillarId: "community",
        angle: "Welcome contributors",
        sources: [],
        cta: "Read the guide",
      },
    ]);
  });

  it("fills missing or unusable assignments with stable evidence-grounded values", () => {
    const first = normalizeGrowthPlanAssignments("acme/rocket", slots, pillars, evidence, [
      { slotKey: slots[0].key, pillarId: "product", angle: "", sources: [], cta: "Read more" },
      { slotKey: "unknown", pillarId: "product", angle: "Ignore", sources: [], cta: "Ignore" },
    ]);
    const second = normalizeGrowthPlanAssignments("acme/rocket", slots, pillars, evidence, []);

    expect(first.usedFallback).toBe(true);
    expect(first.assignments).toEqual(second.assignments);
    expect(first.assignments).toEqual([
      expect.objectContaining({
        slotKey: slots[0].key,
        pillarId: "product",
        angle: "Highlight Release v2 through the Product pillar.",
        sources: ["https://example.com/releases/v2"],
      }),
      expect.objectContaining({
        slotKey: slots[1].key,
        pillarId: "community",
        angle: "Highlight Contributor guide through the Community pillar.",
        sources: ["https://example.com/contributing"],
      }),
    ]);
  });
});
