import type { GhIssue, GhPullRequest, GhRepo, RepoInsight, ReviewDecision } from "../types/github";
import { getOwner } from "./repository";

export interface DateFilters {
  cf: string;
  ct: string;
  uf: string;
  ut: string;
}

export interface IssueFilters {
  search: string;
  orgs: Set<string>;
  repos: Set<string>;
  labels: Set<string>;
  authors: Set<string>;
  assignees: Set<string>;
  dates: DateFilters;
  preset: string;
}

export interface PullRequestFilters {
  search: string;
  orgs: Set<string>;
  repos: Set<string>;
  labels: Set<string>;
  authors: Set<string>;
  assignees: Set<string>;
  dates: DateFilters;
  preset: string;
}

export interface RepoFilters {
  search: string;
  orgs: Set<string>;
  languages: Set<string>;
  visibility: "all" | "public" | "private";
  includeForks: boolean;
  includeArchived: boolean;
}

export type FacetValue = number | { count: number; color?: string };

export function issueCountForRepo(issues: GhIssue[], nameWithOwner: string): number {
  return issues.filter((issue) => issue.repository.nameWithOwner === nameWithOwner).length;
}

export function pullRequestCountForRepo(prs: GhPullRequest[], nameWithOwner: string): number {
  return prs.filter((pr) => pr.repository.nameWithOwner === nameWithOwner).length;
}

export function reviewDecisionLabel(decision: ReviewDecision): string {
  if (decision === "APPROVED") return "Approved";
  if (decision === "CHANGES_REQUESTED") return "Changes requested";
  return "Awaiting review";
}

export function buildIssueFacets(issues: GhIssue[]) {
  const facets = {
    orgs: new Map<string, number>(),
    repos: new Map<string, number>(),
    labels: new Map<string, { count: number; color?: string }>(),
    authors: new Map<string, number>(),
    assignees: new Map<string, number>(),
  };

  for (const issue of issues) {
    const owner = getOwner(issue.repository.nameWithOwner);
    facets.orgs.set(owner, (facets.orgs.get(owner) || 0) + 1);
    facets.repos.set(issue.repository.nameWithOwner, (facets.repos.get(issue.repository.nameWithOwner) || 0) + 1);
    for (const label of issue.labels || []) {
      facets.labels.set(label.name, { count: (facets.labels.get(label.name)?.count || 0) + 1, color: label.color });
    }
    if (issue.author?.login) facets.authors.set(issue.author.login, (facets.authors.get(issue.author.login) || 0) + 1);
    for (const assignee of issue.assignees || []) {
      facets.assignees.set(assignee.login, (facets.assignees.get(assignee.login) || 0) + 1);
    }
  }

  return facets;
}

export function buildPullRequestFacets(prs: GhPullRequest[]) {
  const facets = {
    orgs: new Map<string, number>(),
    repos: new Map<string, number>(),
    labels: new Map<string, { count: number; color?: string }>(),
    authors: new Map<string, number>(),
    assignees: new Map<string, number>(),
  };

  for (const pr of prs) {
    const owner = getOwner(pr.repository.nameWithOwner);
    facets.orgs.set(owner, (facets.orgs.get(owner) || 0) + 1);
    facets.repos.set(pr.repository.nameWithOwner, (facets.repos.get(pr.repository.nameWithOwner) || 0) + 1);
    for (const label of pr.labels || []) {
      facets.labels.set(label.name, { count: (facets.labels.get(label.name)?.count || 0) + 1, color: label.color });
    }
    if (pr.author?.login) facets.authors.set(pr.author.login, (facets.authors.get(pr.author.login) || 0) + 1);
    for (const assignee of pr.assignees || []) {
      facets.assignees.set(assignee.login, (facets.assignees.get(assignee.login) || 0) + 1);
    }
  }

  return facets;
}

export function buildRepoFacets(repos: GhRepo[]) {
  const facets = {
    orgs: new Map<string, number>(),
    languages: new Map<string, number>(),
  };

  for (const repo of repos) {
    facets.orgs.set(repo.owner.login, (facets.orgs.get(repo.owner.login) || 0) + 1);
    const language = repo.primaryLanguage?.name || "—";
    facets.languages.set(language, (facets.languages.get(language) || 0) + 1);
  }

  return facets;
}

export function matchesIssuePreset(issue: GhIssue, preset: string, userLogin: string, now = Date.now()): boolean {
  if (!preset) return true;
  if (preset === "assigned-me") return !!userLogin && (issue.assignees || []).some((assignee) => assignee.login === userLogin);
  if (preset === "authored-me") return !!userLogin && issue.author?.login === userLogin;
  if (preset === "no-assignee") return !(issue.assignees || []).length;
  if (preset === "week") return now - new Date(issue.createdAt).getTime() < 7 * 86_400_000;
  if (preset === "today") return new Date(issue.updatedAt).toDateString() === new Date(now).toDateString();
  if (preset === "stale") return now - new Date(issue.updatedAt).getTime() > 30 * 86_400_000;
  return true;
}

export function filterIssues(issues: GhIssue[], filters: IssueFilters, userLogin: string, archivedRepoNames: Set<string> = new Set()): GhIssue[] {
  const query = filters.search.trim().toLowerCase();
  const createdFrom = filters.dates.cf ? new Date(`${filters.dates.cf}T00:00:00`).getTime() : null;
  const createdTo = filters.dates.ct ? new Date(`${filters.dates.ct}T23:59:59`).getTime() : null;
  const updatedFrom = filters.dates.uf ? new Date(`${filters.dates.uf}T00:00:00`).getTime() : null;
  const updatedTo = filters.dates.ut ? new Date(`${filters.dates.ut}T23:59:59`).getTime() : null;

  return issues.filter((issue) => {
    if (archivedRepoNames.has(issue.repository.nameWithOwner)) return false;
    const owner = getOwner(issue.repository.nameWithOwner);
    if (filters.orgs.size && !filters.orgs.has(owner)) return false;
    if (filters.repos.size && !filters.repos.has(issue.repository.nameWithOwner)) return false;
    if (filters.labels.size && ![...(issue.labels || []).map((label) => label.name)].some((label) => filters.labels.has(label))) return false;
    if (filters.authors.size && !filters.authors.has(issue.author?.login || "")) return false;
    if (filters.assignees.size && ![...(issue.assignees || []).map((assignee) => assignee.login)].some((login) => filters.assignees.has(login))) return false;

    const created = new Date(issue.createdAt).getTime();
    const updated = new Date(issue.updatedAt).getTime();
    if (createdFrom && created < createdFrom) return false;
    if (createdTo && created > createdTo) return false;
    if (updatedFrom && updated < updatedFrom) return false;
    if (updatedTo && updated > updatedTo) return false;
    if (!matchesIssuePreset(issue, filters.preset, userLogin)) return false;

    if (!query) return true;
    const haystack = [
      issue.title,
      issue.repository.nameWithOwner,
      issue.author?.login || "",
      ...(issue.labels || []).map((label) => label.name),
      ...(issue.assignees || []).map((assignee) => assignee.login),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function filterRepos(repos: GhRepo[], issues: GhIssue[], filters: RepoFilters): GhRepo[] {
  const query = filters.search.trim().toLowerCase();
  return repos.filter((repo) => {
    if (filters.orgs.size && !filters.orgs.has(repo.owner.login)) return false;
    const language = repo.primaryLanguage?.name || "—";
    if (filters.languages.size && !filters.languages.has(language)) return false;
    if (filters.visibility === "public" && repo.isPrivate) return false;
    if (filters.visibility === "private" && !repo.isPrivate) return false;
    if (!filters.includeForks && repo.isFork) return false;
    if (!filters.includeArchived && repo.isArchived) return false;
    if (!query) return true;
    return [repo.nameWithOwner, repo.description || "", language, String(issueCountForRepo(issues, repo.nameWithOwner))]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function matchesPullRequestPreset(pr: GhPullRequest, preset: string, userLogin: string, now = Date.now()): boolean {
  if (!preset) return true;
  if (preset === "assigned-me") return !!userLogin && (pr.assignees || []).some((assignee) => assignee.login === userLogin);
  if (preset === "authored-me") return !!userLogin && pr.author?.login === userLogin;
  if (preset === "draft") return pr.isDraft;
  if (preset === "ready") return !pr.isDraft;
  if (preset === "awaiting-review") return !pr.isDraft && pr.reviewDecision !== "APPROVED" && pr.reviewsCount === 0;
  if (preset === "approved") return pr.reviewDecision === "APPROVED";
  if (preset === "changes-requested") return pr.reviewDecision === "CHANGES_REQUESTED";
  if (preset === "stale") return now - new Date(pr.updatedAt).getTime() > 14 * 86_400_000;
  if (preset === "today") return new Date(pr.updatedAt).toDateString() === new Date(now).toDateString();
  if (preset === "week") return now - new Date(pr.createdAt).getTime() < 7 * 86_400_000;
  return true;
}

export function filterPullRequests(prs: GhPullRequest[], filters: PullRequestFilters, userLogin: string, archivedRepoNames: Set<string> = new Set()): GhPullRequest[] {
  const query = filters.search.trim().toLowerCase();
  const createdFrom = filters.dates.cf ? new Date(`${filters.dates.cf}T00:00:00`).getTime() : null;
  const createdTo = filters.dates.ct ? new Date(`${filters.dates.ct}T23:59:59`).getTime() : null;
  const updatedFrom = filters.dates.uf ? new Date(`${filters.dates.uf}T00:00:00`).getTime() : null;
  const updatedTo = filters.dates.ut ? new Date(`${filters.dates.ut}T23:59:59`).getTime() : null;

  return prs.filter((pr) => {
    if (archivedRepoNames.has(pr.repository.nameWithOwner)) return false;
    const owner = getOwner(pr.repository.nameWithOwner);
    if (filters.orgs.size && !filters.orgs.has(owner)) return false;
    if (filters.repos.size && !filters.repos.has(pr.repository.nameWithOwner)) return false;
    if (filters.labels.size && ![...(pr.labels || []).map((label) => label.name)].some((label) => filters.labels.has(label))) return false;
    if (filters.authors.size && !filters.authors.has(pr.author?.login || "")) return false;
    if (filters.assignees.size && ![...(pr.assignees || []).map((assignee) => assignee.login)].some((login) => filters.assignees.has(login))) return false;

    const created = new Date(pr.createdAt).getTime();
    const updated = new Date(pr.updatedAt).getTime();
    if (createdFrom && created < createdFrom) return false;
    if (createdTo && created > createdTo) return false;
    if (updatedFrom && updated < updatedFrom) return false;
    if (updatedTo && updated > updatedTo) return false;
    if (!matchesPullRequestPreset(pr, filters.preset, userLogin)) return false;

    if (!query) return true;
    const haystack = [
      pr.title,
      pr.repository.nameWithOwner,
      pr.author?.login || "",
      pr.headRefName,
      pr.baseRefName,
      ...(pr.labels || []).map((label) => label.name),
      ...(pr.assignees || []).map((assignee) => assignee.login),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function sortPullRequests(prs: GhPullRequest[], sort: string): GhPullRequest[] {
  const sorted = [...prs];
  sorted.sort((a, b) => {
    if (sort === "updated_asc") return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    if (sort === "created_desc") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === "created_asc") return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (sort === "comments_desc") return b.commentsCount - a.commentsCount;
    if (sort === "comments_asc") return a.commentsCount - b.commentsCount;
    if (sort === "size_desc") return (b.additions + b.deletions) - (a.additions + a.deletions);
    if (sort === "size_asc") return (a.additions + a.deletions) - (b.additions + b.deletions);
    if (sort === "files_desc") return b.changedFiles - a.changedFiles;
    if (sort === "review_pending") {
      const aPending = a.reviewsCount === 0 && !a.isDraft ? 1 : 0;
      const bPending = b.reviewsCount === 0 && !b.isDraft ? 1 : 0;
      if (aPending !== bPending) return bPending - aPending;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    }
    if (sort === "repo_asc") return a.repository.nameWithOwner.localeCompare(b.repository.nameWithOwner);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  return sorted;
}

export function sortIssues(issues: GhIssue[], sort: string): GhIssue[] {
  const sorted = [...issues];
  sorted.sort((a, b) => {
    if (sort === "updated_asc") return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    if (sort === "created_desc") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === "created_asc") return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (sort === "comments_desc") return b.commentsCount - a.commentsCount;
    if (sort === "comments_asc") return a.commentsCount - b.commentsCount;
    if (sort === "repo_asc") return a.repository.nameWithOwner.localeCompare(b.repository.nameWithOwner);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  return sorted;
}

export function sortRepos(repos: GhRepo[], issues: GhIssue[], sort: string, insightsByRepo?: Map<string, RepoInsight>): GhRepo[] {
  const sorted = [...repos];
  sorted.sort((a, b) => {
    const issueDelta = issueCountForRepo(issues, b.nameWithOwner) - issueCountForRepo(issues, a.nameWithOwner);
    const healthDelta = (insightsByRepo?.get(b.nameWithOwner)?.healthScore ?? 0) - (insightsByRepo?.get(a.nameWithOwner)?.healthScore ?? 0);
    if (sort === "stars_asc") return a.stargazerCount - b.stargazerCount;
    if (sort === "forks_desc") return b.forkCount - a.forkCount;
    if (sort === "forks_asc") return a.forkCount - b.forkCount;
    if (sort === "issues_desc") return issueDelta;
    if (sort === "issues_asc") return -issueDelta;
    if (sort === "health_desc") return healthDelta;
    if (sort === "health_asc") return -healthDelta;
    if (sort === "pushed_desc") return Date.parse(b.pushedAt) - Date.parse(a.pushedAt);
    if (sort === "updated_desc") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (sort === "name_asc") return a.nameWithOwner.localeCompare(b.nameWithOwner);
    return b.stargazerCount - a.stargazerCount;
  });
  return sorted;
}
