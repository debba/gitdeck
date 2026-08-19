const REPOSITORY_PATTERN = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/;
const REPO_API_PREFIX = "https://api.github.com/repos/";

export const REPOSITORY_DETAIL_TAB_KEYS = [
  "overview",
  "actions",
  "commits",
  "pull-requests",
  "issues",
  "milestones",
  "releases",
  "branches",
  "forks",
  "traffic",
  "mentions",
  "discussions",
  "dependents",
] as const;

export type RepositoryDetailTab = (typeof REPOSITORY_DETAIL_TAB_KEYS)[number];

export const DEFAULT_PINNED_REPOSITORY_TABS: RepositoryDetailTab[] = ["overview", "pull-requests", "issues"];
export const MAX_PINNED_REPOSITORY_TABS = 5;

export function normalizePinnedRepositoryTabs(value: unknown): RepositoryDetailTab[] {
  if (!Array.isArray(value)) return [...DEFAULT_PINNED_REPOSITORY_TABS];
  const available = new Set<string>(REPOSITORY_DETAIL_TAB_KEYS);
  return [...new Set(value.filter((item): item is RepositoryDetailTab => typeof item === "string" && available.has(item)))]
    .slice(0, MAX_PINNED_REPOSITORY_TABS);
}

export function parseRepositoryName(raw: string | null): [string, string] | null {
  if (!raw) return null;
  const match = REPOSITORY_PATTERN.exec(raw);
  return match ? [match[1], match[2]] : null;
}

export function getOwner(nameWithOwner: string): string {
  return nameWithOwner.split("/")[0] ?? "";
}

export function getRepositoryName(nameWithOwner: string): string {
  return nameWithOwner.split("/")[1] ?? "";
}

export function nameWithOwnerFromApiUrl(repositoryUrl: string): string {
  return repositoryUrl.startsWith(REPO_API_PREFIX)
    ? repositoryUrl.slice(REPO_API_PREFIX.length)
    : repositoryUrl;
}
