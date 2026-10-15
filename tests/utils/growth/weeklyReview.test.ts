import { describe, expect, it } from "vitest";
import type {
  GrowthContentItem,
  GrowthContentPerformance,
  GrowthIntervention,
  GrowthPerformanceSummary,
} from "../../../src/types/growth";
import {
  buildGrowthWeeklyReview,
  buildUtcIsoReviewWeekRanges,
} from "../../../src/utils/growth/weeklyReview";

const ZERO_METRICS = {
  starsDelta: 0,
  forksDelta: 0,
  closedPrsDelta: 0,
  releaseDownloadsDelta: 0,
};

function content(id: string, overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id,
    accountId: "account-a",
    repository: "acme/rocket",
    planId: "plan-1",
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Explain the release",
    title: `Content ${id}`,
    summary: "",
    body: "",
    threadPosts: [],
    media: [],
    sources: [],
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function performance(
  contentId: string,
  window: "48h" | "7d",
  metrics: Record<string, number>,
  accountId = "account-a",
): GrowthContentPerformance {
  return {
    accountId,
    contentId,
    window,
    measuredAt: "2026-09-16T00:00:00.000Z",
    metrics,
  };
}

function intervention(): GrowthIntervention {
  return {
    id: "intervention-1",
    accountId: "account-a",
    repository: "acme/rocket",
    goalId: null,
    category: "marketing",
    title: "Share contributor outcomes",
    action: "Turn one accepted contribution into a source-grounded story.",
    origin: "manual",
    ruleKey: null,
    dedupeKey: "intervention-1",
    status: "accepted",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function summary(): GrowthPerformanceSummary {
  return {
    windows: [
      {
        window: "48h",
        measuredItems: 1,
        metrics: { ...ZERO_METRICS, starsDelta: 3 },
        channels: [{ key: "x", measuredItems: 1, metrics: { ...ZERO_METRICS, starsDelta: 3 } }],
        pillars: [{ key: "product", measuredItems: 1, metrics: { ...ZERO_METRICS, starsDelta: 3 } }],
      },
      {
        window: "7d",
        measuredItems: 1,
        metrics: { ...ZERO_METRICS, starsDelta: 8, forksDelta: 1 },
        channels: [{ key: "linkedin", measuredItems: 1, metrics: { ...ZERO_METRICS, starsDelta: 8, forksDelta: 1 } }],
        pillars: [{ key: "community", measuredItems: 1, metrics: { ...ZERO_METRICS, starsDelta: 8, forksDelta: 1 } }],
      },
    ],
  };
}

const clock = () => new Date("2026-09-16T15:45:00.000Z");

describe("weekly Growth Review", () => {
  it("builds previous and current complete UTC ISO-week ranges across year boundaries", () => {
    expect(buildUtcIsoReviewWeekRanges(() => new Date("2027-01-01T12:00:00.000Z"))).toEqual({
      generatedAt: "2027-01-01T12:00:00.000Z",
      reviewPeriod: {
        start: "2026-12-21T00:00:00.000Z",
        end: "2026-12-27T23:59:59.999Z",
      },
      upcomingPeriod: {
        start: "2026-12-28T00:00:00.000Z",
        end: "2027-01-03T23:59:59.999Z",
      },
    });
    expect(() => buildUtcIsoReviewWeekRanges(() => new Date("invalid")))
      .toThrow("clock must return a valid date");
  });

  it("keeps measured windows separate and models publications, misses, upcoming work, and findings", () => {
    const published = content("published", {
      status: "published",
      scheduledFor: "2026-09-08T10:00:00.000Z",
      publishedAt: "2026-09-08T10:30:00.000Z",
      publishedUrl: "https://social.example/1",
    });
    const review = buildGrowthWeeklyReview({
      repository: "acme/rocket",
      contentItems: [
        published,
        content("missed", { scheduledFor: "2026-09-10T10:00:00.000Z" }),
        content("late", {
          status: "published",
          scheduledFor: "2026-09-11T10:00:00.000Z",
          publishedAt: "2026-09-14T09:00:00.000Z",
        }),
        content("upcoming", { status: "ready", scheduledFor: "2026-09-18T10:00:00.000Z" }),
        content("outside", { scheduledFor: "2026-09-21T10:00:00.000Z" }),
      ],
      performanceRows: [
        performance(published.id, "48h", { starsDelta: 3 }),
        performance(published.id, "7d", { starsDelta: 8, forksDelta: 1 }),
        performance(published.id, "48h", { starsDelta: 999 }, "account-b"),
      ],
      performanceSummary: summary(),
      interventions: [intervention()],
    }, clock);

    expect(review.repository).toBe("acme/rocket");
    expect(review.publishedItems).toHaveLength(1);
    expect(review.publishedItems[0].performance).toEqual([
      { window: "48h", measuredAt: "2026-09-16T00:00:00.000Z", metrics: { ...ZERO_METRICS, starsDelta: 3 } },
      { window: "7d", measuredAt: "2026-09-16T00:00:00.000Z", metrics: { ...ZERO_METRICS, starsDelta: 8, forksDelta: 1 } },
    ]);
    expect(review.missedItems.map(({ id }) => id)).toEqual(["missed", "late"]);
    expect(review.upcomingItems.map(({ id }) => id)).toEqual(["upcoming"]);
    expect(review.channelFindings.map(({ window, key, direction }) => ({ window, key, direction }))).toEqual([
      { window: "48h", key: "x", direction: "positive" },
      { window: "7d", key: "linkedin", direction: "positive" },
    ]);
    expect(review.pillarFindings.map(({ window, key }) => ({ window, key }))).toEqual([
      { window: "48h", key: "product" },
      { window: "7d", key: "community" },
    ]);
    expect(review.recommendations).toHaveLength(3);
    expect(review.recommendations.map(({ kind }) => kind)).toEqual([
      "recover-missed",
      "repeat-channel",
      "reinforce-pillar",
    ]);
    expect(review.narrative).toContain("measured attribution available for 1");
    expect(review.empty).toBe(false);
  });

  it("returns useful bounded empty-review data without inventing measurements", () => {
    const review = buildGrowthWeeklyReview({
      contentItems: [],
      performanceRows: [],
      performanceSummary: {
        windows: [
          { window: "48h", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
          { window: "7d", measuredItems: 0, metrics: ZERO_METRICS, channels: [], pillars: [] },
        ],
      },
      interventions: [intervention()],
    }, clock);

    expect(review.empty).toBe(true);
    expect(review.publishedItems).toEqual([]);
    expect(review.channelFindings).toEqual([]);
    expect(review.pillarFindings).toEqual([]);
    expect(review.narrative).toContain("No content was published");
    expect(review.narrative).toContain("without inventing results");
    expect(review.recommendations).toHaveLength(3);
    expect(review.recommendations[0]).toMatchObject({
      kind: "advance-intervention",
      repository: "acme/rocket",
    });
    expect(review.recommendations.every(({ title, action }) => title.length <= 120 && action.length <= 320))
      .toBe(true);
  });
});
