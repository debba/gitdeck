export const GITLAB_DIFF_STATS_BATCH_SIZE = 15;

/** Bounds how many merge requests get a diff lookup on one refresh. */
export const GITLAB_DIFF_STATS_LIMIT = GITLAB_DIFF_STATS_BATCH_SIZE * 8;

export interface GitLabDiffStatTarget {
  projectPath: string;
  iid: number;
}

export interface GitLabDiffStats {
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface GitLabDiffStatsPayload {
  data?: Record<string, {
    mergeRequest?: {
      diffStatsSummary?: {
        additions?: number | null;
        deletions?: number | null;
        fileCount?: number | null;
      } | null;
    } | null;
  } | null> | null;
  errors?: Array<{ message?: string | null }>;
}

export function gitLabGraphqlUrl(webUrl: string): string {
  return `${webUrl.replace(/\/+$/, "")}/api/graphql`;
}

/** `changes_count` is a string and becomes `"1000+"` once GitLab truncates the file list. */
export function parseGitLabChangesCount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith("+")) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function buildGitLabDiffStatsQuery(targets: readonly GitLabDiffStatTarget[]): string {
  const fields = targets.map((target, index) => {
    const path = JSON.stringify(target.projectPath);
    const iid = JSON.stringify(String(target.iid));
    return `m${index}: project(fullPath: ${path}) { mergeRequest(iid: ${iid}) { diffStatsSummary { additions deletions fileCount } } }`;
  });
  return `query GitDeckDiffStats { ${fields.join(" ")} }`;
}

export function gitLabDiffStatsRateLimited(payload: GitLabDiffStatsPayload | null | undefined): boolean {
  return (payload?.errors ?? []).some((error) => /rate limit/i.test(error.message ?? ""));
}

export function readGitLabDiffStats(
  payload: GitLabDiffStatsPayload | null | undefined,
  count: number,
): Array<GitLabDiffStats | null> {
  return Array.from({ length: count }, (_, index) => {
    const summary = payload?.data?.[`m${index}`]?.mergeRequest?.diffStatsSummary;
    if (!summary || typeof summary.additions !== "number" || typeof summary.deletions !== "number") return null;
    return {
      additions: summary.additions,
      deletions: summary.deletions,
      changedFiles: typeof summary.fileCount === "number" ? summary.fileCount : 0,
    };
  });
}
