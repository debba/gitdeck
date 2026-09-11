import { interpretUpstreamJson } from "../utils/upstreamResponse";
import { getEtag, peek, setEtag, swr } from "./cache";
import type { AiConnectionTest, AiSettingsSummary, AiSettingsUpdate } from "../types/ai";
import type { GoalContentSource, GoalMetric, GoalProposalsData, GoalsData, GoalSuggestion, RepositoryGoal } from "../types/goals";
import type {
  ApiError,
  CIHealthData,
  DailyDigestsData,
  DependentItem,
  ForkNode,
  IssuesData,
  MentionCodeItem,
  MentionIssueItem,
  NotificationsData,
  PageInfo,
  ProjectDetails,
  ProjectSummary,
  PullRequestsData,
  RepoBranch,
  RepoDetailsData,
  RepoDiscussion,
  RepoInsightsData,
  ReposData,
  RepoTrafficDetails,
  StargazerNode,
} from "../types/github";

export class AuthRequiredClientError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "AuthRequiredClientError";
  }
}

async function readJson<T>(url: string, init?: RequestInit, cacheKey?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (cacheKey) {
    const prior = getEtag(cacheKey);
    if (prior) headers.set("If-None-Match", prior);
  }
  const response = await fetch(url, { cache: "no-store", ...init, headers });
  if (response.status === 304 && cacheKey) {
    const cached = peek<T>(cacheKey);
    if (cached) return cached;
  }
  const body = interpretUpstreamJson<T | (ApiError & { needsAuth?: boolean })>("Gitdeck server", {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    text: await response.text(),
  });
  // A JSON error body (4xx/5xx from our API) is still parsed so `needsAuth`
  // and `error` reach the caller; anything else becomes a readable message.
  const json = body.ok ? body.data : parseJsonOrNull<T | ApiError>(body.error);
  if (json === null) throw new Error(body.ok ? "Empty response" : body.error);
  const maybeError = json as Partial<ApiError> & { needsAuth?: boolean };
  if (response.status === 401 || maybeError.needsAuth) {
    throw new AuthRequiredClientError(maybeError.error || "authentication required");
  }
  if (!response.ok || maybeError.ok === false) {
    throw new Error(maybeError.error || `Request failed: ${response.status}`);
  }
  if (cacheKey) {
    const newEtag = response.headers.get("ETag");
    if (newEtag) setEtag(cacheKey, newEtag);
  }
  return json as T;
}

function parseJsonOrNull<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function withSignal(signal?: AbortSignal): RequestInit | undefined {
  return signal ? { signal } : undefined;
}

export type AuthMode = "device" | "gh-cli" | "token";

export interface AuthStatus {
  ok: true;
  authenticated: boolean;
  login: string | null;
  scope: string | null;
  clientIdConfigured: boolean;
  mode: AuthMode;
  detail?: string | null;
}

export interface DeviceFlowStart {
  ok: true;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceFlowPoll =
  | { ok: true; status: "pending" | "throttled" | "expired" | "denied" }
  | { ok: true; status: "ok"; login: string }
  | { ok: true; status: "error"; error: string };

export function fetchAuthStatus(): Promise<AuthStatus> {
  return readJson<AuthStatus>("/api/auth/status");
}

export function startAuthFlow(): Promise<DeviceFlowStart> {
  return readJson<DeviceFlowStart>("/api/auth/start", { method: "POST" });
}

export function pollAuthFlow(): Promise<DeviceFlowPoll> {
  return readJson<DeviceFlowPoll>("/api/auth/poll", { method: "POST" });
}

export function logoutAuth(): Promise<{ ok: true }> {
  return readJson<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export interface AccountSummary {
  id: string;
  providerKind: "github" | "forgejo" | "gitlab";
  providerConfigId: string;
  label: string;
  login: string | null;
  scope: string;
  source: "device" | "oauth" | "gh-cli" | "token" | "env";
  ephemeral: boolean;
  active: boolean;
  capabilities: {
    graphql?: boolean;
    notifications?: boolean;
    projects?: boolean;
    ciWorkflows?: boolean;
    codeSearch?: boolean;
    dependents?: boolean;
    traffic?: boolean;
    stargazerHistory?: boolean;
  };
}

export interface AccountsList {
  ok: true;
  accounts: AccountSummary[];
  activeId: string | null;
}

export function fetchAccounts(): Promise<AccountsList> {
  return readJson<AccountsList>("/api/accounts");
}

export function activateAccount(id: string): Promise<{ ok: true; activeId: string }> {
  return readJson("/api/accounts/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export function removeAccount(id: string): Promise<{ ok: true }> {
  const query = new URLSearchParams({ id });
  return readJson(`/api/accounts?${query.toString()}`, { method: "DELETE" });
}

export interface ProviderConfigSummary {
  id: string;
  kind: "github" | "forgejo" | "gitlab";
  label: string;
  webUrl: string;
  tokenSettingsUrl: string;
  supportsDeviceFlow: boolean;
  supportsOAuth: boolean;
  oauthInstanceUrl: string | null;
}

export function fetchProviderConfigs(): Promise<{ ok: true; configs: ProviderConfigSummary[] }> {
  return readJson<{ ok: true; configs: ProviderConfigSummary[] }>("/api/provider-configs");
}

export function addTokenAccount(payload: { providerConfigId?: string; instanceUrl?: string; token: string; label?: string }): Promise<{ ok: true; accountId: string }> {
  return readJson("/api/accounts/add-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchGoals(signal?: AbortSignal): Promise<GoalsData> {
  return readJson<GoalsData>("/api/goals", withSignal(signal));
}

export function createGoal(payload: {
  repository: string;
  metric: GoalMetric;
  targetValue: number;
  currentValue?: number;
  deadline: string;
}): Promise<{ ok: true; goal: RepositoryGoal }> {
  return readJson("/api/goals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteGoal(id: string): Promise<{ ok: true }> {
  return readJson(`/api/goals/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function generateGoalAdvice(id: string): Promise<{ ok: true; suggestions: GoalSuggestion[]; generatedAt: string; aiEnabled: boolean }> {
  return readJson(`/api/goals/${encodeURIComponent(id)}/advice`, { method: "POST" });
}

export function fetchRepositoryContentSources(repository: string): Promise<{ ok: true; sources: GoalContentSource[] }> {
  return readJson(`/api/repository-content-sources?repo=${encodeURIComponent(repository)}`);
}

export function updateRepositoryContentSources(repository: string, sources: GoalContentSource[]): Promise<{ ok: true; sources: GoalContentSource[] }> {
  return readJson(`/api/repository-content-sources?repo=${encodeURIComponent(repository)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources }),
  });
}

export function fetchGoalProposals(
  goalId: string,
  suggestionIndex: number,
  refresh = false,
): Promise<GoalProposalsData> {
  const query = refresh ? "?refresh=1" : "";
  return readJson(`/api/goals/${encodeURIComponent(goalId)}/suggestions/${suggestionIndex}/proposals${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function fetchAiSettings(): Promise<{ ok: true; settings: AiSettingsSummary }> {
  return readJson("/api/ai/settings");
}

export function updateAiSettings(payload: AiSettingsUpdate): Promise<{ ok: true; settings: AiSettingsSummary }> {
  return readJson("/api/ai/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function resetAiSettings(): Promise<{ ok: true; settings: AiSettingsSummary }> {
  return readJson("/api/ai/settings", { method: "DELETE" });
}

export function testAiSettings(): Promise<AiConnectionTest> {
  return readJson("/api/ai/settings/test", { method: "POST" });
}

export function fetchRepos(fresh = false, signal?: AbortSignal): Promise<ReposData> {
  return readJson<ReposData>(`/api/repos${fresh ? "?fresh=1" : ""}`, withSignal(signal), "/api/repos");
}

export function fetchIssues(fresh = false, signal?: AbortSignal): Promise<IssuesData> {
  return readJson<IssuesData>(`/api/issues${fresh ? "?fresh=1" : ""}`, withSignal(signal), "/api/issues");
}

export function fetchPullRequests(fresh = false, signal?: AbortSignal): Promise<PullRequestsData> {
  return readJson<PullRequestsData>(`/api/prs${fresh ? "?fresh=1" : ""}`, withSignal(signal), "/api/prs");
}

export function fetchStargazers(params: {
  repo: string;
  cursor?: string | null;
  direction: "ASC" | "DESC";
}): Promise<{ ok: true; totalCount: number; pageInfo: PageInfo; edges: StargazerNode[] }> {
  const query = new URLSearchParams({ repo: params.repo, direction: params.direction });
  if (params.cursor) query.set("cursor", params.cursor);
  return readJson(`/api/stargazers?${query.toString()}`);
}

export function fetchForks(params: {
  repo: string;
  cursor?: string | null;
  direction: "ASC" | "DESC";
  field: string;
}): Promise<{ ok: true; totalCount: number; pageInfo: PageInfo; nodes: ForkNode[] }> {
  const query = new URLSearchParams({ repo: params.repo, direction: params.direction, field: params.field });
  if (params.cursor) query.set("cursor", params.cursor);
  return readJson(`/api/forks?${query.toString()}`);
}

export type RepoDetailsSection = "overview" | "actions" | "commits" | "milestones" | "releases" | "traffic" | "minimal";

export function fetchRepoDetails(repo: string, section: RepoDetailsSection = "overview", fresh = false): Promise<RepoDetailsData> {
  const query = new URLSearchParams({ repo, section });
  const url = `/api/repo-details?${query.toString()}`;
  return swr<RepoDetailsData>(url, () => readJson(url, undefined, url), { fresh }).promise;
}

export function fetchRepoBranches(repo: string): Promise<{ ok: true; totalCount: number; defaultBranch: string | null; branches: RepoBranch[] }> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/repo-branches?${query.toString()}`);
}

export function fetchRepoDiscussions(repo: string): Promise<{ ok: true; enabled: boolean; totalCount: number; discussions: RepoDiscussion[] }> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/repo-discussions?${query.toString()}`);
}

export function fetchMentionIssues(repo: string): Promise<{ ok: true; items: MentionIssueItem[]; totalCount: number; aliases: string[] }> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/mentions/issues?${query.toString()}`);
}

export function fetchMentionCode(repo: string): Promise<{ ok: true; items: MentionCodeItem[]; totalCount: number; aliases: string[] }> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/mentions/code?${query.toString()}`);
}

export function fetchRepoAliases(repo: string): Promise<{ ok: true; aliases: string[] }> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/repo-aliases?${query.toString()}`);
}

export function addRepoAlias(repo: string, alias: string): Promise<{ ok: true; aliases: string[] }> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/repo-aliases?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias }),
  });
}

export function removeRepoAlias(repo: string, alias: string): Promise<{ ok: true; aliases: string[] }> {
  const query = new URLSearchParams({ repo, alias });
  return readJson(`/api/repo-aliases?${query.toString()}`, { method: "DELETE" });
}

export function fetchDependents(repo: string): Promise<{ ok: true; items: DependentItem[]; totalRepos: number; notAvailable: boolean }> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/mentions/dependents?${query.toString()}`);
}

export function fetchRepoTraffic(repo: string): Promise<RepoTrafficDetails> {
  const query = new URLSearchParams({ repo });
  return readJson(`/api/mentions/referrers?${query.toString()}`);
}

export function fetchRepoInsights(fresh = false, signal?: AbortSignal, repos: string[] = []): Promise<RepoInsightsData> {
  const query = new URLSearchParams();
  if (fresh) query.set("fresh", "1");
  for (const repo of repos) query.append("repo", repo);
  const suffix = query.size ? `?${query.toString()}` : "";
  const cacheKey = repos.length ? `/api/repo-insights?${new URLSearchParams([...repos].sort().map((repo) => ["repo", repo])).toString()}` : "/api/repo-insights";
  return readJson(`/api/repo-insights${suffix}`, withSignal(signal), cacheKey);
}

export function fetchDailyDigests(signal?: AbortSignal, period: "day" | "week" | "month" = "day"): Promise<DailyDigestsData> {
  const query = period === "day" ? "" : `?period=${period}`;
  const cacheKey = `/api/daily-digests${query}`;
  return readJson(`/api/daily-digests${query}`, withSignal(signal), cacheKey);
}

export function fetchCIHealth(fresh = false, signal?: AbortSignal): Promise<CIHealthData> {
  return readJson<CIHealthData>(`/api/ci-health${fresh ? "?fresh=1" : ""}`, withSignal(signal), "/api/ci-health");
}

export function fetchNotifications(fresh = false, signal?: AbortSignal): Promise<NotificationsData> {
  return readJson<NotificationsData>(`/api/notifications${fresh ? "?fresh=1" : ""}`, withSignal(signal), "/api/notifications");
}

export function markNotificationRead(threadId: string): Promise<{ ok: true }> {
  return readJson("/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId }),
  });
}

export function markAllNotificationsRead(payload: { repo?: string; lastReadAt?: string } = {}): Promise<{ ok: true }> {
  return readJson("/api/notifications/read-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchProjects(): Promise<{ ok: true; projects: ProjectSummary[] }> {
  return readJson("/api/projects");
}

export function fetchProject(id: string): Promise<{ ok: true; project: ProjectDetails }> {
  return readJson(`/api/project?id=${encodeURIComponent(id)}`);
}

export function moveProjectItem(payload: {
  projectId: string;
  itemId: string;
  fieldId: string;
  optionId: string | null;
}): Promise<{ ok: true }> {
  return readJson("/api/project/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
