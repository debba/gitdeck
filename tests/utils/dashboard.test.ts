import { describe, expect, it } from "vitest";
import {
  buildIssueFacets,
  buildPullRequestFacets,
  filterIssues,
  filterPullRequests,
  filterRepos,
  countRepoFacets,
  countPullRequestSummary,
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

const roadmapBoard = { id: "PVT_roadmap", name: "acme/Roadmap", number: 1 };
const triageBoard = { id: "PVT_triage", name: "acme/Triage", number: 2 };

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
      boards: new Set(),
      excludedBoards: new Set(),
      boardMode: "include",
      labels: new Set(["bug"]),
      authors: new Set(),
      excludedAuthors: new Set(),
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
      boards: new Set(),
      excludedBoards: new Set(),
      boardMode: "include",
      labels: new Set(),
      authors: new Set(),
      excludedAuthors: new Set(["alice"]),
      authorMode: "exclude",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([2]);
  });

  it("includes and excludes issue authors at the same time", () => {
    const result = filterIssues(issues, {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      boards: new Set(),
      excludedBoards: new Set(),
      boardMode: "include",
      labels: new Set(),
      authors: new Set(["alice", "bob"]),
      excludedAuthors: new Set(["bob"]),
      authorMode: "exclude",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([1]);
  });

  it("counts issues per board", () => {
    const facets = buildIssueFacets([
      { ...issues[0], boards: [roadmapBoard, triageBoard] },
      { ...issues[1], boards: [roadmapBoard] },
    ]);

    expect([...facets.boards.entries()]).toEqual([["PVT_roadmap", { count: 2, label: "acme/Roadmap", number: 1 }], ["PVT_triage", { count: 1, label: "acme/Triage", number: 2 }]]);
  });

  it("separates matching board names and distinguishes their labels", () => {
    const otherRoadmap = { ...roadmapBoard, id: "PVT_other", number: 3 };
    const items = [{ ...issues[0], boards: [roadmapBoard] }, { ...issues[1], boards: [otherRoadmap] }];
    const facets = buildIssueFacets(items);
    expect([...facets.boards.values()].map((value) => value.label)).toEqual(["acme/Roadmap (#1)", "acme/Roadmap (#3)"]);
    const filters = {
      search: "", orgs: new Set<string>(), repos: new Set<string>(), boards: new Set([roadmapBoard.id]), excludedBoards: new Set<string>(), boardMode: "include" as const,
      labels: new Set<string>(), authors: new Set<string>(), excludedAuthors: new Set<string>(), authorMode: "include" as const,
      assignees: new Set<string>(), dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "",
    };
    expect(filterIssues(items, filters, "alice").map((item) => item.number)).toEqual([1]);
    expect(filterIssues([{ ...items[0], boards: [{ ...roadmapBoard, name: "acme/Renamed" }] }], filters, "alice")).toHaveLength(1);
  });

  it("filters issues by selected boards", () => {
    const result = filterIssues([
      { ...issues[0], boards: [roadmapBoard] },
      { ...issues[1], boards: [] },
    ], {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      boards: new Set(["PVT_roadmap"]),
      excludedBoards: new Set(),
      boardMode: "include",
      labels: new Set(),
      authors: new Set(),
      excludedAuthors: new Set(),
      authorMode: "include",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([1]);
  });

  it("excludes issues on excluded boards", () => {
    const result = filterIssues([
      { ...issues[0], boards: [roadmapBoard] },
      { ...issues[1], boards: [] },
    ], {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      boards: new Set(),
      excludedBoards: new Set(["PVT_roadmap"]),
      boardMode: "exclude",
      labels: new Set(),
      authors: new Set(),
      excludedAuthors: new Set(),
      authorMode: "include",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([2]);
  });

  it("includes and excludes boards at the same time", () => {
    const result = filterIssues([
      { ...issues[0], boards: [roadmapBoard] },
      { ...issues[1], boards: [roadmapBoard, triageBoard] },
    ], {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      boards: new Set(["PVT_roadmap"]),
      excludedBoards: new Set(["PVT_triage"]),
      boardMode: "exclude",
      labels: new Set(),
      authors: new Set(),
      excludedAuthors: new Set(),
      authorMode: "include",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([1]);
  });

  it("ignores excluded boards when issues carry no board data", () => {
    const result = filterIssues(issues, {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      boards: new Set(),
      excludedBoards: new Set(["PVT_roadmap"]),
      boardMode: "exclude",
      labels: new Set(),
      authors: new Set(),
      excludedAuthors: new Set(),
      authorMode: "include",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([1, 2]);
  });

  it("ignores selected boards when issues carry no board data", () => {
    const result = filterIssues(issues, {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      boards: new Set(["PVT_roadmap"]),
      excludedBoards: new Set(),
      boardMode: "include",
      labels: new Set(),
      authors: new Set(),
      excludedAuthors: new Set(),
      authorMode: "include",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((issue) => issue.number)).toEqual([1, 2]);
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
      excludedAuthors: new Set(),
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
      authors: new Set(),
      excludedAuthors: new Set(["bob"]),
      authorMode: "exclude",
      assignees: new Set(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    }, "alice");

    expect(result.map((pr) => pr.number)).toEqual([10, 11]);
  });

  it("includes and excludes pull request authors at the same time", () => {
    const result = filterPullRequests(pullRequests, {
      search: "",
      orgs: new Set(),
      repos: new Set(),
      labels: new Set(),
      authors: new Set(["alice", "bob"]),
      excludedAuthors: new Set(["bob"]),
      authorMode: "include",
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

  it("counts pull request summary cards from the provided list only", () => {
    const now = Date.parse("2026-04-30T12:00:00Z");
    const counts = countPullRequestSummary(pullRequests, now);

    expect(counts).toEqual({
      open: 3,
      drafts: 1,
      awaitingReview: 1,
      approved: 1,
      stale: 1,
    });
    expect(counts.awaitingReview).toBeLessThanOrEqual(counts.open);
    expect(counts.stale).toBeLessThanOrEqual(counts.open);
    expect(counts.drafts).toBeLessThanOrEqual(counts.open);
    expect(counts.approved).toBeLessThanOrEqual(counts.open);
  });

  it("does not let stale or awaiting-review cards exceed the filtered open count", () => {
    const now = Date.parse("2026-04-30T12:00:00Z");
    const emptyFilters = {
      search: "",
      orgs: new Set<string>(),
      repos: new Set<string>(),
      labels: new Set<string>(),
      authors: new Set<string>(),
      excludedAuthors: new Set<string>(),
      authorMode: "include" as const,
      assignees: new Set<string>(),
      dates: { cf: "", ct: "", uf: "", ut: "" },
      preset: "",
    };
    const archivedStale = {
      ...pullRequests[2],
      number: 469,
      title: "Archived project change",
      url: "https://gitlab.com/placeholder/python-api/-/merge_requests/469",
      repository: { name: "python-api", nameWithOwner: "placeholder/python-api" },
      isDraft: false,
      reviewDecision: null,
      reviewsCount: 0,
      updatedAt: "2026-03-01T10:00:00Z",
    };
    const loaded = [...pullRequests, archivedStale];
    const raw = countPullRequestSummary(loaded, now);
    const filtered = countPullRequestSummary(
      filterPullRequests(loaded, emptyFilters, "alice", new Set(["placeholder/python-api"])),
      now,
    );

    expect(raw.open).toBe(4);
    expect(raw.awaitingReview).toBe(2);
    expect(raw.stale).toBe(2);
    expect(filtered.open).toBe(3);
    expect(filtered.awaitingReview).toBe(1);
    expect(filtered.stale).toBe(1);
    expect(filtered.awaitingReview).toBeLessThanOrEqual(filtered.open);
    expect(filtered.stale).toBeLessThanOrEqual(filtered.open);
  });

  it("applies the current search and org filters to every summary card", () => {
    const now = Date.parse("2026-04-30T12:00:00Z");
    const filtered = countPullRequestSummary(
      filterPullRequests(pullRequests, {
        search: "router",
        orgs: new Set(["acme"]),
        repos: new Set<string>(),
        labels: new Set<string>(),
        authors: new Set<string>(),
        excludedAuthors: new Set<string>(),
        authorMode: "include",
        assignees: new Set<string>(),
        dates: { cf: "", ct: "", uf: "", ut: "" },
        preset: "",
      }, "alice"),
      now,
    );

    expect(filtered).toEqual({
      open: 1,
      drafts: 0,
      awaitingReview: 1,
      approved: 0,
      stale: 0,
    });
  });

  it("counts repo sidebar facets from the same list as the main view, hiding archived repos by default", () => {
    const archived = {
      ...repos[0],
      nameWithOwner: "acme/legacy",
      name: "legacy",
      description: "Archived app",
      isArchived: true,
      primaryLanguage: { name: "TypeScript" },
      url: "https://github.com/acme/legacy",
    };
    const otherOrg = {
      ...repos[0],
      nameWithOwner: "other/tools",
      name: "tools",
      owner: { login: "other" },
      description: "Tools",
      primaryLanguage: { name: "Python" },
      url: "https://github.com/other/tools",
    };
    const loaded = [...repos, archived, otherOrg];
    const baseFilters = {
      search: "",
      orgs: new Set<string>(),
      languages: new Set<string>(),
      visibility: "all" as const,
      includeForks: true,
      includeArchived: false,
    };

    const raw = {
      orgs: new Map<string, number>(),
      languages: new Map<string, number>(),
    };
    // document the bug: counting the unfiltered list includes archived repos
    for (const repo of loaded) {
      raw.orgs.set(repo.owner.login, (raw.orgs.get(repo.owner.login) || 0) + 1);
      const language = repo.primaryLanguage?.name || "—";
      raw.languages.set(language, (raw.languages.get(language) || 0) + 1);
    }
    expect(raw.orgs.get("acme")).toBe(3);
    expect(raw.languages.get("TypeScript")).toBe(2);

    const facets = countRepoFacets(loaded, issues, baseFilters);
    expect(facets.orgs.get("acme")).toBe(2);
    expect(facets.orgs.get("other")).toBe(1);
    expect(facets.languages.get("TypeScript")).toBe(1);
    expect(facets.languages.get("Go")).toBe(1);
    expect(facets.languages.get("Python")).toBe(1);
    expect(facets.orgs.get("acme")).toBeLessThan(raw.orgs.get("acme")!);
  });

  it("lets each repo facet ignore its own selection but honor the other filters", () => {
    const archived = {
      ...repos[0],
      nameWithOwner: "acme/legacy",
      name: "legacy",
      description: "Archived app",
      isArchived: true,
      primaryLanguage: { name: "TypeScript" },
      url: "https://github.com/acme/legacy",
    };
    const otherOrg = {
      ...repos[0],
      nameWithOwner: "other/tools",
      name: "tools",
      owner: { login: "other" },
      description: "Tools",
      primaryLanguage: { name: "Python" },
      url: "https://github.com/other/tools",
    };
    const loaded = [...repos, archived, otherOrg];

    const orgSelected = countRepoFacets(loaded, issues, {
      search: "",
      orgs: new Set(["acme"]),
      languages: new Set(),
      visibility: "all",
      includeForks: true,
      includeArchived: false,
    });
    // Org counts ignore the org selection, so other orgs stay visible.
    expect(orgSelected.orgs.get("acme")).toBe(2);
    expect(orgSelected.orgs.get("other")).toBe(1);
    // Language counts respect the org filter and still hide archived repos.
    expect(orgSelected.languages.get("TypeScript")).toBe(1);
    expect(orgSelected.languages.get("Go")).toBe(1);
    expect(orgSelected.languages.has("Python")).toBe(false);

    const languageSelected = countRepoFacets(loaded, issues, {
      search: "",
      orgs: new Set(),
      languages: new Set(["Go"]),
      visibility: "all",
      includeForks: true,
      includeArchived: false,
    });
    // Language counts ignore the language selection.
    expect(languageSelected.languages.get("TypeScript")).toBe(1);
    expect(languageSelected.languages.get("Go")).toBe(1);
    expect(languageSelected.languages.get("Python")).toBe(1);
    // Org counts respect the language filter: only acme has Go.
    expect(languageSelected.orgs.get("acme")).toBe(1);
    expect(languageSelected.orgs.has("other")).toBe(false);
  });
});
