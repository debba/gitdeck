import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthRequiredClientError,
  fetchIssues,
  fetchPullRequests,
  fetchRepos,
} from "../api/github";
import { invalidate, peek, swr } from "../api/cache";
import type {
  GhIssue,
  GhPullRequest,
  GhRepo,
  IssuesData,
  PullRequestsData,
  ReposData,
} from "../types/github";
import {
  allDashboardResources,
  dataRequirementsForTab,
  type DashboardResource,
  type DashboardTab,
} from "../utils/dataRequirements";
import { beginDashboardLoad } from "../utils/loadDiagnostics";
import { clearStatsCache, readStatsCache, writeStatsCache } from "../utils/statsCache";

const CACHE_KEY = {
  repos: "/api/repos",
  issues: "/api/issues",
  prs: "/api/prs",
} as const;

interface UseDashboardDataOptions {
  authenticated: boolean;
  accountsLoading: boolean;
  accountKey: string | null;
  tab: DashboardTab;
  routeRepoName: string;
  repositoryDetail?: string;
  onAuthRequired(): void;
  onAccountChange?(): void;
}

export interface DashboardDataState {
  issues: GhIssue[];
  pullRequests: GhPullRequest[];
  repos: GhRepo[];
  owners: string[];
  fetchedAt: string;
  loading: boolean;
  dataStale: boolean;
  error: string;
  loadData(resources: Set<DashboardResource>, fresh?: boolean): void;
  loadAll(fresh?: boolean): void;
  resetData(): void;
}

/** Owns base dashboard resource loading, cancellation, caching and persistence. */
export function useDashboardData(options: UseDashboardDataOptions): DashboardDataState {
  const {
    authenticated,
    accountsLoading,
    accountKey,
    tab,
    routeRepoName,
    repositoryDetail,
    onAuthRequired,
    onAccountChange,
  } = options;
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [pullRequests, setPullRequests] = useState<GhPullRequest[]>([]);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [fetchedAt, setFetchedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataStale, setDataStale] = useState(false);
  const [error, setError] = useState("");
  const abortControllersRef = useRef(new Set<AbortController>());
  const activeLoadsRef = useRef(0);
  const loadedAccountRef = useRef<string | null>(null);
  const activeViewRef = useRef(tab);
  const onAuthRequiredRef = useRef(onAuthRequired);
  const onAccountChangeRef = useRef(onAccountChange);
  activeViewRef.current = tab;
  onAuthRequiredRef.current = onAuthRequired;
  onAccountChangeRef.current = onAccountChange;

  const abortLoads = useCallback(() => {
    for (const controller of abortControllersRef.current) controller.abort();
    abortControllersRef.current.clear();
    activeLoadsRef.current = 0;
    setLoading(false);
    setDataStale(false);
  }, []);

  const clearData = useCallback(() => {
    setIssues([]);
    setPullRequests([]);
    setRepos([]);
    setOwners([]);
    setFetchedAt("");
    setError("");
  }, []);

  const resetData = useCallback(() => {
    abortLoads();
    invalidate();
    clearData();
    clearStatsCache();
  }, [abortLoads, clearData]);

  const loadData = useCallback((resources: Set<DashboardResource>, fresh = false) => {
    if (!resources.size) return;
    const controller = new AbortController();
    abortControllersRef.current.add(controller);
    setError("");

    const cachedRepos = resources.has("repos") ? peek<ReposData>(CACHE_KEY.repos) : null;
    if (cachedRepos) {
      setRepos(cachedRepos.repos);
      setOwners(cachedRepos.owners);
      setFetchedAt(cachedRepos.fetchedAt);
    }
    const cachedIssues = resources.has("issues") ? peek<IssuesData>(CACHE_KEY.issues) : null;
    if (cachedIssues) setIssues(cachedIssues.issues);
    const cachedPrs = resources.has("prs") ? peek<PullRequestsData>(CACHE_KEY.prs) : null;
    if (cachedPrs) setPullRequests(cachedPrs.pullRequests);

    if (!cachedRepos && !cachedIssues && !cachedPrs) {
      const persisted = readStatsCache();
      if (persisted) {
        setRepos(persisted.repos as GhRepo[]);
        setOwners(persisted.owners);
        setIssues(persisted.issues as GhIssue[]);
        setPullRequests(persisted.pullRequests as GhPullRequest[]);
        if (persisted.fetchedAt) setFetchedAt(persisted.fetchedAt);
      }
    }

    const diagnostics = beginDashboardLoad(activeViewRef.current, resources, fresh);
    let pending = resources.size;
    activeLoadsRef.current += 1;
    setLoading(true);
    setDataStale(true);

    const finish = (resource: DashboardResource, ok: boolean) => {
      diagnostics.finishResource(resource, ok);
      pending -= 1;
      if (pending > 0 || !abortControllersRef.current.has(controller)) return;
      abortControllersRef.current.delete(controller);
      activeLoadsRef.current = Math.max(0, activeLoadsRef.current - 1);
      if (activeLoadsRef.current === 0) {
        setLoading(false);
        setDataStale(false);
      }
    };
    const handleFailure = (err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof AuthRequiredClientError) {
        onAuthRequiredRef.current();
        return;
      }
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    };

    if (resources.has("repos")) {
      const result = swr<ReposData>(CACHE_KEY.repos, (signal) => fetchRepos(fresh, signal), {
        fresh,
        signal: controller.signal,
      });
      diagnostics.startResource("repos", result.source);
      void result.promise.then((data) => {
        if (!controller.signal.aborted) {
          setRepos(data.repos);
          setOwners(data.owners);
          setFetchedAt(data.fetchedAt);
        }
        return true;
      }, (err) => {
        handleFailure(err);
        return false;
      }).then((ok) => finish("repos", ok));
    }

    if (resources.has("issues")) {
      const result = swr<IssuesData>(CACHE_KEY.issues, (signal) => fetchIssues(fresh, signal), {
        fresh,
        signal: controller.signal,
      });
      diagnostics.startResource("issues", result.source);
      void result.promise.then((data) => {
        if (!controller.signal.aborted) setIssues(data.issues);
        return true;
      }, (err) => {
        handleFailure(err);
        return false;
      }).then((ok) => finish("issues", ok));
    }

    if (resources.has("prs")) {
      const result = swr<PullRequestsData>(CACHE_KEY.prs, (signal) => fetchPullRequests(fresh, signal), {
        fresh,
        signal: controller.signal,
      });
      diagnostics.startResource("prs", result.source);
      void result.promise.then((data) => {
        if (!controller.signal.aborted) setPullRequests(data.pullRequests);
        return true;
      }, (err) => {
        handleFailure(err);
        return false;
      }).then((ok) => finish("prs", ok));
    }
  }, []);

  const loadAll = useCallback((fresh = false) => loadData(allDashboardResources(), fresh), [loadData]);

  useEffect(() => {
    if (!authenticated) {
      loadedAccountRef.current = null;
      return;
    }
    if (accountsLoading) return;

    const nextAccountKey = accountKey ?? "authenticated";
    const accountChanged = loadedAccountRef.current !== null && loadedAccountRef.current !== nextAccountKey;
    if (accountChanged) {
      resetData();
      onAccountChangeRef.current?.();
    }
    loadedAccountRef.current = nextAccountKey;
    loadData(dataRequirementsForTab(tab, Boolean(routeRepoName), repositoryDetail), accountChanged);
  }, [authenticated, accountsLoading, accountKey, tab, routeRepoName, repositoryDetail, loadData, resetData]);

  useEffect(() => () => abortLoads(), [abortLoads]);

  useEffect(() => {
    if (repos.length === 0 && issues.length === 0 && pullRequests.length === 0) return;
    writeStatsCache({ repos, owners, issues, pullRequests, fetchedAt });
  }, [repos, owners, issues, pullRequests, fetchedAt]);

  return {
    issues,
    pullRequests,
    repos,
    owners,
    fetchedAt,
    loading,
    dataStale,
    error,
    loadData,
    loadAll,
    resetData,
  };
}
