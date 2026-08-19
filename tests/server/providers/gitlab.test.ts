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
    expect(mergeRequests[0]).toMatchObject({ number: 8, isDraft: true, headRefName: "feature", baseRefName: "main" });
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
