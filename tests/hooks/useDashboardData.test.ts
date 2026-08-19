import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate } from "../../src/api/cache";
import { useDashboardData, type DashboardDataState } from "../../src/hooks/useDashboardData";
import type { DashboardTab } from "../../src/utils/dataRequirements";

const api = vi.hoisted(() => ({
  fetchRepos: vi.fn(),
  fetchIssues: vi.fn(),
  fetchPullRequests: vi.fn(),
}));

vi.mock("../../src/api/github", () => ({
  AuthRequiredClientError: class AuthRequiredClientError extends Error {},
  fetchRepos: api.fetchRepos,
  fetchIssues: api.fetchIssues,
  fetchPullRequests: api.fetchPullRequests,
}));

interface HarnessProps {
  tab: DashboardTab;
  accountKey?: string;
  routeRepoName?: string;
  repositoryDetail?: string;
}

let latest: DashboardDataState;
let root: Root;
let container: HTMLDivElement;

function Harness(props: HarnessProps) {
  latest = useDashboardData({
    authenticated: true,
    accountsLoading: false,
    accountKey: props.accountKey ?? "account-a",
    tab: props.tab,
    routeRepoName: props.routeRepoName ?? "",
    repositoryDetail: props.repositoryDetail,
    onAuthRequired: vi.fn(),
  });
  return null;
}

const reposResult = (name: string) => ({
  ok: true as const,
  repos: [{ nameWithOwner: name }],
  owners: [name.split("/")[0]],
  fetchedAt: "2026-01-01T00:00:00.000Z",
});
const issuesResult = { ok: true as const, issues: [], owners: [], fetchedAt: "2026-01-01T00:00:00.000Z" };
const prsResult = { ok: true as const, pullRequests: [], owners: [], fetchedAt: "2026-01-01T00:00:00.000Z" };

async function render(props: HarnessProps) {
  await act(async () => {
    root.render(createElement(Harness, props));
    await Promise.resolve();
  });
}

beforeEach(() => {
  invalidate();
  localStorage.clear();
  api.fetchRepos.mockReset().mockResolvedValue(reposResult("owner/repo"));
  api.fetchIssues.mockReset().mockResolvedValue(issuesResult);
  api.fetchPullRequests.mockReset().mockResolvedValue(prsResult);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  invalidate();
});

describe("useDashboardData lazy loading", () => {
  it("loads only resources required by the active tab", async () => {
    await render({ tab: "repos" });
    expect(api.fetchRepos).toHaveBeenCalledTimes(1);
    expect(api.fetchIssues).not.toHaveBeenCalled();
    expect(api.fetchPullRequests).not.toHaveBeenCalled();

    await render({ tab: "issues" });
    expect(api.fetchIssues).toHaveBeenCalledTimes(1);
    expect(api.fetchPullRequests).not.toHaveBeenCalled();
  });

  it("loads the resource required by a deep-linked repository section", async () => {
    await render({ tab: "repos", routeRepoName: "owner/repo", repositoryDetail: "pull-requests" });
    expect(api.fetchRepos).toHaveBeenCalledTimes(1);
    expect(api.fetchPullRequests).toHaveBeenCalledTimes(1);
    expect(api.fetchIssues).not.toHaveBeenCalled();
  });

  it("deduplicates an in-flight resource while switching tabs", async () => {
    let resolveRepos!: (value: ReturnType<typeof reposResult>) => void;
    api.fetchRepos.mockImplementationOnce(() => new Promise((resolve) => { resolveRepos = resolve; }));

    await render({ tab: "repos" });
    await render({ tab: "issues" });
    expect(api.fetchRepos).toHaveBeenCalledTimes(1);
    expect(api.fetchIssues).toHaveBeenCalledTimes(1);

    await act(async () => resolveRepos(reposResult("owner/repo")));
  });

  it("aborts stale requests and ignores their result after an account switch", async () => {
    let oldSignal: AbortSignal | undefined;
    let resolveOld!: (value: ReturnType<typeof reposResult>) => void;
    api.fetchRepos
      .mockImplementationOnce((_fresh: boolean, signal?: AbortSignal) => {
        oldSignal = signal;
        return new Promise((resolve) => { resolveOld = resolve; });
      })
      .mockResolvedValueOnce(reposResult("new/repo"));

    await render({ tab: "repos", accountKey: "account-a" });
    await render({ tab: "repos", accountKey: "account-b" });
    expect(oldSignal?.aborted).toBe(true);
    expect(latest.repos[0]?.nameWithOwner).toBe("new/repo");

    await act(async () => resolveOld(reposResult("old/repo")));
    expect(latest.repos[0]?.nameWithOwner).toBe("new/repo");
  });

  it("supports an explicit fresh refresh of the current resources", async () => {
    await render({ tab: "prs" });
    expect(api.fetchPullRequests).toHaveBeenCalledWith(false, expect.any(AbortSignal));

    await act(async () => latest.loadData(new Set(["repos", "prs"]), true));
    expect(api.fetchRepos).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
    expect(api.fetchPullRequests).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
  });
});
