import type { GhIssue, GhRepo, RepoInsight, VulnerabilityAlertsStatus } from "../types/github";

const DAY_MS = 86_400_000;
const RECENT_RELEASE_DAYS = 30;

export interface RepoInsightInput {
  repo: GhRepo;
  issues: GhIssue[];
  viewsCount?: number;
  viewsUniques?: number;
  releaseCount?: number;
  totalDownloads?: number;
  recentDownloads?: number;
  latestReleasePublishedAt?: string | null;
  securityAlertsCount?: number;
  securityAlertsUnavailable?: boolean;
  vulnerabilityAlertsStatus?: VulnerabilityAlertsStatus;
  now?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function historyDelta(repo: GhRepo, field: "stars" | "forks"): number | null {
  const history = repo.history || [];
  if (history.length < 2) return null;
  return history[history.length - 1][field] - history[0][field];
}

export function buildRepoInsight(input: RepoInsightInput): RepoInsight {
  const now = input.now ?? Date.now();
  const repoIssues = input.issues.filter((issue) => issue.repository.nameWithOwner === input.repo.nameWithOwner);
  const staleIssueCount = repoIssues.filter((issue) => now - new Date(issue.updatedAt).getTime() > 30 * DAY_MS).length;
  const daysSincePush = Math.floor((now - new Date(input.repo.pushedAt).getTime()) / DAY_MS);
  const daysSinceUpdate = Math.floor((now - new Date(input.repo.updatedAt).getTime()) / DAY_MS);
  const starsDelta = historyDelta(input.repo, "stars");
  const forksDelta = historyDelta(input.repo, "forks");
  const viewsCount = input.viewsCount ?? 0;
  const viewsUniques = input.viewsUniques ?? 0;
  const releaseCount = input.releaseCount ?? 0;
  const totalDownloads = input.totalDownloads ?? 0;
  const recentDownloads = input.recentDownloads ?? 0;
  const latestReleasePublishedAt = input.latestReleasePublishedAt ?? null;
  const securityAlertsCount = input.securityAlertsCount ?? 0;
  const securityAlertsUnavailable = input.securityAlertsUnavailable ?? false;
  const vulnerabilityAlertsStatus = input.vulnerabilityAlertsStatus ?? "enabled";
  const daysSinceRelease = latestReleasePublishedAt ? Math.floor((now - new Date(latestReleasePublishedAt).getTime()) / DAY_MS) : null;

  let healthScore = 78;
  healthScore -= Math.min(24, staleIssueCount * 8);
  healthScore -= Math.min(18, repoIssues.length * 3);
  if (daysSincePush > 14) healthScore -= Math.min(20, Math.floor((daysSincePush - 14) / 7) * 4);
  if (daysSinceRelease !== null && daysSinceRelease > 120 && viewsCount > 150) healthScore -= 12;
  if (latestReleasePublishedAt === null && viewsCount > 150) healthScore -= 10;
  healthScore -= Math.min(18, securityAlertsCount * 3);
  if (daysSincePush <= 7) healthScore += 10;
  if ((starsDelta ?? 0) > 0) healthScore += Math.min(8, starsDelta ?? 0);
  if ((forksDelta ?? 0) > 0) healthScore += Math.min(4, forksDelta ?? 0);
  if (recentDownloads > 0) healthScore += Math.min(10, Math.floor(recentDownloads / 25));
  if (viewsCount > 0 && totalDownloads > 0) healthScore += Math.min(6, Math.floor(totalDownloads / Math.max(viewsCount, 1) * 10));
  healthScore = clamp(Math.round(healthScore), 0, 100);

  const alerts: string[] = [];
  const opportunities: string[] = [];
  const correlations: string[] = [];

  if (securityAlertsCount > 0) alerts.push(`${securityAlertsCount} open security alerts need attention.`);
  if (staleIssueCount >= 3) alerts.push(`${staleIssueCount} stale issues need attention.`);
  if (daysSincePush > 45 && repoIssues.length > 0) alerts.push(`No push for ${daysSincePush} days while issues remain open.`);
  if (viewsCount > 250 && (daysSinceRelease === null || daysSinceRelease > 120)) alerts.push("Traffic is active but the release cadence is cold.");
  if (totalDownloads > 100 && staleIssueCount >= 2) alerts.push("Downloads are healthy, but maintenance debt is building up.");

  if (viewsCount > 200 && totalDownloads < 50) opportunities.push("Traffic is landing, but downloads are not converting yet.");
  if ((starsDelta ?? 0) >= 5 || (forksDelta ?? 0) >= 3) opportunities.push("Momentum is growing; this repo could use a stronger release push.");
  if (releaseCount === 0 && viewsCount > 100) opportunities.push("This repo gets attention without any formal releases.");
  if (repoIssues.length === 0 && viewsCount > 0 && totalDownloads > 0) opportunities.push("Healthy adoption with low support load; a good candidate for promotion.");

  if (daysSinceRelease !== null && daysSinceRelease <= RECENT_RELEASE_DAYS && viewsCount > 0) {
    correlations.push("Recent release activity overlaps with active repository traffic.");
  }
  if (viewsCount > 0 && recentDownloads > 0) correlations.push("Traffic is converting into recent release downloads.");
  if (viewsCount > 0 && totalDownloads > viewsCount) correlations.push("Downloads exceed the last 14 days of views, suggesting long-tail adoption.");

  return {
    repo: input.repo.nameWithOwner,
    issueCount: repoIssues.length,
    staleIssueCount,
    daysSincePush,
    daysSinceUpdate,
    starsDelta,
    forksDelta,
    releaseCount,
    totalDownloads,
    recentDownloads,
    viewsCount,
    viewsUniques,
    healthScore,
    healthLabel: healthScore >= 80 ? "strong" : healthScore >= 55 ? "watch" : "risky",
    securityAlertsCount,
    securityAlertsUnavailable,
    vulnerabilityAlertsStatus,
    alerts,
    opportunities,
    correlations,
    latestReleasePublishedAt,
  };
}
