import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAuthRequiredError, GitHubProvider } from "../../../src/server/providers/github";
import type { Account, ProviderConfig } from "../../../src/server/providers/types";

const config: ProviderConfig = {
  id: "github.com",
  kind: "github",
  label: "GitHub",
  baseUrl: "https://api.github.com",
  webUrl: "https://github.com",
  userAgent: "gitdeck",
};

const account: Account = {
  id: "gh_alice_github.com",
  providerKind: "github",
  providerConfigId: "github.com",
  label: "alice (github.com)",
  login: "alice",
  accessToken: "gho-secret",
  scope: "repo",
  obtainedAt: "2026-01-01T00:00:00Z",
  source: "token",
};

const issueNode = {
  __typename: "Issue",
  number: 1,
  title: "Fix dark mode contrast",
  url: "https://github.com/acme/app/issues/1",
  createdAt: "2026-04-20T10:00:00Z",
  updatedAt: "2026-04-22T10:00:00Z",
  author: { login: "alice", url: "https://github.com/alice" },
  repository: { name: "app", nameWithOwner: "acme/app" },
  labels: { nodes: [] },
  comments: { totalCount: 4 },
  assignees: { nodes: [] },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function searchResult(nodes: unknown[]): Response {
  return json({ data: { search: { pageInfo: { endCursor: null, hasNextPage: false }, nodes } } });
}

function requestsBoards(init?: RequestInit): boolean {
  return String(init?.body).includes("projectItems");
}

afterEach(() => vi.unstubAllGlobals());

describe("GitHubProvider.listIssues", () => {
  it("attaches the open boards of each issue", async () => {
    const fetchMock = vi.fn(async () => searchResult([{
      ...issueNode,
      projectItems: {
        nodes: [
          { project: { title: "Roadmap", closed: false, owner: { login: "acme" } } },
          { project: { title: "Archive", closed: true, owner: { login: "acme" } } },
        ],
      },
    }]));
    vi.stubGlobal("fetch", fetchMock);

    const issues = await new GitHubProvider(config).listIssues(account, ["acme"]);

    expect(issues.map((issue) => issue.boards)).toEqual([["acme/Roadmap"]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still lists issues when the token cannot read boards", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (requestsBoards(init)) {
        return json({ errors: [{ message: "Your token has not been granted the required scopes to execute this query." }] });
      }
      return searchResult([issueNode]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const issues = await new GitHubProvider(config).listIssues(account, ["acme"]);

    expect(issues.map((issue) => issue.number)).toEqual([1]);
    expect(issues[0].boards).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when authentication is required", async () => {
    const fetchMock = vi.fn(async () => json({ message: "Bad credentials" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new GitHubProvider(config).listIssues(account, ["acme"])).rejects.toBeInstanceOf(GitHubAuthRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
