import type { DailyDigestEntry, DailyRepoDigest, GhIssue, GhRepo } from "../types/github";

const DAY_MS = 86_400_000;

export interface DailyRepoSecurityRecord {
  securityAlertsCount: number;
  securityAlertsUnavailable: boolean;
}

export interface DailyRepoRecord {
  repo: string;
  stars: number;
  forks: number;
  issueCount: number;
  staleIssueCount: number;
  securityAlertsCount: number;
  securityAlertsUnavailable: boolean;
}

export interface DailyDigestRecord {
  date: string;
  repoCount: number;
  issueCount: number;
  staleIssueCount: number;
  securityAlertsCount: number;
  securityReposCount: number;
  securityAlertsUnavailable: boolean;
  totalStars: number;
  totalForks: number;
  repos: DailyRepoRecord[];
  ai?: {
    model: string;
    headline: string;
    briefing: string[];
    generatedAt: string;
  } | null;
}

export function buildDailyDigestRecord(
  repos: GhRepo[],
  issues: GhIssue[],
  now = Date.now(),
  securityByRepo = new Map<string, DailyRepoSecurityRecord>(),
): DailyDigestRecord {
  const issueCountByRepo = new Map<string, number>();
  const staleIssueCountByRepo = new Map<string, number>();

  for (const issue of issues) {
    const key = issue.repository.nameWithOwner;
    issueCountByRepo.set(key, (issueCountByRepo.get(key) || 0) + 1);
    if (now - new Date(issue.updatedAt).getTime() > 30 * DAY_MS) {
      staleIssueCountByRepo.set(key, (staleIssueCountByRepo.get(key) || 0) + 1);
    }
  }

  const repoRecords = repos.map((repo) => ({
    repo: repo.nameWithOwner,
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    issueCount: issueCountByRepo.get(repo.nameWithOwner) || 0,
    staleIssueCount: staleIssueCountByRepo.get(repo.nameWithOwner) || 0,
    securityAlertsCount: securityByRepo.get(repo.nameWithOwner)?.securityAlertsCount || 0,
    securityAlertsUnavailable: securityByRepo.get(repo.nameWithOwner)?.securityAlertsUnavailable || false,
  })).sort((a, b) => a.repo.localeCompare(b.repo));
  const securityAlertsCount = repoRecords.reduce((sum, repo) => sum + repo.securityAlertsCount, 0);
  const securityReposCount = repoRecords.filter((repo) => repo.securityAlertsCount > 0).length;
  const securityAlertsUnavailable = repoRecords.some((repo) => repo.securityAlertsUnavailable);

  return {
    date: new Date(now).toISOString().slice(0, 10),
    repoCount: repos.length,
    issueCount: issues.length,
    staleIssueCount: issues.filter((issue) => now - new Date(issue.updatedAt).getTime() > 30 * DAY_MS).length,
    securityAlertsCount,
    securityReposCount,
    securityAlertsUnavailable,
    totalStars: repos.reduce((sum, repo) => sum + repo.stargazerCount, 0),
    totalForks: repos.reduce((sum, repo) => sum + repo.forkCount, 0),
    repos: repoRecords,
  };
}

function buildRepoDelta(current: DailyRepoRecord, previous?: DailyRepoRecord): DailyRepoDigest {
  const issueDelta = current.issueCount - (previous?.issueCount || 0);
  const staleIssueDelta = current.staleIssueCount - (previous?.staleIssueCount || 0);
  const securityAlertsDelta = current.securityAlertsCount - (previous?.securityAlertsCount || 0);
  const starsDelta = current.stars - (previous?.stars || 0);
  const forksDelta = current.forks - (previous?.forks || 0);
  const risks = [
    issueDelta > 0 ? `Open issues ${issueDelta >= 0 ? "+" : ""}${issueDelta}.` : "",
    staleIssueDelta > 0 ? `Stale issues ${staleIssueDelta >= 0 ? "+" : ""}${staleIssueDelta}.` : "",
    current.securityAlertsCount > 0 ? `Security alerts ${current.securityAlertsCount >= 0 ? "+" : ""}${current.securityAlertsCount}.` : "",
  ].filter(Boolean);
  const momentum = [
    starsDelta > 0 ? `Stars ${starsDelta >= 0 ? "+" : ""}${starsDelta}.` : "",
    forksDelta > 0 ? `Forks ${forksDelta >= 0 ? "+" : ""}${forksDelta}.` : "",
  ].filter(Boolean);

  return {
    repo: current.repo,
    date: "",
    stars: current.stars,
    forks: current.forks,
    issueCount: current.issueCount,
    staleIssueCount: current.staleIssueCount,
    securityAlertsCount: current.securityAlertsCount,
    securityAlertsUnavailable: current.securityAlertsUnavailable,
    starsDelta,
    forksDelta,
    issueDelta,
    staleIssueDelta,
    securityAlertsDelta,
    highlights: [
      `Stars ${starsDelta >= 0 ? "+" : ""}${starsDelta}, forks ${forksDelta >= 0 ? "+" : ""}${forksDelta}, open issues ${issueDelta >= 0 ? "+" : ""}${issueDelta}.`,
      current.securityAlertsCount > 0 ? `Security alerts ${current.securityAlertsCount >= 0 ? "+" : ""}${current.securityAlertsCount}.` : "",
    ],
    executiveSummary: [
      `${current.repo} now has ${current.issueCount} open issues, ${current.staleIssueCount} stale.`,
      `Daily movement: stars ${starsDelta >= 0 ? "+" : ""}${starsDelta}, forks ${forksDelta >= 0 ? "+" : ""}${forksDelta}, issues ${issueDelta >= 0 ? "+" : ""}${issueDelta}${current.securityAlertsCount > 0 ? `, security alerts ${current.securityAlertsCount >= 0 ? "+" : ""}${current.securityAlertsCount}` : ""}.`,
      risks[0] || momentum[0] || (current.securityAlertsCount > 0 ? `Security alerts are active for ${current.repo}.` : "No major repo-specific movement detected."),
    ],
    momentum,
    risks,
    ai: null,
  };
}

function toMarkdownDigest(
  digest: Pick<DailyDigestEntry, "date" | "highlights" | "executiveSummary" | "momentum" | "risks"> & {
    securityAlertsCount?: number;
    securityReposCount?: number;
    ai?: { headline: string; briefing: string[] } | null;
  },
) {
  const lines = [`# Daily digest - ${digest.date}`];
  if (digest.ai) {
    lines.push("", `## ${digest.ai.headline}`, ...digest.ai.briefing.map((item) => `- ${item}`));
  }
  if (typeof digest.securityAlertsCount === "number") {
    lines.push("", "## Security", `- Open security alerts: ${digest.securityAlertsCount}`);
    if (typeof digest.securityReposCount === "number") {
      lines.push(`- Repositories affected: ${digest.securityReposCount}`);
    }
  }
  lines.push("", "## Executive summary", ...digest.executiveSummary.map((item) => `- ${item}`));
  if (digest.momentum.length) lines.push("", "## Momentum", ...digest.momentum.map((item) => `- ${item}`));
  if (digest.risks.length) lines.push("", "## Risks", ...digest.risks.map((item) => `- ${item}`));
  lines.push("", "## Highlights", ...digest.highlights.map((item) => `- ${item}`));
  return lines.join("\n");
}

export function buildDailyDigestMarkdown(digest: DailyDigestEntry): string {
  return toMarkdownDigest(digest);
}

export function buildDailyRepoDigestMarkdown(digest: DailyRepoDigest): string {
  return toMarkdownDigest(digest);
}

export type DigestPeriod = "day" | "week" | "month";

function isoWeekKey(date: string): string {
  // Returns "YYYY-Www" key per ISO-8601.
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7; // Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this ISO week
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function periodKey(date: string, period: DigestPeriod): string {
  if (period === "day") return date;
  if (period === "month") return date.slice(0, 7); // YYYY-MM
  return isoWeekKey(date);
}

function bucketByPeriod(records: DailyDigestRecord[], period: DigestPeriod): DailyDigestRecord[] {
  if (period === "day") return records;
  const sorted = [...records].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const buckets = new Map<string, DailyDigestRecord>();
  for (const record of sorted) {
    // Keep the latest record of each bucket; its date is the end of the period.
    buckets.set(periodKey(record.date, period), record);
  }
  return [...buckets.values()];
}

export function buildPeriodDigestEntries(records: DailyDigestRecord[], period: DigestPeriod): DailyDigestEntry[] {
  const bucketed = bucketByPeriod(records, period);
  const entries = buildDailyDigestEntries(bucketed);
  if (period === "day") return entries;
  // AI narratives are bound to a specific day, so strip them on aggregated views.
  return entries.map((entry) => ({ ...entry, ai: null }));
}

export function buildDailyDigestEntries(records: DailyDigestRecord[]): DailyDigestEntry[] {
  const sorted = [...records].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return sorted.map((record, index) => {
    const previous = sorted[index + 1];
    const previousRepoMap = new Map((previous?.repos || []).map((repo) => [repo.repo, repo]));
    const repoDeltas = record.repos
      .map((repo) => {
        const delta = buildRepoDelta(repo, previousRepoMap.get(repo.repo));
        delta.date = record.date;
        return delta;
      })
      .sort((a, b) => Math.abs(b.issueDelta) - Math.abs(a.issueDelta) || Math.abs(b.starsDelta) - Math.abs(a.starsDelta) || a.repo.localeCompare(b.repo));

    const topIssueMover = repoDeltas.find((repo) => repo.issueDelta !== 0);
    const topStarMover = repoDeltas.find((repo) => repo.starsDelta !== 0);
    const topStaleMover = repoDeltas.find((repo) => repo.staleIssueDelta !== 0);
    const topSecurityMover = repoDeltas.find((repo) => repo.securityAlertsCount !== 0);

    const highlights = [
      `Stars ${record.totalStars - (previous?.totalStars || 0) >= 0 ? "+" : ""}${record.totalStars - (previous?.totalStars || 0)}, forks ${record.totalForks - (previous?.totalForks || 0) >= 0 ? "+" : ""}${record.totalForks - (previous?.totalForks || 0)}, open issues ${record.issueCount - (previous?.issueCount || 0) >= 0 ? "+" : ""}${record.issueCount - (previous?.issueCount || 0)}.`,
      record.securityAlertsCount > 0 ? `Security alerts ${record.securityAlertsCount >= 0 ? "+" : ""}${record.securityAlertsCount} across ${record.securityReposCount} repos.` : "",
      topIssueMover ? `${topIssueMover.repo} changed open issues by ${topIssueMover.issueDelta >= 0 ? "+" : ""}${topIssueMover.issueDelta}.` : "",
      topStarMover ? `${topStarMover.repo} changed stars by ${topStarMover.starsDelta >= 0 ? "+" : ""}${topStarMover.starsDelta}.` : "",
      topStaleMover ? `${topStaleMover.repo} changed stale issues by ${topStaleMover.staleIssueDelta >= 0 ? "+" : ""}${topStaleMover.staleIssueDelta}.` : "",
      topSecurityMover ? `${topSecurityMover.repo} has ${topSecurityMover.securityAlertsCount} security alerts.` : "",
    ].filter(Boolean);

    const risks = repoDeltas
      .filter((repo) => repo.issueDelta > 0 || repo.staleIssueDelta > 0 || repo.securityAlertsCount > 0)
      .slice(0, 3)
      .map((repo) => `${repo.repo}: issues ${repo.issueDelta >= 0 ? "+" : ""}${repo.issueDelta}, stale ${repo.staleIssueDelta >= 0 ? "+" : ""}${repo.staleIssueDelta}, security ${repo.securityAlertsCount >= 0 ? "+" : ""}${repo.securityAlertsCount}.`);

    const momentum = repoDeltas
      .filter((repo) => repo.starsDelta > 0 || repo.forksDelta > 0)
      .slice(0, 3)
      .map((repo) => `${repo.repo}: stars ${repo.starsDelta >= 0 ? "+" : ""}${repo.starsDelta}, forks ${repo.forksDelta >= 0 ? "+" : ""}${repo.forksDelta}.`);

    const executiveSummary = [
      `Tracked ${record.repoCount} repositories with ${record.issueCount} open issues in total.`,
      `Daily deltas: stars ${record.totalStars - (previous?.totalStars || 0) >= 0 ? "+" : ""}${record.totalStars - (previous?.totalStars || 0)}, forks ${record.totalForks - (previous?.totalForks || 0) >= 0 ? "+" : ""}${record.totalForks - (previous?.totalForks || 0)}, issues ${record.issueCount - (previous?.issueCount || 0) >= 0 ? "+" : ""}${record.issueCount - (previous?.issueCount || 0)}${record.securityAlertsCount > 0 ? `, security alerts ${record.securityAlertsCount >= 0 ? "+" : ""}${record.securityAlertsCount}` : ""}.`,
      risks[0] || momentum[0] || (record.securityAlertsCount > 0 ? "Security alerts are active across tracked repositories." : "No significant repo-level movement detected."),
    ];

    return {
      date: record.date,
      repoCount: record.repoCount,
      issueCount: record.issueCount,
      staleIssueCount: record.staleIssueCount,
      securityAlertsCount: record.securityAlertsCount,
      securityReposCount: record.securityReposCount,
      securityAlertsUnavailable: record.securityAlertsUnavailable,
      totalStars: record.totalStars,
      totalForks: record.totalForks,
      issueDelta: record.issueCount - (previous?.issueCount || 0),
      staleIssueDelta: record.staleIssueCount - (previous?.staleIssueCount || 0),
      starsDelta: record.totalStars - (previous?.totalStars || 0),
      forksDelta: record.totalForks - (previous?.totalForks || 0),
      highlights,
      executiveSummary,
      momentum,
      risks,
      repos: repoDeltas.slice(0, 8),
      ai: record.ai ?? null,
    };
  });
}
