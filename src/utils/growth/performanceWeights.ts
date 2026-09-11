import type {
  GrowthPerformanceMetrics,
  GrowthPerformanceWindow,
  GrowthPillar,
} from "../../types/growth";

const DAY_MS = 24 * 60 * 60 * 1_000;
const LOOKBACK_MS = 8 * 7 * DAY_MS;
const MAX_BIAS = 0.2;

export interface GrowthPillarPerformanceMeasurement {
  contentId: string;
  pillarId: string;
  publishedAt: string;
  measuredAt: string;
  window: GrowthPerformanceWindow;
  metrics: GrowthPerformanceMetrics;
}

export interface GrowthPillarWeightAdjustment {
  pillars: GrowthPillar[];
  weightsAdjusted: boolean;
}

interface PillarScore {
  count: number;
  total: number;
}

function copyPillars(pillars: readonly GrowthPillar[]): GrowthPillar[] {
  return pillars.map((pillar) => ({ ...pillar }));
}

function planStartTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString().startsWith(`${value}T00:00:00.000Z`)
    ? timestamp
    : null;
}

function measurementScore(metrics: GrowthPerformanceMetrics): number | null {
  const { starsDelta, forksDelta } = metrics;
  if (!Number.isFinite(starsDelta) || !Number.isFinite(forksDelta)) return null;
  const score = starsDelta! + forksDelta!;
  return Number.isFinite(score) ? score : null;
}

function stableIntegerWeights(
  pillars: readonly GrowthPillar[],
  multipliers: ReadonlyMap<string, number>,
): number[] {
  const positiveTotal = pillars.reduce((total, pillar) => (
    pillar.weight > 0 ? total + pillar.weight : total
  ), 0);
  const biased = pillars.map((pillar) => (
    pillar.weight > 0 ? pillar.weight * (multipliers.get(pillar.id) ?? 1) : 0
  ));
  const biasedTotal = biased.reduce((total, weight) => total + weight, 0);
  if (!Number.isFinite(biasedTotal) || biasedTotal <= 0) return pillars.map(({ weight }) => weight);

  const normalized = biased.map((weight) => weight * positiveTotal / biasedTotal);
  const integerWeights = normalized.map((weight, index) => (
    pillars[index].weight > 0 ? Math.floor(weight) : 0
  ));
  let remainder = positiveTotal - integerWeights.reduce((total, weight) => total + weight, 0);
  const order = normalized
    .map((weight, index) => ({ index, fraction: weight - Math.floor(weight) }))
    .filter(({ index }) => pillars[index].weight > 0)
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remainder; index += 1) {
    integerWeights[order[index % order.length].index] += 1;
  }
  return integerWeights;
}

/** Biases configured pillar weights using complete, recent 7-day star and fork results. */
export function adjustGrowthPillarWeights(
  pillars: readonly GrowthPillar[],
  measurements: readonly GrowthPillarPerformanceMeasurement[],
  periodStart: string,
): GrowthPillarWeightAdjustment {
  const unchanged = copyPillars(pillars);
  const start = planStartTimestamp(periodStart);
  if (start === null) return { pillars: unchanged, weightsAdjusted: false };
  const earliest = start - LOOKBACK_MS;
  const positivePillars = new Set(
    pillars.filter(({ weight }) => Number.isFinite(weight) && weight > 0).map(({ id }) => id),
  );
  const scores = new Map<string, PillarScore>();
  let measuredItems = 0;
  let totalScore = 0;

  for (const measurement of measurements) {
    if (measurement.window !== "7d" || !positivePillars.has(measurement.pillarId)) continue;
    const publishedAt = Date.parse(measurement.publishedAt);
    const measuredAt = Date.parse(measurement.measuredAt);
    const score = measurementScore(measurement.metrics);
    if (
      Number.isNaN(publishedAt)
      || Number.isNaN(measuredAt)
      || publishedAt < earliest
      || publishedAt >= start
      || measuredAt >= start
      || score === null
    ) continue;
    const aggregate = scores.get(measurement.pillarId) ?? { count: 0, total: 0 };
    aggregate.count += 1;
    aggregate.total += score;
    scores.set(measurement.pillarId, aggregate);
    measuredItems += 1;
    totalScore += score;
  }

  if (measuredItems < 3 || scores.size < 2) {
    return { pillars: unchanged, weightsAdjusted: false };
  }

  const overallAverage = totalScore / measuredItems;
  const averages = new Map(
    [...scores].map(([pillarId, score]) => [pillarId, score.total / score.count]),
  );
  const maxDeviation = Math.max(...[...averages.values()].map((average) => (
    Math.abs(average - overallAverage)
  )));
  if (!Number.isFinite(overallAverage) || !Number.isFinite(maxDeviation) || maxDeviation === 0) {
    return { pillars: unchanged, weightsAdjusted: false };
  }

  const multipliers = new Map<string, number>();
  for (const pillar of pillars) {
    const average = averages.get(pillar.id);
    if (average === undefined || pillar.weight <= 0) {
      multipliers.set(pillar.id, 1);
      continue;
    }
    const multiplier = 1 + MAX_BIAS * (average - overallAverage) / maxDeviation;
    multipliers.set(pillar.id, Math.min(1.2, Math.max(0.8, multiplier)));
  }

  const integerWeights = stableIntegerWeights(pillars, multipliers);
  const adjusted = pillars.map((pillar, index) => ({ ...pillar, weight: integerWeights[index] }));
  return {
    pillars: adjusted,
    weightsAdjusted: adjusted.some((pillar, index) => pillar.weight !== pillars[index].weight),
  };
}
