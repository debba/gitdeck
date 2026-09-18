import {
  GROWTH_CHANNELS,
  GROWTH_PERFORMANCE_METRIC_KEYS,
  GROWTH_PERFORMANCE_WINDOWS,
  GROWTH_UNASSIGNED_PILLAR_KEY,
  type GrowthContentItem,
  type GrowthContentPerformance,
  type GrowthPerformanceGroupSummary,
  type GrowthPerformanceMetrics,
  type GrowthPerformanceMetricTotals,
  type GrowthPerformanceSummary,
  type GrowthPerformanceWindow,
  type GrowthPerformanceWindowSummary,
} from "../../types/growth";

export type GrowthPerformanceSummaryContentItem = Pick<
  GrowthContentItem,
  "accountId" | "id" | "channel" | "pillar" | "status"
>;

interface MutableAggregate {
  measuredItems: number;
  metrics: Record<string, number>;
}

const CHANNEL_ORDER = new Map(
  [...GROWTH_CHANNELS, "other"].map((channel, index) => [channel, index]),
);

export function parseUtcIsoDateTime(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  const normalized = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  return new Date(timestamp).toISOString() === normalized ? timestamp : null;
}

function emptyMetrics(): Record<string, number> {
  return Object.fromEntries(GROWTH_PERFORMANCE_METRIC_KEYS.map((key) => [key, 0]));
}

function emptyAggregate(): MutableAggregate {
  return { measuredItems: 0, metrics: emptyMetrics() };
}

function addMetrics(target: MutableAggregate, metrics: GrowthPerformanceMetrics): void {
  target.measuredItems += 1;
  for (const [key, value] of Object.entries(metrics).sort(([left], [right]) => left.localeCompare(right, "en"))) {
    if (value === undefined || !Number.isFinite(value)) continue;
    target.metrics[key] = (target.metrics[key] ?? 0) + value;
  }
}

function stableMetrics(metrics: Record<string, number>): GrowthPerformanceMetricTotals {
  const known = new Set<string>(GROWTH_PERFORMANCE_METRIC_KEYS);
  const entries: Array<[string, number]> = GROWTH_PERFORMANCE_METRIC_KEYS.map((key) => [key, metrics[key] ?? 0]);
  entries.push(...Object.entries(metrics)
    .filter(([key]) => !known.has(key))
    .sort(([left], [right]) => left.localeCompare(right, "en")));
  return Object.fromEntries(entries) as GrowthPerformanceMetricTotals;
}

function groupSummary(key: string, aggregate: MutableAggregate): GrowthPerformanceGroupSummary {
  return {
    key,
    measuredItems: aggregate.measuredItems,
    metrics: stableMetrics(aggregate.metrics),
  };
}

function compareGroupKeys(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" }) || left.localeCompare(right, "en");
}

function compareChannelKeys(left: string, right: string): number {
  return (CHANNEL_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (CHANNEL_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
    || compareGroupKeys(left, right);
}

function comparePillarKeys(left: string, right: string): number {
  if (left === GROWTH_UNASSIGNED_PILLAR_KEY) return right === left ? 0 : 1;
  if (right === GROWTH_UNASSIGNED_PILLAR_KEY) return -1;
  return compareGroupKeys(left, right);
}

function performanceIdentity(performance: GrowthContentPerformance): string {
  return `${performance.accountId}\u0000${performance.contentId}\u0000${performance.window}`;
}

function metricFingerprint(performance: GrowthContentPerformance): string {
  const metrics = Object.entries(performance.metrics)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right, "en"));
  return JSON.stringify(metrics);
}

function isLaterMeasurement(
  candidate: GrowthContentPerformance,
  current: GrowthContentPerformance,
): boolean {
  const candidateTimestamp = Date.parse(candidate.measuredAt);
  const currentTimestamp = Date.parse(current.measuredAt);
  if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp;
  return metricFingerprint(candidate) > metricFingerprint(current);
}

function latestMeasurements(
  performanceRows: readonly GrowthContentPerformance[],
): GrowthContentPerformance[] {
  const selected = new Map<string, GrowthContentPerformance>();
  for (const performance of performanceRows) {
    const identity = performanceIdentity(performance);
    const current = selected.get(identity);
    if (!current || isLaterMeasurement(performance, current)) selected.set(identity, performance);
  }
  return [...selected.values()];
}

/** Aggregates measured published content without combining attribution windows. */
export function summarizeGrowthPerformance(
  contentItems: readonly GrowthPerformanceSummaryContentItem[],
  performanceRows: readonly GrowthContentPerformance[],
): GrowthPerformanceSummary {
  const publishedItems = new Map(
    contentItems
      .filter(({ status }) => status === "published")
      .map((item) => [`${item.accountId}\u0000${item.id}`, item]),
  );
  const summaries = new Map<GrowthPerformanceWindow, {
    total: MutableAggregate;
    channels: Map<string, MutableAggregate>;
    pillars: Map<string, MutableAggregate>;
  }>(GROWTH_PERFORMANCE_WINDOWS.map((window) => [window, {
    total: emptyAggregate(),
    channels: new Map(),
    pillars: new Map(),
  }]));

  for (const performance of latestMeasurements(performanceRows)) {
    const item = publishedItems.get(`${performance.accountId}\u0000${performance.contentId}`);
    const summary = summaries.get(performance.window);
    if (!item || !summary) continue;
    const pillar = item.pillar.trim() || GROWTH_UNASSIGNED_PILLAR_KEY;
    const channelAggregate = summary.channels.get(item.channel) ?? emptyAggregate();
    const pillarAggregate = summary.pillars.get(pillar) ?? emptyAggregate();
    addMetrics(summary.total, performance.metrics);
    addMetrics(channelAggregate, performance.metrics);
    addMetrics(pillarAggregate, performance.metrics);
    summary.channels.set(item.channel, channelAggregate);
    summary.pillars.set(pillar, pillarAggregate);
  }

  return {
    windows: GROWTH_PERFORMANCE_WINDOWS.map((window): GrowthPerformanceWindowSummary => {
      const summary = summaries.get(window)!;
      return {
        window,
        measuredItems: summary.total.measuredItems,
        metrics: stableMetrics(summary.total.metrics),
        channels: [...summary.channels.entries()]
          .sort(([left], [right]) => compareChannelKeys(left, right))
          .map(([key, aggregate]) => groupSummary(key, aggregate)),
        pillars: [...summary.pillars.entries()]
          .sort(([left], [right]) => comparePillarKeys(left, right))
          .map(([key, aggregate]) => groupSummary(key, aggregate)),
      };
    }),
  };
}
