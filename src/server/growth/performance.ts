import type {
  GrowthPerformanceSummary,
  GrowthPerformanceSummaryFilters,
  GrowthPillar,
} from "../../types/growth";
import {
  adjustGrowthPillarWeights,
  type GrowthPillarWeightAdjustment,
} from "../../utils/growth/performanceWeights";
import {
  parseUtcIsoDateTime,
  summarizeGrowthPerformance,
} from "../../utils/growth/performanceSummary";
import { listContentItems, listContentPerformance } from "./store";

/** Reads repository-scoped history and derives the pillar snapshot for a future plan. */
export function getPerformanceAdjustedPillars(
  accountId: string,
  repository: string,
  pillars: readonly GrowthPillar[],
  periodStart: string,
): GrowthPillarWeightAdjustment {
  const contentItems = listContentItems(accountId, {
    repository,
    status: "published",
  });
  const contentById = new Map(contentItems.map((item) => [item.id, item]));
  const measurements = listContentPerformance(accountId, {
    repository,
    window: "7d",
  }).flatMap((performance) => {
    const item = contentById.get(performance.contentId);
    if (!item?.publishedAt) return [];
    return [{
      contentId: item.id,
      pillarId: item.pillar,
      publishedAt: item.publishedAt,
      measuredAt: performance.measuredAt,
      window: performance.window,
      metrics: performance.metrics,
    }];
  });
  return adjustGrowthPillarWeights(pillars, measurements, periodStart);
}

function rangeTimestamp(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const timestamp = parseUtcIsoDateTime(value);
  if (timestamp === null) throw new RangeError(`invalid performance ${label}`);
  return timestamp;
}

/** Reads already measured account-owned performance without refreshing attribution. */
export function getGrowthPerformanceSummary(
  accountId: string,
  filters: GrowthPerformanceSummaryFilters = {},
): GrowthPerformanceSummary {
  const from = rangeTimestamp(filters.from, "from date");
  const to = rangeTimestamp(filters.to, "to date");
  if (from !== undefined && to !== undefined && from > to) {
    throw new RangeError("invalid performance date range");
  }

  const contentItems = listContentItems(accountId, {
    repository: filters.repository,
    status: "published",
  }).filter((item) => {
    if (from === undefined && to === undefined) return true;
    if (!item.publishedAt) return false;
    const publishedAt = Date.parse(item.publishedAt);
    return !Number.isNaN(publishedAt)
      && (from === undefined || publishedAt >= from)
      && (to === undefined || publishedAt <= to);
  });
  const includedContentIds = new Set(contentItems.map(({ id }) => id));
  const performance = listContentPerformance(accountId, {
    repository: filters.repository,
  }).filter(({ contentId }) => includedContentIds.has(contentId));

  return summarizeGrowthPerformance(contentItems, performance);
}
