import {
  GROWTH_PERFORMANCE_METRIC_KEYS,
  GROWTH_PERFORMANCE_WINDOWS,
  type GrowthContentItem,
  type GrowthContentPerformance,
  type GrowthIntervention,
  type GrowthPerformanceGroupSummary,
  type GrowthPerformanceMetricTotals,
  type GrowthPerformanceMetrics,
  type GrowthPerformanceSummary,
  type GrowthPerformanceWindow,
  type GrowthReviewContentItem,
  type GrowthReviewFinding,
  type GrowthReviewPeriod,
  type GrowthReviewPublishedItem,
  type GrowthReviewRecommendation,
  type GrowthWeeklyReview,
} from "../../types/growth";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_RECOMMENDATION_TITLE = 120;
const MAX_RECOMMENDATION_ACTION = 320;
const MAX_NARRATIVE = 600;

export interface GrowthReviewWeekRanges {
  generatedAt: string;
  reviewPeriod: GrowthReviewPeriod;
  upcomingPeriod: GrowthReviewPeriod;
}

export interface BuildGrowthWeeklyReviewInput {
  repository?: string;
  contentItems: readonly GrowthContentItem[];
  performanceRows: readonly GrowthContentPerformance[];
  performanceSummary: GrowthPerformanceSummary;
  interventions: readonly GrowthIntervention[];
}

function bounded(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function period(start: number, end: number): GrowthReviewPeriod {
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** Builds the previous complete UTC ISO week and the current UTC ISO week. */
export function buildUtcIsoReviewWeekRanges(clock: () => Date): GrowthReviewWeekRanges {
  const now = clock();
  const timestamp = now.getTime();
  if (Number.isNaN(timestamp)) throw new RangeError("clock must return a valid date");
  const currentDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const currentWeekStart = currentDayStart - daysSinceMonday * DAY_MS;
  const nextWeekStart = currentWeekStart + 7 * DAY_MS;
  const previousWeekStart = currentWeekStart - 7 * DAY_MS;
  return {
    generatedAt: now.toISOString(),
    reviewPeriod: period(previousWeekStart, currentWeekStart - 1),
    upcomingPeriod: period(currentWeekStart, nextWeekStart - 1),
  };
}

function timestampInPeriod(value: string | null, range: GrowthReviewPeriod): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp)
    && timestamp >= Date.parse(range.start)
    && timestamp <= Date.parse(range.end);
}

function reviewItem(item: GrowthContentItem): GrowthReviewContentItem {
  return {
    id: item.id,
    repository: item.repository,
    title: bounded(item.title || item.angle || "Untitled content", 180),
    channel: item.channel,
    pillar: bounded(item.pillar, 100),
    status: item.status,
    scheduledFor: item.scheduledFor,
    publishedAt: item.publishedAt,
    publishedUrl: item.publishedUrl,
  };
}

function compareItems(
  left: GrowthReviewContentItem,
  right: GrowthReviewContentItem,
  date: "scheduledFor" | "publishedAt",
): number {
  return Date.parse(left[date] ?? "") - Date.parse(right[date] ?? "")
    || left.repository.localeCompare(right.repository, "en")
    || left.id.localeCompare(right.id, "en");
}

function stableMetrics(metrics: GrowthPerformanceMetrics): GrowthPerformanceMetricTotals {
  const known = new Set<string>(GROWTH_PERFORMANCE_METRIC_KEYS);
  const entries: Array<[string, number]> = GROWTH_PERFORMANCE_METRIC_KEYS.map((key) => [
    key,
    Number.isFinite(metrics[key]) ? metrics[key] as number : 0,
  ]);
  entries.push(...Object.entries(metrics)
    .filter((entry): entry is [string, number] => !known.has(entry[0]) && Number.isFinite(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right, "en")));
  return Object.fromEntries(entries) as GrowthPerformanceMetricTotals;
}

function performanceFingerprint(row: GrowthContentPerformance): string {
  return JSON.stringify(Object.entries(row.metrics)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right, "en")));
}

function latestPerformanceRows(
  rows: readonly GrowthContentPerformance[],
): Map<string, GrowthContentPerformance> {
  const latest = new Map<string, GrowthContentPerformance>();
  for (const row of rows) {
    const key = `${row.accountId}\u0000${row.contentId}\u0000${row.window}`;
    const current = latest.get(key);
    if (
      !current
      || Date.parse(row.measuredAt) > Date.parse(current.measuredAt)
      || (row.measuredAt === current.measuredAt && performanceFingerprint(row) > performanceFingerprint(current))
    ) latest.set(key, row);
  }
  return latest;
}

function metricImpact(metrics: GrowthPerformanceMetricTotals): number {
  return Object.values(metrics).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function strongestGroup(groups: readonly GrowthPerformanceGroupSummary[]): GrowthPerformanceGroupSummary | null {
  return [...groups].sort((left, right) =>
    metricImpact(right.metrics) - metricImpact(left.metrics)
    || right.measuredItems - left.measuredItems
    || left.key.localeCompare(right.key, "en", { sensitivity: "base" })
    || left.key.localeCompare(right.key, "en"))[0] ?? null;
}

function finding(
  dimension: GrowthReviewFinding["dimension"],
  window: GrowthPerformanceWindow,
  group: GrowthPerformanceGroupSummary,
): GrowthReviewFinding {
  const impact = metricImpact(group.metrics);
  return {
    dimension,
    window,
    key: group.key,
    measuredItems: group.measuredItems,
    metrics: group.metrics,
    direction: impact > 0 ? "positive" : impact < 0 ? "negative" : "neutral",
  };
}

function buildFindings(
  summary: GrowthPerformanceSummary,
  dimension: GrowthReviewFinding["dimension"],
): GrowthReviewFinding[] {
  return GROWTH_PERFORMANCE_WINDOWS.flatMap((window) => {
    const windowSummary = summary.windows.find((candidate) => candidate.window === window);
    const strongest = strongestGroup(windowSummary?.[dimension === "channel" ? "channels" : "pillars"] ?? []);
    return strongest ? [finding(dimension, window, strongest)] : [];
  });
}

function recommendation(
  id: string,
  kind: GrowthReviewRecommendation["kind"],
  title: string,
  action: string,
  repository: string | null,
): GrowthReviewRecommendation {
  return {
    id,
    kind,
    title: bounded(title, MAX_RECOMMENDATION_TITLE),
    action: bounded(action, MAX_RECOMMENDATION_ACTION),
    repository,
  };
}

function sharedRepository(items: readonly GrowthReviewContentItem[]): string | null {
  const repositories = new Set(items.map((item) => item.repository));
  return repositories.size === 1 ? [...repositories][0] : null;
}

function preferredFinding(findings: readonly GrowthReviewFinding[]): GrowthReviewFinding | null {
  return findings.find(({ window }) => window === "7d") ?? findings[0] ?? null;
}

function buildRecommendations(input: {
  publishedItems: readonly GrowthReviewPublishedItem[];
  missedItems: readonly GrowthReviewContentItem[];
  upcomingItems: readonly GrowthReviewContentItem[];
  channelFindings: readonly GrowthReviewFinding[];
  pillarFindings: readonly GrowthReviewFinding[];
  interventions: readonly GrowthIntervention[];
}): GrowthReviewRecommendation[] {
  const candidates: GrowthReviewRecommendation[] = [];
  const measuredItems = new Set(input.publishedItems
    .filter((item) => item.performance.length > 0)
    .map((item) => item.id)).size;

  if (input.missedItems.length > 0) {
    candidates.push(recommendation(
      "recover-missed",
      "recover-missed",
      `Recover ${input.missedItems.length} missed content ${input.missedItems.length === 1 ? "item" : "items"}`,
      "Reschedule the highest-priority missed item, finish its media, and keep its editorial status explicit.",
      sharedRepository(input.missedItems),
    ));
  }

  const channel = preferredFinding(input.channelFindings);
  if (channel) {
    candidates.push(recommendation(
      `repeat-channel:${channel.key}`,
      "repeat-channel",
      `Repeat the strongest ${channel.window} channel signal`,
      `Plan one evidence-led follow-up for ${channel.key}; its measured combined delta was ${metricImpact(channel.metrics)} across ${channel.measuredItems} ${channel.measuredItems === 1 ? "item" : "items"}.`,
      null,
    ));
  }

  const pillar = preferredFinding(input.pillarFindings);
  if (pillar) {
    candidates.push(recommendation(
      `reinforce-pillar:${pillar.key}`,
      "reinforce-pillar",
      `Reinforce the ${pillar.key} pillar`,
      `Keep the next test focused on this pillar, then compare its ${pillar.window} measured deltas before changing the profile weights.`,
      null,
    ));
  }

  if (input.upcomingItems.length > 0) {
    candidates.push(recommendation(
      "prepare-upcoming",
      "prepare-upcoming",
      `Prepare ${input.upcomingItems.length} upcoming content ${input.upcomingItems.length === 1 ? "item" : "items"}`,
      "Complete copy and mandatory media before the scheduled time, then publish manually and record the result.",
      sharedRepository(input.upcomingItems),
    ));
  }

  const intervention = [...input.interventions]
    .filter(({ status }) => status === "accepted" || status === "proposed")
    .sort((left, right) => Number(right.status === "accepted") - Number(left.status === "accepted")
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id))[0];
  if (intervention) {
    candidates.push(recommendation(
      `advance-intervention:${intervention.id}`,
      "advance-intervention",
      `Advance: ${intervention.title}`,
      intervention.action,
      intervention.repository,
    ));
  }

  if (input.publishedItems.length > measuredItems) {
    candidates.push(recommendation(
      "measure-results",
      "measure-results",
      "Complete the measurement baseline",
      `Keep attribution current for ${input.publishedItems.length - measuredItems} published ${input.publishedItems.length - measuredItems === 1 ? "item" : "items"} without a measured window; do not infer missing deltas.`,
      sharedRepository(input.publishedItems),
    ));
  }

  candidates.push(
    recommendation(
      "build-baseline:plan",
      "build-baseline",
      "Plan one measurable story",
      "Choose one repository signal, one audience, and one content pillar for the next complete UTC week.",
      null,
    ),
    recommendation(
      "build-baseline:publish",
      "build-baseline",
      "Prepare copy and media together",
      "Move one item from idea to ready with source-grounded copy, accessible media, and a clear manual publishing time.",
      null,
    ),
    recommendation(
      "build-baseline:learn",
      "build-baseline",
      "Close the measurement loop",
      "After manual publication, record the URL and review real 48-hour and 7-day deltas before changing cadence.",
      null,
    ),
  );

  const unique = new Map(candidates.map((item) => [item.id, item]));
  return [...unique.values()].slice(0, 3);
}

function deterministicNarrative(input: {
  published: number;
  measured: number;
  missed: number;
  upcoming: number;
}): string {
  if (input.published === 0) {
    return bounded(
      `No content was published during the reviewed week. ${input.missed} planned ${input.missed === 1 ? "item was" : "items were"} missed, and ${input.upcoming} ${input.upcoming === 1 ? "item is" : "items are"} scheduled for the current week. Use the next actions to establish a measurable baseline without inventing results.`,
      MAX_NARRATIVE,
    );
  }
  if (input.measured === 0) {
    return bounded(
      `${input.published} content ${input.published === 1 ? "item was" : "items were"} published during the reviewed week, but no 48-hour or 7-day measurements are available. Keep the missing deltas pending rather than estimating them.`,
      MAX_NARRATIVE,
    );
  }
  return bounded(
    `${input.published} content ${input.published === 1 ? "item was" : "items were"} published during the reviewed week, with measured attribution available for ${input.measured}. Review each window separately, recover ${input.missed} missed ${input.missed === 1 ? "item" : "items"}, and prepare ${input.upcoming} current-week ${input.upcoming === 1 ? "item" : "items"}.`,
    MAX_NARRATIVE,
  );
}

/** Builds a deterministic, read-only weekly review from already persisted facts. */
export function buildGrowthWeeklyReview(
  input: BuildGrowthWeeklyReviewInput,
  clock: () => Date,
): GrowthWeeklyReview {
  const ranges = buildUtcIsoReviewWeekRanges(clock);
  const latestRows = latestPerformanceRows(input.performanceRows);
  const publishedSourceItems = input.contentItems
    .filter((item) => item.status === "published" && timestampInPeriod(item.publishedAt, ranges.reviewPeriod))
    .sort((left, right) => compareItems(reviewItem(left), reviewItem(right), "publishedAt"));
  const publishedItems: GrowthReviewPublishedItem[] = publishedSourceItems.map((sourceItem) => ({
    ...reviewItem(sourceItem),
    performance: GROWTH_PERFORMANCE_WINDOWS.flatMap((window) => {
      const row = latestRows.get(`${sourceItem.accountId}\u0000${sourceItem.id}\u0000${window}`);
      return row ? [{ window, measuredAt: row.measuredAt, metrics: stableMetrics(row.metrics) }] : [];
    }),
  }));
  const missedItems = input.contentItems
    .filter((item) => timestampInPeriod(item.scheduledFor, ranges.reviewPeriod)
      && !timestampInPeriod(item.publishedAt, ranges.reviewPeriod))
    .map(reviewItem)
    .sort((left, right) => compareItems(left, right, "scheduledFor"));
  const upcomingItems = input.contentItems
    .filter((item) => item.status !== "published"
      && item.status !== "skipped"
      && timestampInPeriod(item.scheduledFor, ranges.upcomingPeriod))
    .map(reviewItem)
    .sort((left, right) => compareItems(left, right, "scheduledFor"));
  const channelFindings = buildFindings(input.performanceSummary, "channel");
  const pillarFindings = buildFindings(input.performanceSummary, "pillar");
  const recommendations = buildRecommendations({
    publishedItems,
    missedItems,
    upcomingItems,
    channelFindings,
    pillarFindings,
    interventions: input.interventions,
  });
  const measured = new Set(publishedItems
    .filter((item) => item.performance.length > 0)
    .map((item) => item.id)).size;

  return {
    generatedAt: ranges.generatedAt,
    repository: input.repository ?? null,
    reviewPeriod: ranges.reviewPeriod,
    upcomingPeriod: ranges.upcomingPeriod,
    publishedItems,
    missedItems,
    upcomingItems,
    performance: input.performanceSummary,
    channelFindings,
    pillarFindings,
    recommendations,
    narrative: deterministicNarrative({
      published: publishedItems.length,
      measured,
      missed: missedItems.length,
      upcoming: upcomingItems.length,
    }),
    empty: publishedItems.length === 0 && missedItems.length === 0 && upcomingItems.length === 0,
    aiEnabled: false,
    usedFallback: true,
  };
}
