import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AuthRequiredClientError,
  fetchAuthStatus,
  fetchCIHealth,
  fetchDailyDigests,
  fetchIssues,
  fetchNotifications,
  fetchPullRequests,
  fetchRepoInsights,
  fetchRepos,
  logoutAuth,
  markAllNotificationsRead,
  markNotificationRead,
} from "./api/github";
import { invalidate as invalidateCache, peek, swr } from "./api/cache";
import { AuthGate } from "./components/AuthGate";
import { RepositoryDetailsModal, type DetailTab } from "./components/modals/RepositoryDetailsModal";
import { RepositoryMetricModal, type MetricKind } from "./components/modals/RepositoryMetricModal";
import { ContributorsModal } from "./components/modals/ContributorsModal";
import { ChangelogModal } from "./components/modals/ChangelogModal";
import { WelcomeModal } from "./components/modals/WelcomeModal";
import { CommandPalette } from "./components/modals/CommandPalette";
import { Footer } from "./components/Footer";
import { TopBar } from "./components/TopBar";
import { SidebarControls, type InboxSidebarState } from "./components/SidebarControls";
import { Pagination } from "./components/common/Pagination";
import { BoardIcon, BookIcon, ExportIcon, InboxIcon, IssueIcon, PulseIcon } from "./components/common/Icons";
import { IssueList } from "./components/views/IssueList";
import { PullRequestList } from "./components/views/PullRequestList";
import { DailyDigestView } from "./components/views/DailyDigestView";
import { InboxView } from "./components/views/InboxView";
import { InsightsView } from "./components/views/InsightsView";
import { RepoGrid } from "./components/views/RepoGrid";
import { KanbanView } from "./components/views/KanbanView";
import { CIHealthView } from "./components/views/CIHealthView";
import type {
  CIHealthData,
  DailyDigestEntry,
  DailyDigestsData,
  DigestPeriod,
  GhIssue,
  GhNotification,
  GhPullRequest,
  GhRepo,
  IssuesData,
  PullRequestsData,
  RepoCIHealth,
  RepoInsight,
  RepoInsightsData,
  ReposData,
} from "./types/github";
import { buildInboxItems, INBOX_MAILBOXES, matchesInboxMailbox, mergeNotifications, type InboxMailbox } from "./utils/inbox";
import {
  buildIssueFacets,
  buildPullRequestFacets,
  buildRepoFacets,
  filterIssues,
  filterPullRequests,
  filterRepos,
  sortIssues,
  sortPullRequests,
  sortRepos,
  type IssueFilters,
  type PullRequestFilters,
  type RepoFilters,
} from "./utils/dashboard";
import { clampPage } from "./utils/pagination";
import { formatNumber } from "./utils/format";
import { clearStatsCache, readStatsCache, writeStatsCache } from "./utils/statsCache";
import { clearFiltersCache, hydrateFilters, readFiltersCache, writeFiltersCache } from "./utils/filtersCache";
import { useI18n } from "./i18n/I18nProvider";
import { useAccounts, useCapability } from "./contexts/AccountContext";

type Tab = "inbox" | "repos" | "issues" | "prs" | "kanban" | "insights" | "alerts" | "ci" | "digests";
type Theme = "dark" | "light" | "auto";
type TextSize = "small" | "normal" | "large";

const TAB_ROUTES: Record<Tab, string> = {
  inbox: "/inbox",
  repos: "/repositories",
  issues: "/issues",
  prs: "/pull-requests",
  kanban: "/board",
  insights: "/insights",
  alerts: "/alerts",
  ci: "/ci",
  digests: "/daily",
};

const ROUTE_TABS = new Map<string, Tab>(Object.entries(TAB_ROUTES).map(([tab, route]) => [route, tab as Tab]));
const DETAIL_TABS = new Set<DetailTab>(["overview", "actions", "commits", "pull-requests", "issues", "milestones", "releases", "branches", "forks", "traffic", "mentions", "discussions", "dependents"]);
const METRIC_KINDS = new Set<MetricKind>(["stars", "forks"]);

function tabFromPath(pathname: string): Tab {
  if (pathname === "/alert") return "alerts";
  return ROUTE_TABS.get(pathname) ?? "repos";
}

function detailTabFromParams(params: URLSearchParams): DetailTab {
  const tab = params.get("detail");
  return tab && DETAIL_TABS.has(tab as DetailTab) ? tab as DetailTab : "overview";
}

function metricKindFromParams(params: URLSearchParams): MetricKind | null {
  const metric = params.get("metric");
  return metric && METRIC_KINDS.has(metric as MetricKind) ? metric as MetricKind : null;
}

const CACHE_KEY = {
  repos: "/api/repos",
  issues: "/api/issues",
  prs: "/api/prs",
  insights: "/api/repo-insights",
  digests: "/api/daily-digests",
  ciHealth: "/api/ci-health",
} as const;

const defaultIssueFilters = (): IssueFilters => ({
  search: "",
  orgs: new Set(),
  repos: new Set(),
  labels: new Set(),
  authors: new Set(),
  assignees: new Set(),
  dates: { cf: "", ct: "", uf: "", ut: "" },
  preset: "",
});

const defaultPrFilters = (): PullRequestFilters => ({
  search: "",
  orgs: new Set(),
  repos: new Set(),
  labels: new Set(),
  authors: new Set(),
  assignees: new Set(),
  dates: { cf: "", ct: "", uf: "", ut: "" },
  preset: "",
});

const defaultRepoFilters = (): RepoFilters => ({
  search: "",
  orgs: new Set(),
  languages: new Set(),
  visibility: "all",
  includeForks: true,
  includeArchived: false,
});

function downloadJson(filename: string, rows: unknown[]) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type AuthState = "checking" | "anonymous" | "authenticated";

export function App() {
  const { t } = useI18n();
  const projectsEnabled = useCapability("projects");
  const { active: activeAccount } = useAccounts();
  const activeAccountId = activeAccount?.id ?? null;
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromPath(location.pathname);
  const routeRepoName = searchParams.get("repo") || "";
  const repoDetailTab = detailTabFromParams(searchParams);
  const routeMetricKind = metricKindFromParams(searchParams);

  // Read cached filters once — shared across all filter/sort useState initializers below.
  const [cachedFiltersOnMount] = useState(() => {
    const raw = readFiltersCache();
    return raw ? { hydrated: hydrateFilters(raw), sorts: raw.sorts } : null;
  });

  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authLogin, setAuthLogin] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"device" | "gh-cli" | "token">("device");
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [pullRequests, setPullRequests] = useState<GhPullRequest[]>([]);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [repoInsights, setRepoInsights] = useState<RepoInsight[]>([]);
  const [dailyDigests, setDailyDigests] = useState<DailyDigestEntry[]>([]);
  const [digestPeriod, setDigestPeriod] = useState<DigestPeriod>(() => (localStorage.getItem("gh-dash.digestPeriod") as DigestPeriod) || "day");
  const [ciHealth, setCiHealth] = useState<RepoCIHealth[]>([]);
  const [fetchedAt, setFetchedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataStale, setDataStale] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !localStorage.getItem("gh-dash.welcomeSeen"));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifications, setNotifications] = useState<GhNotification[]>([]);
  const [pollInterval, setPollInterval] = useState(60);
  const [mailbox, setMailbox] = useState<InboxMailbox>("inbox");
  const [inboxPage, setInboxPage] = useState(1);
  const [inboxPageSize, setInboxPageSize] = useState(Number(localStorage.getItem("gh-dash.inboxPageSize")) || 20);
  const [inboxSearch, setInboxSearch] = useState("");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("gh-dash.theme") as Theme) || "dark");
  const [textSize, setTextSize] = useState<TextSize>(() => (localStorage.getItem("gh-dash.textSize") as TextSize) || "normal");
  const [hideArchivedNoise, setHideArchivedNoise] = useState(() => localStorage.getItem("gh-dash.hideArchivedNoise") !== "0");
  const [issueFilters, setIssueFilters] = useState<IssueFilters>(() => cachedFiltersOnMount?.hydrated.issueFilters ?? defaultIssueFilters());
  const [prFilters, setPrFilters] = useState<PullRequestFilters>(() => cachedFiltersOnMount?.hydrated.prFilters ?? defaultPrFilters());
  const [repoFilters, setRepoFilters] = useState<RepoFilters>(() => cachedFiltersOnMount?.hydrated.repoFilters ?? defaultRepoFilters());
  const [issueSort, setIssueSort] = useState(() => cachedFiltersOnMount?.sorts?.issueSort || "updated_desc");
  const [prSort, setPrSort] = useState(() => cachedFiltersOnMount?.sorts?.prSort || "updated_desc");
  const [repoSort, setRepoSort] = useState(() => cachedFiltersOnMount?.sorts?.repoSort || "stars_desc");
  // Page numbers are intentionally NOT cached — they're ephemeral positions,
  // not preferences. After a refresh, page 1 is always the correct start.
  const [issuePage, setIssuePage] = useState(1);
  const [prPage, setPrPage] = useState(1);
  const [repoPage, setRepoPage] = useState(1);
  const [issuePageSize, setIssuePageSize] = useState(Number(localStorage.getItem("gh-dash.issuesPageSize")) || 20);
  const [prPageSize, setPrPageSize] = useState(Number(localStorage.getItem("gh-dash.prsPageSize")) || 20);
  const [repoPageSize, setRepoPageSize] = useState(Number(localStorage.getItem("gh-dash.reposPageSize")) || 20);
  const abortRef = useRef<AbortController | null>(null);
  const initialLoadRef = useRef(false);

  const loadData = useCallback((fresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setDataStale(true);

    const cachedRepos = peek<ReposData>(CACHE_KEY.repos);
    if (cachedRepos) {
      setRepos(cachedRepos.repos);
      setOwners(cachedRepos.owners);
      setFetchedAt(cachedRepos.fetchedAt);
    }
    const cachedIssues = peek<IssuesData>(CACHE_KEY.issues);
    if (cachedIssues) setIssues(cachedIssues.issues);
    const cachedPrs = peek<PullRequestsData>(CACHE_KEY.prs);
    if (cachedPrs) setPullRequests(cachedPrs.pullRequests);

    // Fall back to localStorage when in-memory cache is empty (page refresh)
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

    let pending = 3;
    setLoading(true);
    const finish = () => {
      pending -= 1;
      if (pending <= 0 && abortRef.current === controller) {
        setLoading(false);
        setDataStale(false);
      }
    };
    const handleFailure = (err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof AuthRequiredClientError) {
        setAuthState("anonymous");
        setAuthLogin(null);
        return;
      }
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    };

    void swr<ReposData>(CACHE_KEY.repos, (signal) => fetchRepos(fresh, signal), {
      fresh,
      signal: controller.signal,
    }).promise
      .then((data) => {
        if (controller.signal.aborted) return;
        setRepos(data.repos);
        setOwners(data.owners);
        setFetchedAt(data.fetchedAt);
      }, handleFailure)
      .finally(finish);

    void swr<IssuesData>(CACHE_KEY.issues, (signal) => fetchIssues(fresh, signal), {
      fresh,
      signal: controller.signal,
    }).promise
      .then((data) => {
        if (controller.signal.aborted) return;
        setIssues(data.issues);
      }, handleFailure)
      .finally(finish);

    void swr<PullRequestsData>(CACHE_KEY.prs, (signal) => fetchPullRequests(fresh, signal), {
      fresh,
      signal: controller.signal,
    }).promise
      .then((data) => {
        if (controller.signal.aborted) return;
        setPullRequests(data.pullRequests);
      }, handleFailure)
      .finally(finish);
  }, []);

  useEffect(() => {
    void fetchAuthStatus()
      .then((status) => {
        setAuthMode(status.mode);
        if (status.authenticated) {
          setAuthLogin(status.login);
          setAuthState("authenticated");
        } else {
          setAuthState("anonymous");
        }
      })
      .catch(() => setAuthState("anonymous"));
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") {
      initialLoadRef.current = false;
      return;
    }
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      loadData();
      return;
    }
    setIssues([]);
    setPullRequests([]);
    setRepos([]);
    setOwners([]);
    setRepoInsights([]);
    setDailyDigests([]);
    setCiHealth([]);
    setNotifications([]);
    setFetchedAt("");
    clearStatsCache();
    loadData(true);
  }, [authState, activeAccountId, loadData]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Persist dashboard data to localStorage for instant display on next page load
  useEffect(() => {
    if (repos.length === 0 && issues.length === 0 && pullRequests.length === 0) return;
    writeStatsCache({
      repos,
      owners,
      issues,
      pullRequests,
      fetchedAt,
    });
  }, [repos, owners, issues, pullRequests, fetchedAt]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    if (tab !== "insights" && tab !== "alerts" && tab !== "repos") return;
    const cached = peek<RepoInsightsData>(CACHE_KEY.insights);
    if (cached) setRepoInsights(cached.insights);
    const controller = new AbortController();
    swr<RepoInsightsData>(
      CACHE_KEY.insights,
      (signal) => fetchRepoInsights(false, signal),
      { signal: controller.signal },
    ).promise
      .then((data) => {
        if (!controller.signal.aborted) setRepoInsights(data.insights);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [tab, authState, activeAccountId]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    if (tab !== "ci") return;
    const cached = peek<CIHealthData>(CACHE_KEY.ciHealth);
    if (cached) setCiHealth(cached.repos);
    const controller = new AbortController();
    swr<CIHealthData>(CACHE_KEY.ciHealth, (signal) => fetchCIHealth(false, signal), {
      signal: controller.signal,
    }).promise
      .then((data) => {
        if (!controller.signal.aborted) setCiHealth(data.repos);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [tab, authState, activeAccountId]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    if (tab !== "digests") return;
    const cacheKey = digestPeriod === "day" ? CACHE_KEY.digests : `${CACHE_KEY.digests}?period=${digestPeriod}`;
    const cached = peek<DailyDigestsData>(cacheKey);
    if (cached) setDailyDigests(cached.digests);
    const controller = new AbortController();
    swr<DailyDigestsData>(cacheKey, (signal) => fetchDailyDigests(signal, digestPeriod), {
      signal: controller.signal,
    }).promise
      .then((data) => {
        if (!controller.signal.aborted) setDailyDigests(data.digests);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [tab, authState, digestPeriod, activeAccountId]);

  useEffect(() => {
    localStorage.setItem("gh-dash.digestPeriod", digestPeriod);
  }, [digestPeriod]);

  async function handleLogout() {
    abortRef.current?.abort();
    try {
      await logoutAuth();
    } catch {
      // ignore — UI flips regardless
    }
    invalidateCache();
    clearStatsCache();
    clearFiltersCache();
    setAuthState("anonymous");
    setAuthLogin(null);
    setIssues([]);
    setPullRequests([]);
    setRepos([]);
    setOwners([]);
    setRepoInsights([]);
    setDailyDigests([]);
    setCiHealth([]);
    setFetchedAt("");
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("gh-dash.theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
    localStorage.setItem("gh-dash.textSize", textSize);
  }, [textSize]);

  useEffect(() => {
    localStorage.setItem("gh-dash.hideArchivedNoise", hideArchivedNoise ? "1" : "0");
  }, [hideArchivedNoise]);

  useEffect(() => {
    document.body.classList.toggle("tab-inbox", tab === "inbox");
    document.body.classList.toggle("tab-issues", tab === "issues");
    document.body.classList.toggle("tab-prs", tab === "prs");
    document.body.classList.toggle("tab-repos", tab === "repos");
    document.body.classList.toggle("tab-kanban", tab === "kanban");
    document.body.classList.toggle("tab-insights", tab === "insights");
    document.body.classList.toggle("tab-alerts", tab === "alerts");
    document.body.classList.toggle("tab-ci", tab === "ci");
    document.body.classList.toggle("tab-digests", tab === "digests");
    document.body.classList.toggle("filters-open", filtersOpen);
  }, [tab, filtersOpen]);

  useEffect(() => {
    if (location.pathname === "/" || location.pathname === "/index.html") {
      navigate(`${TAB_ROUTES.repos}${location.search}`, { replace: true });
      return;
    }
    if (location.pathname === "/alert") {
      navigate(`${TAB_ROUTES.alerts}${location.search}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setFiltersOpen(false), [location.pathname]);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => localStorage.setItem("gh-dash.issuesPageSize", String(issuePageSize)), [issuePageSize]);
  useEffect(() => localStorage.setItem("gh-dash.prsPageSize", String(prPageSize)), [prPageSize]);
  useEffect(() => localStorage.setItem("gh-dash.reposPageSize", String(repoPageSize)), [repoPageSize]);
  useEffect(() => localStorage.setItem("gh-dash.inboxPageSize", String(inboxPageSize)), [inboxPageSize]);

  const refreshNotifications = useCallback(async (fresh = false) => {
    try {
      const data = await fetchNotifications(fresh);
      setNotifications(data.notifications);
      if (data.pollInterval) setPollInterval(data.pollInterval);
    } catch {
      // silent — Inbox still works without notifications
    }
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    void refreshNotifications(true);
  }, [authState, activeAccountId, refreshNotifications]);

  useEffect(() => {
    if (authState !== "authenticated" || !pollInterval) return;
    const id = window.setInterval(() => { void refreshNotifications(); }, Math.max(30, pollInterval) * 1000);
    return () => window.clearInterval(id);
  }, [authState, pollInterval, refreshNotifications]);

  const handleMarkRead = useCallback(async (threadId: string) => {
    setNotifications((prev) => prev.map((entry) => (entry.id === threadId ? { ...entry, unread: false } : entry)));
    try {
      await markNotificationRead(threadId);
    } catch {
      void refreshNotifications(true);
    }
  }, [refreshNotifications]);

  const userLoginValue = owners[0] || "";
  const inboxItems = useMemo(() => {
    const base = buildInboxItems({ issues, pullRequests, userLogin: userLoginValue });
    return mergeNotifications(base, notifications);
  }, [issues, pullRequests, userLoginValue, notifications]);
  const mailboxItems = useMemo(
    () => inboxItems.filter((item) => matchesInboxMailbox(item, mailbox)),
    [inboxItems, mailbox],
  );
  const inboxCounts = useMemo(() => {
    const counts: Record<InboxMailbox, number> = {} as Record<InboxMailbox, number>;
    for (const entry of INBOX_MAILBOXES) {
      counts[entry.key] = inboxItems.filter((item) => matchesInboxMailbox(item, entry.key)).length;
    }
    return counts;
  }, [inboxItems]);
  const inboxUnreadCount = useMemo(() => inboxItems.filter((item) => item.unread).length, [inboxItems]);

  const handleMarkAllRead = useCallback(async () => {
    if (!inboxUnreadCount) return;
    if (!window.confirm(t("confirm.markAllRead", { count: inboxUnreadCount, plural: inboxUnreadCount === 1 ? "" : "s" }))) return;
    const previous = notifications;
    setNotifications((prev) => prev.map((entry) => ({ ...entry, unread: false })));
    try {
      await markAllNotificationsRead();
    } catch {
      setNotifications(previous);
    }
  }, [inboxUnreadCount, notifications]);

  const inboxSidebar: InboxSidebarState = {
    mailbox,
    counts: inboxCounts,
    totalCount: inboxItems.length,
    unreadCount: inboxUnreadCount,
    onMailboxChange: (next) => { setMailbox(next); setInboxPage(1); },
    onMarkAllRead: () => void handleMarkAllRead(),
  };

  // Persist sidebar filters and sort order to localStorage
  useEffect(() => {
    writeFiltersCache(repoFilters, issueFilters, prFilters, { issueSort, prSort, repoSort });
  }, [repoFilters, issueFilters, prFilters, issueSort, prSort, repoSort]);

  const userLogin = userLoginValue;
  const archivedRepoNames = useMemo(
    () => (hideArchivedNoise ? new Set(repos.filter((repo) => repo.isArchived).map((repo) => repo.nameWithOwner)) : new Set<string>()),
    [repos, hideArchivedNoise],
  );
  const nonArchivedIssues = useMemo(
    () => (archivedRepoNames.size ? issues.filter((issue) => !archivedRepoNames.has(issue.repository.nameWithOwner)) : issues),
    [issues, archivedRepoNames],
  );
  const nonArchivedPullRequests = useMemo(
    () => (archivedRepoNames.size ? pullRequests.filter((pr) => !archivedRepoNames.has(pr.repository.nameWithOwner)) : pullRequests),
    [pullRequests, archivedRepoNames],
  );
  const issueFacets = useMemo(() => buildIssueFacets(nonArchivedIssues), [nonArchivedIssues]);
  const prFacets = useMemo(() => buildPullRequestFacets(nonArchivedPullRequests), [nonArchivedPullRequests]);
  const repoFacets = useMemo(() => buildRepoFacets(repos), [repos]);
  const insightsByRepo = useMemo(() => new Map(repoInsights.map((insight) => [insight.repo, insight])), [repoInsights]);
  const filteredIssues = useMemo(() => sortIssues(filterIssues(nonArchivedIssues, issueFilters, userLogin), issueSort), [nonArchivedIssues, issueFilters, issueSort, userLogin]);
  const filteredPullRequests = useMemo(() => sortPullRequests(filterPullRequests(nonArchivedPullRequests, prFilters, userLogin), prSort), [nonArchivedPullRequests, prFilters, prSort, userLogin]);
  const filteredRepos = useMemo(() => sortRepos(filterRepos(repos, issues, repoFilters), issues, repoSort, insightsByRepo), [repos, issues, repoFilters, repoSort, insightsByRepo]);
  const filteredInsights = useMemo(
    () => filteredRepos
      .map((repo) => insightsByRepo.get(repo.nameWithOwner))
      .filter((value): value is RepoInsight => Boolean(value))
      .filter((insight) => insight.alerts.length || insight.opportunities.length || insight.correlations.length),
    [filteredRepos, insightsByRepo]
  );
  const securityInsights = useMemo(
    () => filteredRepos
      .map((repo) => insightsByRepo.get(repo.nameWithOwner))
      .filter((value): value is RepoInsight => Boolean(value))
      .filter((insight) => insight.securityAlertsCount > 0),
    [filteredRepos, insightsByRepo]
  );
  const issuePageSafe = clampPage(issuePage, filteredIssues.length, issuePageSize);
  const prPageSafe = clampPage(prPage, filteredPullRequests.length, prPageSize);
  const repoPageSafe = clampPage(repoPage, filteredRepos.length, repoPageSize);
  const visibleIssues = filteredIssues.slice((issuePageSafe - 1) * issuePageSize, issuePageSafe * issuePageSize);
  const visiblePullRequests = filteredPullRequests.slice((prPageSafe - 1) * prPageSize, prPageSafe * prPageSize);
  const visibleRepos = filteredRepos.slice((repoPageSafe - 1) * repoPageSize, repoPageSafe * repoPageSize);
  const draftCount = pullRequests.filter((pr) => pr.isDraft).length;
  const awaitingReviewCount = pullRequests.filter((pr) => !pr.isDraft && pr.reviewsCount === 0).length;
  const approvedCount = pullRequests.filter((pr) => pr.reviewDecision === "APPROVED").length;
  const stalePrCount = pullRequests.filter((pr) => Date.now() - new Date(pr.updatedAt).getTime() > 14 * 86_400_000).length;
  const averageHealth = repoInsights.length ? Math.round(repoInsights.reduce((sum, insight) => sum + insight.healthScore, 0) / repoInsights.length) : 0;
  const totalAlerts = repoInsights.reduce((sum, insight) => sum + insight.alerts.length, 0);
  const totalSecurityAlerts = repoInsights.reduce((sum, insight) => sum + insight.securityAlertsCount, 0);
  const securityRepoCount = repoInsights.filter((insight) => insight.securityAlertsCount > 0).length;
  const securityInsightsAlertCount = securityInsights.reduce((sum, insight) => sum + insight.alerts.length, 0);
  const securityAverageHealth = securityInsights.length ? Math.round(securityInsights.reduce((sum, insight) => sum + insight.healthScore, 0) / securityInsights.length) : 0;
  const reposByName = useMemo(() => new Map(repos.map((repo) => [repo.nameWithOwner, repo])), [repos]);
  const repoModal = useMemo(
    () => (routeRepoName && !routeMetricKind ? reposByName.get(routeRepoName) ?? null : null),
    [reposByName, routeMetricKind, routeRepoName],
  );
  const metricRepo = routeMetricKind && routeRepoName ? reposByName.get(routeRepoName) ?? null : null;
  const metricTotalCount = routeMetricKind === "stars" ? metricRepo?.stargazerCount : routeMetricKind === "forks" ? metricRepo?.forkCount : undefined;

  if (authState === "checking") {
    return <div className="auth-gate"><div className="auth-card"><p className="auth-status">{t("common.loadingEllipsis")}</p></div></div>;
  }

  if (authState === "anonymous") {
    return (
      <AuthGate
        onAuthenticated={(login) => {
          setAuthLogin(login);
          setAuthState("authenticated");
        }}
      />
    );
  }

  const search =
    tab === "inbox"
      ? inboxSearch
      : tab === "repos" || tab === "insights" || tab === "alerts" || tab === "digests"
        ? repoFilters.search
        : tab === "prs"
          ? prFilters.search
          : issueFilters.search;
  const subtitle = [
    t("summary.issues", { count: issues.length }),
    t("summary.prs", { count: pullRequests.length }),
    t("summary.repos", { count: repos.length }),
    t("summary.orgs", { count: owners.length }),
    ...(totalSecurityAlerts > 0 ? [t("summary.securityAlerts", { count: totalSecurityAlerts })] : []),
    ...(loading ? [t("summary.loading")] : []),
  ].join(" · ");
  const lastUpdated = fetchedAt ? t("common.updatedAt", { time: new Date(fetchedAt).toLocaleTimeString() }) : "";

  function setSearch(value: string) {
    if (tab === "inbox") {
      setInboxSearch(value);
      setInboxPage(1);
    } else if (tab === "repos" || tab === "insights" || tab === "alerts" || tab === "digests") {
      setRepoFilters({ ...repoFilters, search: value });
      setRepoPage(1);
    } else if (tab === "prs") {
      setPrFilters({ ...prFilters, search: value });
      setPrPage(1);
    } else {
      setIssueFilters({ ...issueFilters, search: value });
      setIssuePage(1);
    }
  }

  function resetFilters() {
    if (tab === "repos" || tab === "insights" || tab === "alerts" || tab === "digests") setRepoFilters(defaultRepoFilters());
    else if (tab === "prs") setPrFilters(defaultPrFilters());
    else setIssueFilters(defaultIssueFilters());
    clearFiltersCache();
  }

  function navigateTab(nextTab: Tab) {
    navigate(TAB_ROUTES[nextTab]);
  }

  function cycleTheme() {
    setTheme(theme === "dark" ? "light" : theme === "light" ? "auto" : "dark");
  }

  function openRepoModal(repo: GhRepo, detail: DetailTab = "overview") {
    setSearchParams({ repo: repo.nameWithOwner, detail });
  }

  function closeRepoModal() {
    navigate(TAB_ROUTES[tab]);
  }

  function openMetricModal(repo: string, metric: MetricKind) {
    setSearchParams({ repo, metric });
  }

  function closeMetricModal() {
    navigate(TAB_ROUTES[tab]);
  }

  function changeRepoDetailTab(detail: DetailTab) {
    if (!repoModal) return;
    setSearchParams({ repo: repoModal.nameWithOwner, detail });
  }

  const tabs = [
    { key: "inbox" as const, label: t("tabs.inbox"), count: issues.length + pullRequests.length, icon: <InboxIcon /> },
    { key: "repos" as const, label: t("tabs.repositories"), count: repos.length, icon: <BookIcon /> },
    { key: "issues" as const, label: t("tabs.issues"), count: issues.length, icon: <IssueIcon /> },
    { key: "prs" as const, label: t("tabs.pullRequests"), count: pullRequests.length, icon: <PulseIcon /> },
    { key: "insights" as const, label: t("tabs.insights"), count: filteredInsights.length, icon: <PulseIcon /> },
    { key: "alerts" as const, label: t("tabs.alerts"), count: totalSecurityAlerts, icon: <PulseIcon /> },
    { key: "ci" as const, label: t("tabs.ci"), count: ciHealth.length, icon: <PulseIcon /> },
    { key: "digests" as const, label: t("tabs.digest"), count: dailyDigests.length, icon: <PulseIcon /> },
    ...(projectsEnabled
      ? [{ key: "kanban" as const, label: t("tabs.board"), count: "—", icon: <BoardIcon /> }]
      : []),
  ];

  return (
    <>
      <TopBar
        subtitle={subtitle}
        lastUpdated={lastUpdated}
        loading={loading}
        theme={theme}
        textSize={textSize}
        hideArchivedNoise={hideArchivedNoise}
        onThemeChange={setTheme}
        onTextSizeChange={setTextSize}
        onHideArchivedNoiseChange={setHideArchivedNoise}
        authLogin={authLogin}
        owners={owners}
        onRefresh={() => loadData(true)}
        onOpenFilters={() => setFiltersOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
        onLogout={() => void handleLogout()}
        canLogout={authMode === "device"}
      />
      <div className="sidebar-backdrop" onClick={() => setFiltersOpen(false)} />
      <div className="layout">
        <SidebarControls
          tab={tab}
          search={search}
          issueFilters={issueFilters}
          prFilters={prFilters}
          repoFilters={repoFilters}
          issueFacets={issueFacets}
          prFacets={prFacets}
          repoFacets={repoFacets}
          onSearchChange={setSearch}
          onIssueFiltersChange={(next) => { setIssueFilters(next); setIssuePage(1); }}
          onPrFiltersChange={(next) => { setPrFilters(next); setPrPage(1); }}
          onRepoFiltersChange={(next) => { setRepoFilters(next); setRepoPage(1); }}
          onReset={resetFilters}
          onClose={() => setFiltersOpen(false)}
          authLogin={authLogin || undefined}
          inbox={inboxSidebar}
        />
        <main className={`main${dataStale ? " data-stale" : ""}`}>
          {error ? <div className="error">{error}</div> : null}
          <div className="view-head">
            <div className="tabs" role="tablist">
              {tabs.map((item) => (
                <button className={`tab ${tab === item.key ? "active" : ""}`} key={item.key} role="tab" onClick={() => navigateTab(item.key)}>
                  {item.icon}
                  {item.label} <span className="tab-badge">{item.count}</span>
                </button>
              ))}
            </div>
          </div>

          {tab === "inbox" ? (
            <InboxView
              items={mailboxItems}
              mailboxLabel={t(`mailbox.${mailbox}`)}
              search={inboxSearch}
              page={inboxPage}
              pageSize={inboxPageSize}
              reposByName={reposByName}
              onRepoClick={openRepoModal}
              onMarkRead={(threadId) => void handleMarkRead(threadId)}
              onRefresh={() => void refreshNotifications(true)}
              onPageChange={setInboxPage}
              onPageSizeChange={(size) => { setInboxPageSize(size); setInboxPage(1); }}
            />
          ) : null}

          {tab === "issues" ? (
            <div className="view-issues" style={{ display: "block" }}>
              <section className="stats">
                <div className="stat"><div className="k">{t("stats.openIssues")}</div><div className="v">{formatNumber(filteredIssues.length)}</div><div className="sub">{t("stats.matchingFilters")}</div></div>
                <div className="stat"><div className="k">{t("stats.repositories")}</div><div className="v">{new Set(filteredIssues.map((issue) => issue.repository.nameWithOwner)).size}</div><div className="sub">{t("stats.withOpenIssues")}</div></div>
                <div className="stat"><div className="k">{t("stats.organizations")}</div><div className="v">{new Set(filteredIssues.map((issue) => issue.repository.nameWithOwner.split("/")[0])).size}</div><div className="sub">{t("stats.includingPersonal")}</div></div>
                <div className="stat"><div className="k">{t("stats.stale30")}</div><div className="v">{filteredIssues.filter((issue) => Date.now() - new Date(issue.updatedAt).getTime() > 30 * 86_400_000).length}</div><div className="sub">{t("stats.noRecentActivity")}</div></div>
              </section>
              <div className="toolbar">
                <span className="count-chip"><strong>{visibleIssues.length}</strong> {t("common.of")} <span>{filteredIssues.length}</span> {t("common.shown")}</span>
                <div className="spacer" />
                <label>{t("common.sort")}</label>
                <select className="sort" value={issueSort} onChange={(event) => setIssueSort(event.target.value)}>
                  <option value="updated_desc">{t("sort.recentlyUpdated")}</option>
                  <option value="updated_asc">{t("sort.leastRecentlyUpdated")}</option>
                  <option value="created_desc">{t("sort.newest")}</option>
                  <option value="created_asc">{t("sort.oldest")}</option>
                  <option value="comments_desc">{t("sort.mostCommented")}</option>
                  <option value="comments_asc">{t("sort.leastCommented")}</option>
                  <option value="repo_asc">{t("sort.repositoryAZ")}</option>
                </select>
                <button className="btn ghost" onClick={() => downloadJson("issues.json", filteredIssues)}><ExportIcon /> {t("common.export")}</button>
              </div>
              <IssueList issues={visibleIssues} />
              <Pagination totalItems={filteredIssues.length} page={issuePageSafe} pageSize={issuePageSize} onPageChange={setIssuePage} onPageSizeChange={(size) => { setIssuePageSize(size); setIssuePage(1); }} />
            </div>
          ) : null}

          {tab === "prs" ? (
            <div className="view-prs" style={{ display: "block" }}>
              <section className="stats">
                <div className="stat"><div className="k">{t("stats.openPrs")}</div><div className="v">{formatNumber(filteredPullRequests.length)}</div><div className="sub">{t("stats.matchingFilters")}</div></div>
                <div className="stat"><div className="k">{t("stats.drafts")}</div><div className="v">{formatNumber(draftCount)}</div><div className="sub">{t("stats.acrossAllPrs")}</div></div>
                <div className="stat"><div className="k">{t("stats.awaitingReview")}</div><div className="v">{formatNumber(awaitingReviewCount)}</div><div className="sub">{t("stats.noReviewYet")}</div></div>
                <div className="stat"><div className="k">{t("stats.approved")}</div><div className="v">{formatNumber(approvedCount)}</div><div className="sub">{t("stats.readyToMerge")}</div></div>
                <div className="stat"><div className="k">{t("stats.stale14")}</div><div className="v">{formatNumber(stalePrCount)}</div><div className="sub">{t("stats.noRecentActivity")}</div></div>
              </section>
              <div className="toolbar">
                <span className="count-chip"><strong>{visiblePullRequests.length}</strong> {t("common.of")} <span>{filteredPullRequests.length}</span> {t("common.shown")}</span>
                <div className="spacer" />
                <label>{t("common.preset")}</label>
                <select className="sort" value={prFilters.preset} onChange={(event) => { setPrFilters({ ...prFilters, preset: event.target.value }); setPrPage(1); }}>
                  <option value="">{t("common.all")}</option>
                  <option value="ready">{t("preset.ready")}</option>
                  <option value="draft">{t("preset.draft")}</option>
                  <option value="awaiting-review">{t("preset.awaitingReview")}</option>
                  <option value="approved">{t("preset.approved")}</option>
                  <option value="changes-requested">{t("preset.changesRequested")}</option>
                  <option value="assigned-me">{t("preset.assignedMe")}</option>
                  <option value="authored-me">{t("preset.authoredMe")}</option>
                  <option value="stale">{t("preset.stale")}</option>
                </select>
                <label>{t("common.sort")}</label>
                <select className="sort" value={prSort} onChange={(event) => setPrSort(event.target.value)}>
                  <option value="updated_desc">{t("sort.recentlyUpdated")}</option>
                  <option value="updated_asc">{t("sort.leastRecentlyUpdated")}</option>
                  <option value="created_desc">{t("sort.newest")}</option>
                  <option value="created_asc">{t("sort.oldest")}</option>
                  <option value="review_pending">{t("sort.awaitingReviewFirst")}</option>
                  <option value="size_desc">{t("sort.largestDiff")}</option>
                  <option value="size_asc">{t("sort.smallestDiff")}</option>
                  <option value="files_desc">{t("sort.mostFilesChanged")}</option>
                  <option value="comments_desc">{t("sort.mostCommented")}</option>
                  <option value="repo_asc">{t("sort.repositoryAZ")}</option>
                </select>
                <button className="btn ghost" onClick={() => downloadJson("pull-requests.json", filteredPullRequests)}><ExportIcon /> {t("common.export")}</button>
              </div>
              <PullRequestList pullRequests={visiblePullRequests} />
              <Pagination totalItems={filteredPullRequests.length} page={prPageSafe} pageSize={prPageSize} onPageChange={setPrPage} onPageSizeChange={(size) => { setPrPageSize(size); setPrPage(1); }} />
            </div>
          ) : null}

          {tab === "repos" ? (
            <div className="view-repos" style={{ display: "block" }}>
              <section className="stats">
                <div className="stat"><div className="k">{t("stats.repositories")}</div><div className="v">{formatNumber(filteredRepos.length)}</div><div className="sub">{t("stats.matchingFilters")}</div></div>
                <div className="stat"><div className="k">{t("stats.totalStars")}</div><div className="v">{formatNumber(filteredRepos.reduce((sum, repo) => sum + repo.stargazerCount, 0))}</div><div className="sub">{t("stats.acrossShown")}</div></div>
                <div className="stat"><div className="k">{t("stats.totalForks")}</div><div className="v">{formatNumber(filteredRepos.reduce((sum, repo) => sum + repo.forkCount, 0))}</div><div className="sub">{t("stats.acrossShown")}</div></div>
                <div className="stat"><div className="k">{t("stats.averageHealth")}</div><div className="v">{formatNumber(averageHealth)}</div><div className="sub">{t("stats.fromRepoSignals")}</div></div>
              </section>
              <div className="toolbar">
                <span className="count-chip"><strong>{visibleRepos.length}</strong> {t("common.of")} <span>{filteredRepos.length}</span> {t("common.shown")}</span>
                <div className="spacer" />
                <label>{t("common.sort")}</label>
                <select className="sort" value={repoSort} onChange={(event) => setRepoSort(event.target.value)}>
                  <option value="stars_desc">{t("sort.mostStars")}</option>
                  <option value="stars_asc">{t("sort.fewestStars")}</option>
                  <option value="forks_desc">{t("sort.mostForks")}</option>
                  <option value="forks_asc">{t("sort.fewestForks")}</option>
                  <option value="issues_desc">{t("sort.mostOpenIssues")}</option>
                  <option value="issues_asc">{t("sort.fewestOpenIssues")}</option>
                  <option value="health_desc">{t("sort.bestHealth")}</option>
                  <option value="health_asc">{t("sort.mostAtRisk")}</option>
                  <option value="pushed_desc">{t("sort.recentlyPushed")}</option>
                  <option value="updated_desc">{t("sort.recentlyUpdated")}</option>
                  <option value="name_asc">{t("sort.nameAZ")}</option>
                </select>
                <button className="btn ghost" onClick={() => downloadJson("repositories.json", filteredRepos)}><ExportIcon /> {t("common.export")}</button>
              </div>
              <RepoGrid
                repos={visibleRepos}
                issues={issues}
                insightsByRepo={insightsByRepo}
                onRepoClick={openRepoModal}
                onIssuesClick={(repo) => { setIssueFilters({ ...issueFilters, repos: new Set([repo]) }); navigateTab("issues"); }}
                onStarsClick={(repo) => openMetricModal(repo, "stars")}
                onForksClick={(repo) => openMetricModal(repo, "forks")}
              />
              <Pagination totalItems={filteredRepos.length} page={repoPageSafe} pageSize={repoPageSize} onPageChange={setRepoPage} onPageSizeChange={(size) => { setRepoPageSize(size); setRepoPage(1); }} />
            </div>
          ) : null}

          {tab === "insights" ? (
            <div className="view-insights" style={{ display: "block" }}>
              <section className="stats">
                <div className="stat"><div className="k">{t("stats.averageHealth")}</div><div className="v">{formatNumber(averageHealth)}</div><div className="sub">{t("stats.acrossTrackedRepos")}</div></div>
                <div className="stat"><div className="k">{t("stats.alertCount")}</div><div className="v">{formatNumber(totalAlerts)}</div><div className="sub">{t("stats.activeRisksDetected")}</div></div>
                <div className="stat"><div className="k">{t("stats.reposWithInsights")}</div><div className="v">{formatNumber(filteredInsights.length)}</div><div className="sub">{t("stats.alertsOpportunitiesCorrelations")}</div></div>
                <div className="stat"><div className="k">{t("stats.atRiskRepos")}</div><div className="v">{formatNumber(repoInsights.filter((insight) => insight.healthLabel === "risky").length)}</div><div className="sub">{t("stats.healthScoreUnder55")}</div></div>
              </section>
              <InsightsView insights={filteredInsights} reposByName={reposByName} onRepoClick={openRepoModal} />
            </div>
          ) : null}

          {tab === "alerts" ? (
            <div className="view-alerts" style={{ display: "block" }}>
              <section className="stats">
                <div className="stat"><div className="k">{t("alerts.totalAlerts")}</div><div className="v">{formatNumber(totalSecurityAlerts)}</div><div className="sub">{t("alerts.affectedRepos", { count: formatNumber(securityRepoCount) })}</div></div>
                <div className="stat"><div className="k">{t("alerts.reposWithAlerts")}</div><div className="v">{formatNumber(securityRepoCount)}</div><div className="sub">{t("alerts.securityFocusedView")}</div></div>
                <div className="stat"><div className="k">{t("stats.averageHealth")}</div><div className="v">{formatNumber(securityAverageHealth)}</div><div className="sub">{t("alerts.acrossSecurityRepos")}</div></div>
                <div className="stat"><div className="k">{t("stats.alertCount")}</div><div className="v">{formatNumber(securityInsightsAlertCount)}</div><div className="sub">{t("alerts.repoInsightAlerts")}</div></div>
              </section>
              <InsightsView
                insights={securityInsights}
                reposByName={reposByName}
                onRepoClick={openRepoModal}
                emptyTitleKey="alerts.emptyTitle"
                emptyTextKey="alerts.emptyText"
              />
            </div>
          ) : null}

          {tab === "ci" ? (
            (() => {
              const totalRuns = ciHealth.reduce((sum, entry) => sum + entry.totalRuns, 0);
              const totalFailures = ciHealth.reduce((sum, entry) => sum + entry.failureCount, 0);
              const failingRepos = ciHealth.filter((entry) => entry.failureCount > 0).length;
              const decided = ciHealth.reduce((sum, entry) => sum + entry.successCount + entry.failureCount, 0);
              const successes = ciHealth.reduce((sum, entry) => sum + entry.successCount, 0);
              const avgSuccessPct = decided ? Math.round((successes / decided) * 100) : 0;
              return (
                <div className="view-ci" style={{ display: "block" }}>
                  <section className="stats">
                    <div className="stat"><div className="k">{t("stats.reposWithCi")}</div><div className="v">{formatNumber(ciHealth.length)}</div><div className="sub">{t("stats.recentWorkflowRuns")}</div></div>
                    <div className="stat"><div className="k">{t("stats.totalRuns")}</div><div className="v">{formatNumber(totalRuns)}</div><div className="sub">{t("stats.lastRunsPerRepo", { count: ciHealth[0]?.totalRuns ?? 30 })}</div></div>
                    <div className="stat"><div className="k">{t("stats.avgSuccess")}</div><div className="v">{avgSuccessPct}%</div><div className="sub">{t("stats.acrossDecidedRuns")}</div></div>
                    <div className="stat"><div className="k">{t("stats.failingRepos")}</div><div className="v">{formatNumber(failingRepos)}</div><div className="sub">{t("stats.failuresTotal", { count: formatNumber(totalFailures) })}</div></div>
                  </section>
                  <CIHealthView data={ciHealth} reposByName={reposByName} onRepoClick={openRepoModal} />
                </div>
              );
            })()
          ) : null}

          {tab === "digests" ? (
            <div className="view-digests" style={{ display: "block" }}>
              <section className="stats">
                <div className="stat"><div className="k">{digestPeriod === "day" ? t("stats.digestDays") : digestPeriod === "week" ? t("stats.digestWeeks") : t("stats.digestMonths")}</div><div className="v">{formatNumber(dailyDigests.length)}</div><div className="sub">{digestPeriod === "day" ? t("stats.daysWithSavedSnapshots") : t("stats.periodsAggregated")}</div></div>
                <div className="stat"><div className="k">{t("stats.latestIssueDelta")}</div><div className="v">{dailyDigests[0] ? `${dailyDigests[0].issueDelta >= 0 ? "+" : ""}${formatNumber(dailyDigests[0].issueDelta)}` : "0"}</div><div className="sub">{t("stats.vsPrevious", { period: digestPeriod === "day" ? t("period.day") : t(`period.${digestPeriod}`) })}</div></div>
                <div className="stat"><div className="k">{t("stats.latestStarsDelta")}</div><div className="v">{dailyDigests[0] ? `${dailyDigests[0].starsDelta >= 0 ? "+" : ""}${formatNumber(dailyDigests[0].starsDelta)}` : "0"}</div><div className="sub">{t("stats.vsPrevious", { period: digestPeriod === "day" ? t("period.day") : t(`period.${digestPeriod}`) })}</div></div>
                <div className="stat"><div className="k">{t("stats.latestStaleDelta")}</div><div className="v">{dailyDigests[0] ? `${dailyDigests[0].staleIssueDelta >= 0 ? "+" : ""}${formatNumber(dailyDigests[0].staleIssueDelta)}` : "0"}</div><div className="sub">{t("stats.vsPrevious", { period: digestPeriod === "day" ? t("period.day") : t(`period.${digestPeriod}`) })}</div></div>
                <div className="stat"><div className="k">{t("alerts.totalAlerts")}</div><div className="v">{dailyDigests[0] ? formatNumber(dailyDigests[0].securityAlertsCount) : "0"}</div><div className="sub">{dailyDigests[0] ? t("digest.securityRepos", { count: formatNumber(dailyDigests[0].securityReposCount) }) : t("digest.securityUnavailable")}</div></div>
              </section>
              <DailyDigestView digests={dailyDigests} period={digestPeriod} onPeriodChange={setDigestPeriod} />
            </div>
          ) : null}

          {tab === "kanban" && projectsEnabled ? <KanbanView /> : null}
        </main>
      </div>
      <Footer
        onContributorsClick={() => setContributorsOpen(true)}
        onChangelogClick={() => setChangelogOpen(true)}
      />
      {paletteOpen ? (
        <CommandPalette
          repos={repos}
          issues={issues}
          pullRequests={pullRequests}
          onNavigateTab={(next) => navigateTab(next)}
          onOpenRepo={(repo) => openRepoModal(repo)}
          onRefresh={() => loadData(true)}
          onToggleTheme={cycleTheme}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
      {welcomeOpen ? (
        <WelcomeModal
          onClose={() => {
            localStorage.setItem("gh-dash.welcomeSeen", "1");
            setWelcomeOpen(false);
          }}
          onViewChangelog={() => {
            localStorage.setItem("gh-dash.welcomeSeen", "1");
            setWelcomeOpen(false);
            setChangelogOpen(true);
          }}
        />
      ) : null}
      {contributorsOpen ? <ContributorsModal onClose={() => setContributorsOpen(false)} /> : null}
      {changelogOpen ? <ChangelogModal onClose={() => setChangelogOpen(false)} /> : null}
      {repoModal ? (
        <RepositoryDetailsModal
          repo={repoModal}
          issues={issues}
          pullRequests={pullRequests}
          activeTab={repoDetailTab}
          onTabChange={changeRepoDetailTab}
          onClose={closeRepoModal}
          onIssuesClick={(repo) => {
            closeRepoModal();
            setIssueFilters({ ...issueFilters, repos: new Set([repo]) });
            navigateTab("issues");
          }}
        />
      ) : null}
      {routeMetricKind && routeRepoName ? (
        <RepositoryMetricModal
          kind={routeMetricKind}
          repo={routeRepoName}
          totalCount={metricTotalCount}
          onClose={closeMetricModal}
        />
      ) : null}
    </>
  );
}
