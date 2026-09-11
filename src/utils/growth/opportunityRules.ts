import type {
  GrowthContentItem,
  GrowthInterventionCategory,
  GrowthMergedPullRequestSignal,
  GrowthOpportunity,
} from "../../types/growth";
import { GOAL_METRICS, type GoalMetric } from "../../types/goals";
import { createEvergreenRuleKey, isEvergreenContentEligible } from "./evergreen";

const DAY_MS = 86_400_000;
const RELEASE_FOLLOW_UP_DAYS = 3;
const ACTIVITY_LOOKBACK_DAYS = 30;
const STALE_ISSUE_DAYS = 14;
const LARGE_PULL_REQUEST_LINES = 500;
const LARGE_PULL_REQUEST_FILES = 20;
const STAR_MILESTONE_DISTANCE = 0.05;
const GOAL_PACE_GAP_POINTS = 5;

export interface OpportunityReleaseSignal {
  name?: string | null;
  tagName?: string | null;
  url?: string | null;
  publishedAt?: string | null;
}

export interface OpportunityIssueSignal {
  number?: number;
  title?: string;
  url?: string;
  createdAt?: string;
  labels?: ReadonlyArray<string | { name?: string }>;
  commentsCount?: number;
  assignees?: readonly unknown[];
}

export interface OpportunityGoalSignal {
  id: string;
  metric: GoalMetric;
  current: number;
  target: number;
  deadline: string;
  createdAt: string;
}

export interface DetectGrowthOpportunitiesInput {
  now: Date;
  repository: string;
  stars: number | null;
  releases: readonly OpportunityReleaseSignal[];
  openIssues: readonly OpportunityIssueSignal[];
  mergedPullRequests: readonly GrowthMergedPullRequestSignal[];
  goals: readonly OpportunityGoalSignal[];
  contentItems: readonly GrowthContentItem[];
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDate(value: unknown, endOfDay = false): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validCalendarDate(year, month, day)) return null;
  if (match[4] === "") return Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  if (!/^T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(match[4])) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function ageInMilliseconds(timestamp: number, now: number): number | null {
  const age = now - timestamp;
  return age >= 0 ? age : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function httpUrl(value: unknown): string | null {
  if (!nonEmpty(value)) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}

function stableNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function labelName(label: string | { name?: string }): string {
  return (typeof label === "string" ? label : label.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ");
}

function nextStarMilestone(stars: number): number | null {
  if (!stableNumber(stars)) return null;
  if (stars < 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(stars));
  const milestone = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value > stars);
  return milestone !== undefined && Number.isSafeInteger(milestone) ? milestone : null;
}

function metricLabel(metric: GoalMetric): string {
  switch (metric) {
    case "stars": return "stars";
    case "forks": return "forks";
    case "closed_prs": return "closed pull requests";
    case "downloads": return "release downloads";
  }
}

function opportunity(
  ruleKey: string,
  category: GrowthInterventionCategory,
  title: string,
  action: string,
  goalId: string | null = null,
): GrowthOpportunity {
  return { ruleKey, goalId, category, title, action };
}

function byRuleKey(left: GrowthOpportunity, right: GrowthOpportunity): number {
  return left.ruleKey.localeCompare(right.ruleKey, "en", { numeric: true });
}

/** Detects repository opportunities without I/O. All time-based rules use the injected clock. */
export function detectGrowthOpportunities(input: DetectGrowthOpportunitiesInput): GrowthOpportunity[] {
  const now = input.now.getTime();
  if (!Number.isFinite(now) || !nonEmpty(input.repository)) return [];

  const publishedSources = new Set(input.contentItems
    .filter((item) => item.status === "published")
    .flatMap((item) => item.sources));

  const releases = input.releases.flatMap((release) => {
    const tagName = release.tagName?.trim();
    const url = httpUrl(release.url);
    const publishedAt = parseDate(release.publishedAt);
    if (!tagName || !url || publishedAt === null || publishedSources.has(url)) return [];
    const age = ageInMilliseconds(publishedAt, now);
    if (age === null || age < RELEASE_FOLLOW_UP_DAYS * DAY_MS || age > ACTIVITY_LOOKBACK_DAYS * DAY_MS) return [];
    return [opportunity(
      `release:${tagName}`,
      "marketing",
      `Share release ${tagName}`,
      `Publish a follow-up for ${release.name?.trim() || tagName} using ${url} as the source.`,
    )];
  }).sort(byRuleKey);

  const milestone = nextStarMilestone(input.stars ?? Number.NaN);
  const starOpportunities = milestone !== null
    && (input.stars as number) >= milestone * (1 - STAR_MILESTONE_DISTANCE)
    ? [opportunity(
      `star-milestone:${milestone}`,
      "community",
      `Prepare for ${milestone} stars`,
      `Prepare a community milestone post before ${input.repository} reaches ${milestone} stars.`,
    )]
    : [];

  const issues = input.openIssues.flatMap((issue) => {
    const createdAt = parseDate(issue.createdAt);
    const issueUrl = httpUrl(issue.url);
    if (
      !stableNumber(issue.number)
      || issue.number === 0
      || !nonEmpty(issue.title)
      || issueUrl === null
      || createdAt === null
      || !Array.isArray(issue.labels)
      || !Array.isArray(issue.assignees)
      || !stableNumber(issue.commentsCount)
      || issue.commentsCount !== 0
      || issue.assignees.length !== 0
      || !issue.labels.some((label) => labelName(label) === "good first issue")
    ) return [];
    const age = ageInMilliseconds(createdAt, now);
    if (age === null || age <= STALE_ISSUE_DAYS * DAY_MS) return [];
    return [opportunity(
      `good-first-issue:${issue.number}`,
      "community",
      `Unblock good first issue #${issue.number}`,
      `Review and share “${issue.title.trim()}” with a concrete contribution path: ${issueUrl}`,
    )];
  }).sort(byRuleKey);

  const pullRequests = input.mergedPullRequests.flatMap((pullRequest) => {
    const mergedAt = parseDate(pullRequest.mergedAt);
    const pullRequestUrl = httpUrl(pullRequest.url);
    if (
      !stableNumber(pullRequest.number)
      || pullRequest.number === 0
      || !nonEmpty(pullRequest.title)
      || pullRequestUrl === null
      || mergedAt === null
      || !stableNumber(pullRequest.additions)
      || !stableNumber(pullRequest.deletions)
      || !stableNumber(pullRequest.changedFiles)
      || (pullRequest.additions + pullRequest.deletions < LARGE_PULL_REQUEST_LINES
        && pullRequest.changedFiles < LARGE_PULL_REQUEST_FILES)
      || publishedSources.has(pullRequestUrl)
    ) return [];
    const age = ageInMilliseconds(mergedAt, now);
    if (age === null || age > ACTIVITY_LOOKBACK_DAYS * DAY_MS) return [];
    return [opportunity(
      `merged-pr:${pullRequest.number}`,
      "engineering",
      `Share merged pull request #${pullRequest.number}`,
      `Explain the impact of “${pullRequest.title.trim()}” using ${pullRequestUrl} as the source.`,
    )];
  }).sort(byRuleKey);

  const goals = input.goals.flatMap((goal) => {
    const createdAt = parseDate(goal.createdAt);
    const deadline = parseDate(goal.deadline, true);
    if (
      !nonEmpty(goal.id)
      || !GOAL_METRICS.includes(goal.metric)
      || createdAt === null
      || deadline === null
      || deadline <= createdAt
      || now < createdAt
      || !stableNumber(goal.current)
      || !stableNumber(goal.target)
      || goal.target === 0
      || goal.current >= goal.target
    ) return [];
    const expected = Math.min(100, Math.max(0, ((now - createdAt) / (deadline - createdAt)) * 100));
    const actual = (goal.current / goal.target) * 100;
    if (expected - actual <= GOAL_PACE_GAP_POINTS + Number.EPSILON) return [];
    return [opportunity(
      `goal-pace:${goal.id}`,
      "marketing",
      `Recover the ${metricLabel(goal.metric)} mission pace`,
      `Plan a focused action for ${input.repository}; this mission is ${Math.round(expected - actual)} percentage points behind pace.`,
      goal.id,
    )];
  }).sort(byRuleKey);

  const evergreen = input.contentItems.flatMap((item) => {
    const ruleKey = createEvergreenRuleKey(item.id);
    if (!ruleKey || !isEvergreenContentEligible(item, input.now)) return [];
    return [opportunity(
      ruleKey,
      "marketing",
      `Recycle evergreen content: ${item.title.trim() || item.id}`,
      "Create a fresh angle and media treatment from this proven evergreen content.",
    )];
  }).sort(byRuleKey);

  return [...releases, ...starOpportunities, ...issues, ...pullRequests, ...goals, ...evergreen];
}
