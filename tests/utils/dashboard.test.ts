import { describe, expect, it } from "vitest";
import {
  buildIssueFacets,
  buildPullRequestFacets,
  filterIssues,
  filterPullRequests,
  filterRepos,
  matchesPullRequestPreset,
  sortIssues,
  sortPullRequests,
  sortRepos,
} from "../../src/utils/dashboard";
import type { GhIssue, GhPullRequest, GhRepo, RepoInsight } from "../../src/types/github";

const issues: GhIssue[] = [
  {
    repository: { name: "app", nameWithOwner: "acme/app" },
    title: "Fix dark mode contrast",
    url: "https://github.com/acme/app/issues/1",
    number: 1,
    createdAt: "2026-04-20T10:00:00Z",
    updatedAt: "2026-04-22T10:00:00Z",
    author: { login: "alice" },
    labels: [{ name: "bug", color: "ff0000" }],
    commentsCount: 4,
    assignees: [{ login: "bob" }],
  },
  {
    repository: { name: "cli", nameWithOwner: "acme/cli" },
    title: "Add export command",
    url: "https://github.com/acme/cli/issues/2",
    number: 2,
    createdAt: "2026-04-18T10:00:00Z",
    updatedAt: "2026-04-19T10:00:00Z",
    author: { login: "bob" },
    labels: [{ name: "feature", color: "00ff00" }],
    commentsCount: 1,
    assignees: [],
  },
];

const repos: GhRepo[] = [
  {
    nameWithOwner: "acme/app",
    name: "app",
    owner: { login: "acme" },
    description: "Dashboard app",
    stargazerCount: 20,
    forkCount: 3,
    primaryLanguage: { name: "TypeScript" },
    updatedAt: "2026-04-22T10:00:00Z",
    pushedAt: "2026-04-22T10:00:00Z",
    visibility: "PUBLIC",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    url: "https://github.com/acme/app",
  },
  {
    nameWithOwner: "acme/cli",
    name: "cli",
    owner: { login: "acme" },
    description: "CLI",
    stargazerCount: 5,
    forkCount: 8,
    primaryLanguage: { name: "Go" },
    updatedAt: "2026-04-19T10:00:00Z",
    pushedAt: "2026-04-19T10:00:00Z",
    visibility: "PRIVATE",
    isPrivate: true,
    isArchived: false,
    isFork: false,
    url: "https://github.com/acme/cli",
  },
];

const pullRequests: GhPullRequest[] = [
  {
    repository: { name: "app", nameWithOwner: "acme/app" },
    title: "Add dark mode tokens",
    url: "https://github.com/acme/app/pull/10",
    number: 10,
    createdAt: "2026-04-21T10:00:00Z",
    updatedAt: "2026-04-22T10:00:00Z",
    author: { login: "alice" },
    labels: [{ name: "ui", color: "0000ff" }],
    commentsCount: 2,
    assignees: [{ login: "bob" }],
    isDraft: false,
    reviewDecision: "APPROVED",
    reviewsCount: 2,
    additions: 120,
    deletions: 30,
    changedFiles: 6,
    baseRefName: "main",
    headRefName: "feature/dark-mode",
  },
  {
    repository: { name: "cli", nameWithOwner: "acme/cli" },
    title: "WIP: experimental flag",
    url: "https://github.com/acme/cli/pull/4",
    number: 4,
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-15T10:00:00Z",
    author: { login: "bob" },
    labels: [],
    commentsCount: 0,
    assignees: [],
    isDraft: true,
    reviewDecision: null,
    reviewsCount: 0,
    additions: 5,
    deletions: 1,
    changedFiles: 1,
    baseRefName: "main",
    headRefName: "wip/flag",
  },
  {
    repository: { name: "app", nameWithOwner: "acme/app" },
    title: "Refactor router",
    url: "https://github.com/acme/app/pull/11",
    number: 11,
    createdAt: "2026-04-20T10:00:00Z",
    updatedAt: "2026-04-20T10:00:00Z",
    author: { login: "alice" },
    labels: [],
    commentsCount: 1,
    assignees: [],
    isDraft: false,
    reviewDecision: null,
    reviewsCount: 0,
    additions: 80,
    deletions: 60,
    changedFiles: 10,
    baseRefName: "main",
    headRefName: "refactor/router",
  },
];

describe("dashboard utilities", () => {
  it("builds issue facets from shared issue types", () => {
    const facets = buildIssueFacets(issues);

    expect(facets.orgs.get("acme")).toBe(2);
    expect(facets.labels.get("bug")).toEqual({ count: 1, color: "ff0000" });
    expect(facets.assignees.get("bob")).toBe(1);
  });

  it("filters issues by search and selected values", () => {
    const result = filterIssues(issues, {
      search: "contrast",
      orgs: new Set(["acme"]),
      repos: new Set(["acme/app"]),
      labels: new Set(["bug"]),
      authors: new Set(),
      authorMode: "include",
      assignees: new Set(["bob"]),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([1]);
  });

  it("excludes selected issue authors", () => {
    const result = filterIssues(issues, {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      labels: new Set(),
      authors: new Set(["alice"]),
      authorMode: "exclude",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([2]);
  });

  it("filters repositories by visibility and language", () => {
    const result = filterRepos(repos, issues, {
      search: "",
      orgs: new Set(["acme"]),
      languages: new Set(["Go"]),
      visibility: "private",
      includeForks: true,
      includeArchived: false,
    });

    expect(result.map((repo) => repo.nameWithOwner)).toEqual(["acme/cli"]);
  });

  it("sorts issues and repositories", () => {
    expect(sortIssues(issues, "comments_desc").map((issue) => issue.number)).toEqual([1, 2]);
    expect(sortRepos(repos, issues, "forks_desc").map((repo) => repo.nameWithOwner)).toEqual(["acme/cli", "acme/app"]);
  });

  it("sorts repositories by health score when insight data is available", () => {
    const insights = new Map<string, RepoInsight>([
      ["acme/app", {
        repo: "acme/app",
        issueCount: 1,
        staleIssueCount: 0,
        daysSincePush: 1,
        daysSinceUpdate: 1,
        starsDelta: 1,
        forksDelta: 0,
        releaseCount: 1,
        totalDownloads: 10,
        recentDownloads: 10,
        viewsCount: 10,
        viewsUniques: 5,
        healthScore: 85,
        healthLabel: "strong",
        securityAlertsCount: 0,
        securityAlertsUnavailable: false,
        alerts: [],
        opportunities: [],
        correlations: [],
        latestReleasePublishedAt: "2026-04-20T10:00:00Z",
      }],
      ["acme/cli", {
        repo: "acme/cli",
        issueCount: 1,
        staleIssueCount: 1,
        daysSincePush: 40,
        daysSinceUpdate: 40,
        starsDelta: null,
        forksDelta: null,
        releaseCount: 0,
        totalDownloads: 0,
        recentDownloads: 0,
        viewsCount: 0,
        viewsUniques: 0,
        healthScore: 30,
        healthLabel: "risky",
        securityAlertsCount: 1,
        securityAlertsUnavailable: false,
        alerts: ["risk"],
        opportunities: [],
        correlations: [],
        latestReleasePublishedAt: null,
      }],
    ]);

    expect(sortRepos(repos, issues, "health_desc", insights).map((repo) => repo.nameWithOwner)).toEqual(["acme/app", "acme/cli"]);
    expect(sortRepos(repos, issues, "health_asc", insights).map((repo) => repo.nameWithOwner)).toEqual(["acme/cli", "acme/app"]);
  });

  it("builds PR facets from shared PR types", () => {
    const facets = buildPullRequestFacets(pullRequests);
    expect(facets.repos.get("acme/app")).toBe(2);
    expect(facets.authors.get("alice")).toBe(2);
    expect(facets.labels.get("ui")).toEqual({ count: 1, color: "0000ff" });
  });

  it("matches PR presets for review state and draft", () => {
    expect(matchesPullRequestPreset(pullRequests[0], "approved", "alice")).toBe(true);
    expect(matchesPullRequestPreset(pullRequests[1], "draft", "alice")).toBe(true);
    expect(matchesPullRequestPreset(pullRequests[1], "ready", "alice")).toBe(false);
    expect(matchesPullRequestPreset(pullRequests[2], "awaiting-review", "alice")).toBe(true);
    expect(matchesPullRequestPreset(pullRequests[0], "authored-me", "alice")).toBe(true);
  });

  it("filters PRs by repo, author and search", () => {
    const result = filterPullRequests(pullRequests, {
      search: "router",
      orgs: new Set(["acme"]),
      repos: new Set(["acme/app"]),
      labels: new Set(),
      authors: new Set(["alice"]),
      authorMode: "include",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");
    expect(result.map((pr) => pr.number)).toEqual([11]);
  });

  it("excludes selected pull request authors", () => {
    const result = filterPullRequests(pullRequests, {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      labels: new Set(),
      authors: new Set(["bob"]),
      authorMode: "exclude",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((pr) => pr.number)).toEqual([10, 11]);
  });

  it("sorts PRs by review-pending and diff size", () => {
    const byReview = sortPullRequests(pullRequests, "review_pending").map((pr) => pr.number);
    expect(byReview[0]).toBe(11);
    const bySize = sortPullRequests(pullRequests, "size_desc").map((pr) => pr.number);
    expect(bySize[0]).toBe(10);
    expect(bySize[bySize.length - 1]).toBe(4);
  });
});
