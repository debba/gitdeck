import { afterEach, describe, expect, it, vi } from "vitest";
import { GitLabProvider } from "../../../src/server/providers/gitlab";
import type { Account, ProviderConfig } from "../../../src/server/providers/types";

const config: ProviderConfig = {
  id: "gitlab.com",
  kind: "gitlab",
  label: "GitLab",
  baseUrl: "https://gitlab.com/api/v4",
  webUrl: "https://gitlab.com",
  userAgent: "gitdeck",
};

const account: Account = {
  id: "gl_alice_gitlab.com",
  providerKind: "gitlab",
  providerConfigId: "gitlab.com",
  label: "alice (gitlab.com)",
  login: "alice",
  accessToken: "glpat-secret",
  scope: "api",
  obtainedAt: "2026-01-01T00:00:00Z",
  source: "token",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("GitLabProvider", () => {
  it("authenticates PATs with GitLab's private token header", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("glpat-secret");
      return json({ id: 1, username: "alice", avatar_url: "https://img/alice.png", web_url: "https://gitlab.com/alice" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const identity = await new GitLabProvider(config).fetchIdentity(account.accessToken);

    expect(identity.login).toBe("alice");
    expect(identity.avatarUrl).toBe("https://img/alice.png");
  });

  it("normalizes projects, issues, and merge requests", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/projects?")) return json([{
        id: 10,
        name: "deck",
        path_with_namespace: "team/tools/deck",
        description: "Dashboard",
        web_url: "https://gitlab.com/team/tools/deck",
        namespace: { full_path: "team/tools" },
        star_count: 4,
        forks_count: 2,
        open_issues_count: 3,
        last_activity_at: "2026-06-01T00:00:00Z",
        visibility: "private",
        archived: false,
      }]);
      if (url.includes("/merge_requests?")) return json([{
        iid: 8,
        title: "Ship it",
        web_url: "https://gitlab.com/team/tools/deck/-/merge_requests/8",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        author: { id: 1, username: "alice" },
        labels: ["feature"],
        assignees: [],
        user_notes_count: 2,
        references: { full: "team/tools/deck!8" },
        source_branch: "feature",
        target_branch: "main",
        draft: true,
      }]);
      return json([{
        iid: 7,
        title: "A bug",
        web_url: "https://gitlab.com/team/tools/deck/-/issues/7",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        author: { id: 1, username: "alice" },
        labels: ["bug"],
        assignees: [],
        user_notes_count: 1,
        references: { full: "team/tools/deck#7" },
      }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GitLabProvider(config);

    const [repos, issues, mergeRequests] = await Promise.all([
      provider.listRepos(account, []),
      provider.listIssues(account, []),
      provider.listPullRequests(account, []),
    ]);

    expect(repos[0]).toMatchObject({ nameWithOwner: "team/tools/deck", stargazerCount: 4, isPrivate: true });
    expect(issues[0]).toMatchObject({ number: 7, repository: { nameWithOwner: "team/tools/deck" } });
    expect(mergeRequests[0]).toMatchObject({
      number: 8,
      isDraft: true,
      headRefName: "feature",
      baseRefName: "main",
      headCheck: null,
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/pipelines"))).toBe(false);
  });

  it("uses an embedded head pipeline without a follow-up request", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return json([{
        iid: 8,
        project_id: 10,
        title: "Ship it",
        web_url: "https://gitlab.com/team/tools/deck/-/merge_requests/8",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        author: { id: 1, username: "alice" },
        references: { full: "team/tools/deck!8" },
        sha: "abc",
        source_branch: "feature",
        head_pipeline: {
          id: 42,
          status: "success",
          sha: "abc",
          web_url: "https://gitlab.com/team/tools/deck/-/pipelines/42",
        },
      }]);
    }));

    const [mergeRequest] = await new GitLabProvider(config).listPullRequests(account, []);

    expect(mergeRequest.headCheck).toEqual({
      status: "success",
      url: "https://gitlab.com/team/tools/deck/-/pipelines/42",
    });
    expect(calls.some((url) => url.includes("/pipelines"))).toBe(false);
  });

  it("loads the latest head pipeline per project for self-hosted instances", async () => {
    const hosted = {
      ...config,
      id: "gitlab-git.example.com",
      baseUrl: "https://git.example.com/gitlab/api/v4",
      webUrl: "https://git.example.com/gitlab",
    };
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/pipelines?")) {
        expect(url.startsWith("https://git.example.com/gitlab/api/v4/projects/10/pipelines?")).toBe(true);
        return json([
          { id: 8, status: "running", sha: "other", ref: "feature", web_url: "https://git.example.com/gitlab/team/app/-/pipelines/8" },
          { id: 7, status: "failed", sha: "head", ref: "feature", web_url: "https://git.example.com/gitlab/team/app/-/pipelines/7" },
        ]);
      }
      return json([
        {
          iid: 3,
          project_id: 10,
          title: "Fix",
          web_url: "https://git.example.com/gitlab/team/app/-/merge_requests/3",
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          author: { id: 1, username: "alice" },
          references: { full: "team/app!3" },
          sha: "head",
          source_branch: "feature",
          head_pipeline: null,
        },
        {
          iid: 4,
          project_id: 10,
          title: "Docs",
          web_url: "https://git.example.com/gitlab/team/app/-/merge_requests/4",
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          author: { id: 1, username: "alice" },
          references: { full: "team/app!4" },
          sha: "stale",
          source_branch: "feature",
        },
      ]);
    }));

    const mergeRequests = await new GitLabProvider(hosted).listPullRequests(account, []);

    expect(mergeRequests.map((mergeRequest) => mergeRequest.headCheck)).toEqual([
      { status: "failed", url: "https://git.example.com/gitlab/team/app/-/pipelines/7" },
      { status: "running", url: "https://git.example.com/gitlab/team/app/-/pipelines/8" },
    ]);
    expect(calls.filter((url) => url.includes("/pipelines?"))).toHaveLength(1);
  });

  it("keeps merge requests when a pipeline is missing or the project denies pipeline access", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/pipelines?")) return json({ message: "403 Forbidden" }, 403);
      return json([{
        iid: 5,
        project_id: 11,
        title: "Quiet",
        web_url: "https://gitlab.com/team/app/-/merge_requests/5",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        author: { id: 1, username: "alice" },
        references: { full: "team/app!5" },
        sha: "none",
        source_branch: "quiet",
      }]);
    }));

    const [mergeRequest] = await new GitLabProvider(config).listPullRequests(account, []);

    expect(mergeRequest).toMatchObject({ number: 5, headCheck: null });
  });

  it("stops pipeline lookups on a rate limit and still returns the merge requests", async () => {
    const pipelineCalls: string[] = [];
    const mergeRequestPages = Array.from({ length: 6 }, (_, index) => ({
      iid: index + 1,
      project_id: index + 1,
      title: `MR ${index + 1}`,
      web_url: `https://gitlab.com/group/app-${index}/-/merge_requests/${index + 1}`,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      author: { id: 1, username: "alice" },
      references: { full: `group/app-${index}!${index + 1}` },
      sha: `sha-${index}`,
      source_branch: "feature",
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/pipelines?")) {
        pipelineCalls.push(url);
        await new Promise((resolve) => setTimeout(resolve, 15));
        return json({ message: "429 Too Many Requests" }, 429);
      }
      return json(mergeRequestPages);
    }));

    const mergeRequests = await new GitLabProvider(config).listPullRequests(account, []);

    expect(mergeRequests).toHaveLength(6);
    expect(mergeRequests.every((mergeRequest) => mergeRequest.headCheck === null)).toBe(true);
    expect(pipelineCalls.length).toBeGreaterThan(0);
    expect(pipelineCalls.length).toBeLessThan(mergeRequestPages.length);
  });

  it("returns no merge requests when the list itself is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "429 Too Many Requests" }, 429)));

    await expect(new GitLabProvider(config).listPullRequests(account, [])).resolves.toEqual([]);
  });

  it("maps pending todos to inbox notifications and marks them done", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("mark_as_done")) {
        expect(init?.method).toBe("POST");
        return new Response(null, { status: 204 });
      }
      return json([{
        id: 44,
        action_name: "review_requested",
        created_at: "2026-06-01T00:00:00Z",
        target_type: "MergeRequest",
        target: { iid: 8, title: "Ship it", web_url: "https://gitlab.com/team/deck/-/merge_requests/8" },
        project: {
          id: 10,
          name: "deck",
          path_with_namespace: "team/deck",
          web_url: "https://gitlab.com/team/deck",
          namespace: { full_path: "team" },
          description: null,
          star_count: 0,
          forks_count: 0,
          last_activity_at: "2026-06-01T00:00:00Z",
          visibility: "public",
          archived: false,
        },
      }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GitLabProvider(config);

    const result = await provider.fetchNotifications(account, null);
    expect(result.ok && result.notifications[0]).toMatchObject({ id: "44", reason: "review_requested", itemNumber: 8 });
    await expect(provider.markNotificationRead(account, "44")).resolves.toMatchObject({ ok: true, status: 204 });
  });
});
