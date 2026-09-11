import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIssuesCached: vi.fn(),
  getPullRequestsCached: vi.fn(),
  getReposCached: vi.fn(),
  getRepositoryContentSources: vi.fn(),
  listGoals: vi.fn(),
  restApi: vi.fn(),
  getRepositorySnapshotHistory: vi.fn(),
}));

vi.mock("../../src/server/dashboardData", () => ({
  getIssuesCached: mocks.getIssuesCached,
  getPullRequestsCached: mocks.getPullRequestsCached,
  getReposCached: mocks.getReposCached,
}));
vi.mock("../../src/server/goalStore", () => ({
  getRepositoryContentSources: mocks.getRepositoryContentSources,
  listGoals: mocks.listGoals,
}));
vi.mock("../../src/server/githubClient", () => ({ restApi: mocks.restApi }));
vi.mock("../../src/server/snapshots", () => ({
  getRepositorySnapshotHistory: mocks.getRepositorySnapshotHistory,
}));

const {
  collectRepositorySignals,
  fetchRecentlyMergedPullRequests,
  fetchWebsiteSignal,
} = await import("../../src/server/growth/signals");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIssuesCached.mockResolvedValue({
    ok: true,
    issues: [
      { repository: { name: "rocket", nameWithOwner: "acme/rocket" }, title: "Improve docs", updatedAt: "2026-09-03T00:00:00Z" },
      { repository: { name: "other", nameWithOwner: "acme/other" }, title: "Ignore", updatedAt: "2026-09-03T00:00:00Z" },
    ],
  });
  mocks.getPullRequestsCached.mockResolvedValue({
    ok: true,
    pullRequests: [
      { repository: { name: "rocket", nameWithOwner: "acme/rocket" }, title: "Add launch mode", updatedAt: "2026-09-03T00:00:00Z" },
    ],
  });
  mocks.getReposCached.mockResolvedValue({
    ok: true,
    repos: [{ nameWithOwner: "acme/rocket", description: "Fast", stargazerCount: 95, forkCount: 8 }],
  });
  mocks.getRepositoryContentSources.mockReturnValue([{ type: "repository", value: "acme/docs" }]);
  mocks.listGoals.mockReturnValue([{
    id: "goal-1",
    accountId: "account-a",
    repository: "acme/rocket",
    metric: "stars",
    targetValue: 100,
    currentValue: 50,
    deadline: "2099-12-31",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    suggestions: [],
    suggestionsGeneratedAt: null,
  }]);
  mocks.getRepositorySnapshotHistory.mockResolvedValue([
    { date: "2026-09-03", stars: 94, forks: 8 },
    { date: "2026-09-04", stars: 95, forks: 8 },
  ]);
  mocks.restApi.mockImplementation(async (path: string) => {
    if (path.includes("/pulls?")) {
      return {
        ok: true,
        data: [{
          number: 42,
          merged_at: "2026-09-03T00:00:00Z",
        }],
      };
    }
    if (path.endsWith("/pulls/42")) {
      return {
        ok: true,
        data: {
          number: 42,
          title: "Ship launch mode",
          html_url: "https://github.com/acme/rocket/pull/42",
          merged_at: "2026-09-03T00:00:00Z",
          additions: 480,
          deletions: 20,
          changed_files: 12,
        },
      };
    }
    if (path.endsWith("/readme")) {
      return {
        ok: true,
        data: {
          encoding: "base64",
          content: Buffer.from("# Rocket\n\n![Dashboard](images/dashboard.png)").toString("base64"),
          download_url: `https://raw.example/${path.split("/")[2]}/${path.split("/")[3]}/README.md`,
        },
      };
    }
    if (path.includes("/releases")) return { ok: true, data: [{ tag_name: "v1.0.0", published_at: "2026-09-04T00:00:00Z" }] };
    if (path.includes("/commits")) {
      return { ok: true, data: [{ sha: "abc", html_url: "https://example.com/commit/abc", commit: { message: "Ship launch mode" } }] };
    }
    return { ok: false, error: "not found" };
  });
});

describe("Growth repository signals", () => {
  it("collects repository activity, sources, retained history, commits, and goal progress", async () => {
    const signals = await collectRepositorySignals("account-a", "acme/rocket");

    expect(signals.repositoryMetadata?.description).toBe("Fast");
    expect(signals.openIssues.map(({ title }) => title)).toEqual(["Improve docs"]);
    expect(signals.openPullRequests.map(({ title }) => title)).toEqual(["Add launch mode"]);
    expect(signals.releases[0].tag_name).toBe("v1.0.0");
    expect(signals.readme?.excerpt).toContain("# Rocket");
    expect(signals.readme?.mediaUrls).toContain("https://raw.example/acme/rocket/images/dashboard.png");
    expect(signals.additionalSources).toHaveLength(1);
    expect(signals.recentCommits[0].sha).toBe("abc");
    expect(signals.starHistory).toHaveLength(2);
    expect(signals.mergedPullRequests).toEqual([
      expect.objectContaining({ number: 42, additions: 480, deletions: 20, changedFiles: 12 }),
    ]);
    expect(signals.goals).toEqual([
      expect.objectContaining({
        id: "goal-1",
        createdAt: "2026-09-01T00:00:00Z",
        percentage: 50,
        completed: false,
        overdue: false,
      }),
    ]);
    expect(mocks.getRepositoryContentSources).toHaveBeenCalledWith("account-a", "acme/rocket");
    expect(mocks.restApi).toHaveBeenCalledWith("/repos/acme/rocket/commits?per_page=20");
    expect(mocks.restApi).toHaveBeenCalledWith(
      "/repos/acme/rocket/pulls?state=closed&sort=updated&direction=desc&per_page=20",
    );
    expect(mocks.restApi).toHaveBeenCalledWith("/repos/acme/rocket/pulls/42");
  });

  it("bounds merged pull-request detail reads at twenty and fails closed when details are unavailable", async () => {
    mocks.restApi.mockImplementation(async (path: string) => {
      if (path.includes("/pulls?")) {
        return {
          ok: true,
          data: Array.from({ length: 25 }, (_, index) => ({
            number: index + 1,
            merged_at: "2026-09-03T00:00:00Z",
          })),
        };
      }
      if (path.includes("/pulls/")) return { ok: false, error: "unavailable" };
      return { ok: false, error: "not found" };
    });

    await expect(fetchRecentlyMergedPullRequests("acme/rocket")).resolves.toEqual([]);
    expect(mocks.restApi.mock.calls.filter(([path]) => /\/pulls\/\d+$/.test(path))).toHaveLength(20);
  });

  it("rejects local website sources before making a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(fetchWebsiteSignal("http://localhost/private")).resolves.toMatchObject({
      type: "website",
      error: "private source URL",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
