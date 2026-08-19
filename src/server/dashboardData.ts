import type { GhIssue, GhPullRequest, GhRepo } from "../types/github";
import { getActive as getActiveAccount } from "./accountStore";
import { AuthRequiredError } from "./githubClient";
import { getProviderForAccount } from "./providers/registry";
import type { Account, OwnersOutcome, Provider } from "./providers/types";
import { attachHistory, recordSnapshots } from "./snapshots";
import { measureProviderCall } from "./providerDiagnostics";

export type ReposResult =
  | { ok: true; repos: GhRepo[]; owners: string[]; fetchedAt: string }
  | { ok: false; error: string; needsAuth?: true };

export type IssuesResult =
  | { ok: true; issues: GhIssue[]; owners: string[]; fetchedAt: string }
  | { ok: false; error: string; needsAuth?: true };

export type PullRequestsResult =
  | { ok: true; pullRequests: GhPullRequest[]; owners: string[]; fetchedAt: string }
  | { ok: false; error: string; needsAuth?: true };

const TTL_MS = 5 * 60 * 1000;

interface Memoized<T extends { ok: boolean }> {
  get(forceFresh: boolean): Promise<T>;
  invalidate(): void;
}

function memoize<T extends { ok: boolean }>(ttlMs: number, fetcher: () => Promise<T>): Memoized<T> {
  let cache: { value: T; expiresAt: number } | null = null;
  let inflight: Promise<T> | null = null;
  return {
    async get(forceFresh: boolean): Promise<T> {
      if (!forceFresh && cache && cache.expiresAt > Date.now()) return cache.value;
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const value = await fetcher();
          if (value.ok) cache = { value, expiresAt: Date.now() + ttlMs };
          return value;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    invalidate() {
      cache = null;
    },
  };
}

function authFail(): { ok: false; error: string; needsAuth: true } {
  return { ok: false, error: "authentication required", needsAuth: true };
}

function genericFail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: (error as Error).message || String(error) };
}

async function resolveActive(): Promise<{ account: Account; provider: Provider } | null> {
  const account = await getActiveAccount();
  if (!account) return null;
  const provider = await getProviderForAccount(account);
  return { account, provider };
}

const ownersStore = memoize<OwnersOutcome>(TTL_MS, async (): Promise<OwnersOutcome> => {
  const active = await resolveActive();
  if (!active) return authFail();
  return measureProviderCall("owners", () => active.provider.listOwners(active.account));
});

const reposStore = memoize<ReposResult>(TTL_MS, async (): Promise<ReposResult> => {
  const ownersResult = await ownersStore.get(false);
  if (!ownersResult.ok) return ownersResult.needsAuth ? authFail() : { ok: false, error: ownersResult.error };
  try {
    const active = await resolveActive();
    if (!active) return authFail();
    const repos = await measureProviderCall("repos", () => active.provider.listRepos(active.account, ownersResult.owners));
    try {
      await recordSnapshots(repos);
      await attachHistory(repos);
    } catch {
      // Snapshot/history is best-effort.
    }
    return { ok: true, repos, owners: ownersResult.owners, fetchedAt: new Date().toISOString() };
  } catch (error: unknown) {
    if (error instanceof AuthRequiredError) return authFail();
    return genericFail(error);
  }
});

const issuesStore = memoize<IssuesResult>(TTL_MS, async (): Promise<IssuesResult> => {
  const ownersResult = await ownersStore.get(false);
  if (!ownersResult.ok) return ownersResult.needsAuth ? authFail() : { ok: false, error: ownersResult.error };
  try {
    const active = await resolveActive();
    if (!active) return authFail();
    const issues = await measureProviderCall("issues", () => active.provider.listIssues(active.account, ownersResult.owners));
    return { ok: true, issues, owners: ownersResult.owners, fetchedAt: new Date().toISOString() };
  } catch (error: unknown) {
    if (error instanceof AuthRequiredError) return authFail();
    return genericFail(error);
  }
});

const pullRequestsStore = memoize<PullRequestsResult>(TTL_MS, async (): Promise<PullRequestsResult> => {
  const ownersResult = await ownersStore.get(false);
  if (!ownersResult.ok) return ownersResult.needsAuth ? authFail() : { ok: false, error: ownersResult.error };
  try {
    const active = await resolveActive();
    if (!active) return authFail();
    const pullRequests = await measureProviderCall("pullRequests", () => active.provider.listPullRequests(active.account, ownersResult.owners));
    return { ok: true, pullRequests, owners: ownersResult.owners, fetchedAt: new Date().toISOString() };
  } catch (error: unknown) {
    if (error instanceof AuthRequiredError) return authFail();
    return genericFail(error);
  }
});

export function getReposCached(forceFresh: boolean): Promise<ReposResult> {
  if (forceFresh) ownersStore.invalidate();
  return reposStore.get(forceFresh);
}

export function getIssuesCached(forceFresh: boolean): Promise<IssuesResult> {
  if (forceFresh) ownersStore.invalidate();
  return issuesStore.get(forceFresh);
}

export function getPullRequestsCached(forceFresh: boolean): Promise<PullRequestsResult> {
  if (forceFresh) ownersStore.invalidate();
  return pullRequestsStore.get(forceFresh);
}

export function invalidateDataCache(): void {
  ownersStore.invalidate();
  reposStore.invalidate();
  issuesStore.invalidate();
  pullRequestsStore.invalidate();
}
