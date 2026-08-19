import type { IncomingMessage, ServerResponse } from "node:http";
import type { GhIssue, GhRepo, RepoInsight } from "../types/github";
import { buildRepoInsight } from "../utils/insights";
import { fetchRepoSecuritySummary } from "./securityAlerts";
import { getIssuesCached, getReposCached } from "./dashboardData";
import { ghApiJson, restApiPaginate } from "./githubClient";
import { sendJsonCacheable } from "./http";

interface ReleaseAssetApi {
  download_count: number;
}

interface ReleaseApi {
  published_at: string | null;
  assets?: ReleaseAssetApi[];
}

async function fetchReleases(repo: string) {
  const result = await restApiPaginate<ReleaseApi>(`/repos/${repo}/releases?per_page=100`);
  if (!result.ok) return { ok: false as const, error: result.error };
  return { ok: true as const, data: result.data };
}

async function fetchInsightForRepo(repo: GhRepo, issues: GhIssue[]): Promise<RepoInsight> {
  const [views, releases, security] = await Promise.all([
    ghApiJson(`/repos/${repo.nameWithOwner}/traffic/views`),
    fetchReleases(repo.nameWithOwner),
    fetchRepoSecuritySummary(repo.nameWithOwner),
  ]);
  const releaseList = releases.ok ? releases.data : [];
  const totalDownloads = releaseList.reduce((sum, release) => (
    sum + (release.assets ?? []).reduce((assetSum, asset) => assetSum + (asset.download_count || 0), 0)
  ), 0);
  const recentDownloads = releaseList
    .filter((release) => release.published_at && Date.now() - new Date(release.published_at).getTime() <= 30 * 86_400_000)
    .reduce((sum, release) => sum + (release.assets ?? []).reduce((assetSum, asset) => assetSum + (asset.download_count || 0), 0), 0);
  const latestReleasePublishedAt = releaseList
    .map((release) => release.published_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  const viewData = views.ok ? (views.data as { count?: number; uniques?: number } | null) : null;

  return buildRepoInsight({
    repo,
    issues,
    viewsCount: viewData?.count ?? 0,
    viewsUniques: viewData?.uniques ?? 0,
    releaseCount: releaseList.length,
    totalDownloads,
    recentDownloads,
    latestReleasePublishedAt,
    securityAlertsCount: security.totalOpen,
    securityAlertsUnavailable: security.unavailable,
  });
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

const INSIGHTS_TTL_MS = 15 * 60 * 1000;
let insightsCache: { value: { ok: true; generatedAt: string; insights: RepoInsight[] }; expiresAt: number } | null = null;
let inflight: Promise<{ ok: true; generatedAt: string; insights: RepoInsight[] } | { ok: false; error: string }> | null = null;

async function buildRepoInsights(forceFresh: boolean, requestedRepos?: Set<string>) {
  const [repos, issues] = await Promise.all([getReposCached(forceFresh), getIssuesCached(forceFresh)]);
  if (!repos.ok) return repos;
  if (!issues.ok) return issues;

  const activeRepos = repos.repos.filter((repo) => !repo.isArchived && (!requestedRepos || requestedRepos.has(repo.nameWithOwner)));
  const insights = await mapWithConcurrency(activeRepos, 6, async (repo) => fetchInsightForRepo(repo, issues.issues));
  return {
    ok: true as const,
    generatedAt: new Date().toISOString(),
    insights: insights.sort((a, b) => a.healthScore - b.healthScore || b.issueCount - a.issueCount || a.repo.localeCompare(b.repo)),
  };
}

export async function getRepoInsightsCached(forceFresh: boolean) {
  if (!forceFresh && insightsCache && insightsCache.expiresAt > Date.now()) return insightsCache.value;
  if (inflight) return inflight;

  inflight = buildRepoInsights(forceFresh).then((result) => {
    if (result.ok) insightsCache = { value: result, expiresAt: Date.now() + INSIGHTS_TTL_MS };
    return result;
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}

export async function handleRepoInsights(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  const fresh = u.searchParams.get("fresh") === "1";
  const requestedRepos = new Set(u.searchParams.getAll("repo").filter(Boolean));
  const payload = requestedRepos.size
    ? await buildRepoInsights(fresh, requestedRepos)
    : await getRepoInsightsCached(fresh);
  sendJsonCacheable(req, res, payload.ok ? 200 : 500, payload);
}
