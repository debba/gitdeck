import { describe, expect, it } from "vitest";
import type { GrowthPillar } from "../../../src/types/growth";
import {
  adjustGrowthPillarWeights,
  type GrowthPillarPerformanceMeasurement,
} from "../../../src/utils/growth/performanceWeights";

const PILLARS: GrowthPillar[] = [
  { id: "product", label: "Product", weight: 50, description: "Product outcomes" },
  { id: "community", label: "Community", weight: 50, description: "Contributor stories" },
];

function measurement(
  contentId: string,
  pillarId: string,
  starsDelta: number,
  forksDelta: number,
  overrides: Partial<GrowthPillarPerformanceMeasurement> = {},
): GrowthPillarPerformanceMeasurement {
  return {
    contentId,
    pillarId,
    publishedAt: "2026-08-10T12:00:00.000Z",
    measuredAt: "2026-08-18T00:00:00.000Z",
    window: "7d",
    metrics: { starsDelta, forksDelta },
    ...overrides,
  };
}

describe("Growth performance pillar weights", () => {
  it("bounds outliers and signed negative results while preserving the configured total", () => {
    const result = adjustGrowthPillarWeights(PILLARS, [
      measurement("product-1", "product", 1_000_000, 0),
      measurement("product-2", "product", 100, 0),
      measurement("community-1", "community", -1_000, -100),
      measurement("community-2", "community", -200, -50),
    ], "2026-09-07");

    expect(result).toEqual({
      weightsAdjusted: true,
      pillars: [
        { ...PILLARS[0], weight: 60 },
        { ...PILLARS[1], weight: 40 },
      ],
    });
    expect(result.pillars.reduce((sum, pillar) => sum + pillar.weight, 0)).toBe(100);
  });

  it("redistributes integer rounding deterministically in profile order", () => {
    const pillars = [
      { id: "a", label: "A", weight: 34, description: "" },
      { id: "b", label: "B", weight: 33, description: "" },
      { id: "c", label: "C", weight: 33, description: "" },
    ];
    const rows = [
      measurement("a", "a", 10, 0),
      measurement("b", "b", 0, 0),
      measurement("c", "c", -10, 0),
    ];

    expect(adjustGrowthPillarWeights(pillars, rows, "2026-09-07").pillars.map(({ weight }) => weight))
      .toEqual([41, 33, 26]);
    expect(adjustGrowthPillarWeights(pillars, [...rows].reverse(), "2026-09-07").pillars.map(({ weight }) => weight))
      .toEqual([41, 33, 26]);
  });

  it("includes the eight-week lower edge and excludes results not complete before the plan", () => {
    const result = adjustGrowthPillarWeights(PILLARS, [
      measurement("lower-edge", "product", 10, 0, {
        publishedAt: "2026-07-13T00:00:00.000Z",
      }),
      measurement("recent", "product", 10, 0),
      measurement("community", "community", 0, 0),
      measurement("too-old", "community", 10_000, 0, {
        publishedAt: "2026-07-12T23:59:59.999Z",
      }),
      measurement("plan-edge", "community", 10_000, 0, {
        publishedAt: "2026-09-07T00:00:00.000Z",
      }),
      measurement("measured-at-plan", "community", 10_000, 0, {
        measuredAt: "2026-09-07T00:00:00.000Z",
      }),
    ], "2026-09-07");

    expect(result.weightsAdjusted).toBe(true);
    expect(result.pillars.map(({ weight }) => weight)).toEqual([58, 42]);
  });

  it("retains configured weights for sparse, unknown, incomplete, or unusable samples", () => {
    const pillars = [
      ...PILLARS,
      { id: "paused", label: "Paused", weight: 0, description: "" },
    ];
    const unusable = [
      measurement("known", "product", 5, 1),
      measurement("unknown", "other", 500, 500),
      measurement("short", "community", 500, 500, { window: "48h" }),
      measurement("missing-forks", "community", 5, 0, { metrics: { starsDelta: 5 } }),
    ];

    const result = adjustGrowthPillarWeights(pillars, unusable, "2026-09-07");
    expect(result).toEqual({ pillars, weightsAdjusted: false });
    expect(result.pillars).not.toBe(pillars);
    expect(result.pillars[2].weight).toBe(0);
  });

  it("retains weights when all usable pillar averages are equal", () => {
    const result = adjustGrowthPillarWeights(PILLARS, [
      measurement("product-1", "product", 4, -1),
      measurement("product-2", "product", 2, 1),
      measurement("community-1", "community", 3, 0),
    ], "2026-09-07");

    expect(result).toEqual({ pillars: PILLARS, weightsAdjusted: false });
  });
});
