import { describe, expect, it } from "vitest";
import {
  GROWTH_UNASSIGNED_PILLAR_KEY,
  type GrowthContentPerformance,
} from "../../../src/types/growth";
import {
  parseUtcIsoDateTime,
  summarizeGrowthPerformance,
  type GrowthPerformanceSummaryContentItem,
} from "../../../src/utils/growth/performanceSummary";

const ZERO_METRICS = {
  starsDelta: 0,
  forksDelta: 0,
  closedPrsDelta: 0,
  releaseDownloadsDelta: 0,
};

function content(
  id: string,
  overrides: Partial<GrowthPerformanceSummaryContentItem> = {},
): GrowthPerformanceSummaryContentItem {
  return {
    accountId: "account-a",
    id,
    channel: "x",
    pillar: "product",
    status: "published",
    ...overrides,
  };
}

function performance(
  contentId: string,
  window: GrowthContentPerformance["window"],
  metrics: GrowthContentPerformance["metrics"],
  overrides: Partial<GrowthContentPerformance> = {},
): GrowthContentPerformance {
  return {
    accountId: "account-a",
    contentId,
    window,
    measuredAt: "2026-09-10T00:00:00.000Z",
    metrics,
    ...overrides,
  };
}

describe("Growth performance summaries", () => {
  it("parses only normalized UTC ISO date-times for shared range validation", () => {
    expect(parseUtcIsoDateTime("2026-09-01T00:00:00Z"))
      .toBe(Date.parse("2026-09-01T00:00:00.000Z"));
    expect(parseUtcIsoDateTime("2026-09-01T00:00:00.12Z"))
      .toBe(Date.parse("2026-09-01T00:00:00.120Z"));
    expect(parseUtcIsoDateTime("2026-02-30T00:00:00.000Z")).toBeNull();
    expect(parseUtcIsoDateTime("2026-09-01T00:00:00+00:00")).toBeNull();
  });

  it("keeps windows separate and aggregates stable channel and pillar groups", () => {
    const contentItems = [
      content("product-x"),
      content("unassigned-linkedin", { channel: "linkedin", pillar: "  " }),
      content("community-mastodon", { channel: "mastodon", pillar: "community" }),
      content("draft-blog", { channel: "blog", pillar: "engineering", status: "draft" }),
      content("unmeasured", { channel: "discussion", pillar: "community" }),
    ];
    const rows = [
      performance("product-x", "48h", { starsDelta: 99 }, {
        measuredAt: "2026-09-09T00:00:00.000Z",
      }),
      performance("product-x", "48h", { starsDelta: 5, forksDelta: -2 }),
      performance("product-x", "7d", { starsDelta: 10 }),
      performance("unassigned-linkedin", "48h", { starsDelta: -3, closedPrsDelta: 2 }),
      performance("community-mastodon", "7d", {
        forksDelta: -1,
        releaseDownloadsDelta: 7,
        customDelta: -2,
      }),
      performance("draft-blog", "48h", { starsDelta: 50 }),
      performance("unassigned-linkedin", "48h", { starsDelta: 500 }, { accountId: "account-b" }),
    ];

    const summary = summarizeGrowthPerformance(contentItems, rows);

    expect(summary.windows[0]).toEqual({
      window: "48h",
      measuredItems: 2,
      metrics: { ...ZERO_METRICS, starsDelta: 2, forksDelta: -2, closedPrsDelta: 2 },
      channels: [
        {
          key: "x",
          measuredItems: 1,
          metrics: { ...ZERO_METRICS, starsDelta: 5, forksDelta: -2 },
        },
        {
          key: "linkedin",
          measuredItems: 1,
          metrics: { ...ZERO_METRICS, starsDelta: -3, closedPrsDelta: 2 },
        },
      ],
      pillars: [
        {
          key: "product",
          measuredItems: 1,
          metrics: { ...ZERO_METRICS, starsDelta: 5, forksDelta: -2 },
        },
        {
          key: GROWTH_UNASSIGNED_PILLAR_KEY,
          measuredItems: 1,
          metrics: { ...ZERO_METRICS, starsDelta: -3, closedPrsDelta: 2 },
        },
      ],
    });
    expect(summary.windows[1]).toEqual({
      window: "7d",
      measuredItems: 2,
      metrics: {
        ...ZERO_METRICS,
        starsDelta: 10,
        forksDelta: -1,
        releaseDownloadsDelta: 7,
        customDelta: -2,
      },
      channels: [
        {
          key: "x",
          measuredItems: 1,
          metrics: { ...ZERO_METRICS, starsDelta: 10 },
        },
        {
          key: "mastodon",
          measuredItems: 1,
          metrics: {
            ...ZERO_METRICS,
            forksDelta: -1,
            releaseDownloadsDelta: 7,
            customDelta: -2,
          },
        },
      ],
      pillars: [
        {
          key: "community",
          measuredItems: 1,
          metrics: {
            ...ZERO_METRICS,
            forksDelta: -1,
            releaseDownloadsDelta: 7,
            customDelta: -2,
          },
        },
        {
          key: "product",
          measuredItems: 1,
          metrics: { ...ZERO_METRICS, starsDelta: 10 },
        },
      ],
    });
    expect(summarizeGrowthPerformance([...contentItems].reverse(), [...rows].reverse())).toEqual(summary);
  });

  it("counts one measured content item in each available window", () => {
    const item = content("both-windows");
    const summary = summarizeGrowthPerformance([item], [
      performance(item.id, "48h", { starsDelta: 2 }),
      performance(item.id, "7d", { starsDelta: 6 }),
    ]);

    expect(summary.windows.map(({ window, measuredItems, metrics }) => ({
      window,
      measuredItems,
      starsDelta: metrics.starsDelta,
    }))).toEqual([
      { window: "48h", measuredItems: 1, starsDelta: 2 },
      { window: "7d", measuredItems: 1, starsDelta: 6 },
    ]);
  });

  it("returns deterministic zero-valued windows for empty or unmeasured content", () => {
    expect(summarizeGrowthPerformance([content("unmeasured")], [])).toEqual({
      windows: [
        { window: "48h", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
        { window: "7d", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
      ],
    });
  });
});
