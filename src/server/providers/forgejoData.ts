import type {
  GhIssue,
  GhNotification,
  GhNotificationReason,
  GhPullRequest,
  GhRepo,
  ReviewDecision,
} from "../../types/github";
import { getProviderConfig } from "../accountStore";
import type { Account, ProviderConfig } from "./types";

interface ForgejoUser {
  id?: number;
  login?: string;
  username?: string;
  full_name?: string;
  avatar_url?: string;
  html_url?: string;
}

interface ForgejoOrg {
  id?: number;
  username?: string;
  name?: string;
  full_name?: string;
  avatar_url?: string;
}

interface ForgejoRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  owner: ForgejoUser;
  stars_count?: number;
  stargazers_count?: number;
  forks_count: number;
  language?: string | null;
  updated_at: string;
  pushed_at?: string;
  private?: boolean;
  archived?: boolean;
  fork?: boolean;
  internal?: boolean;
  template?: boolean;
  permissions?: { push?: boolean };
}

interface ForgejoLabel {
  id: number;
  name: string;
  color?: string;
  description?: string;
}

interface ForgejoIssueLike {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: ForgejoUser | null;
  comments: number;
  labels?: ForgejoLabel[];
  assignees?: ForgejoUser[] | null;
  repository?: { name?: string; full_name?: string; html_url?: string };
  pull_request?: { merged?: boolean; html_url?: string; draft?: boolean } | null;
}

interface ForgejoNotification {
  id: number | string;
  unread: boolean;
  pinned?: boolean;
  updated_at: string;
  url?: string;
  subject?: {
    title?: string;
    url?: string | null;
    latest_comment_url?: string | null;
    type?: string;
    state?: string;
  };
  repository?: {
    name?: string;
    full_name?: string;
    html_url?: string;
    private?: boolean;
  };
}

type RestResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; error: string };

function authHeaders(account: Account, extra?: Record<string, string>): Record<string, string> {
  const config = providerConfigOf(account);
  return {
    Accept: "application/json",
    "User-Agent": config.userAgent,
    Authorization: `token ${account.accessToken}`,
    ...(extra ?? {}),
  };
}

const configCache = new Map<string, ProviderConfig>();

async function resolveConfig(account: Account): Promise<ProviderConfig> {
  const cached = configCache.get(account.providerConfigId);
  if (cached) return cached;
  const cfg = await getProviderConfig(account.providerConfigId);
  if (!cfg) throw new Error(`Unknown provider config: ${account.providerConfigId}`);
  configCache.set(account.providerConfigId, cfg);
  return cfg;
}

function providerConfigOf(account: Account): ProviderConfig {
  const cached = configCache.get(account.providerConfigId);
  if (!cached) throw new Error(`Provider config for ${account.providerConfigId} not loaded`);
  return cached;
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

async function rest<T>(account: Account, path: string, init?: RequestInit): Promise<RestResult<T>> {
  await resolveConfig(account);
  const config = providerConfigOf(account);
  const url = path.startsWith("http") ? path : `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(account), ...((init?.headers as Record<string, string>) ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
  }
  if (!text) return { ok: true, status: response.status, data: null as T };
  try {
    return { ok: true, status: response.status, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: response.status, error: "invalid JSON" };
  }
}

async function restPaginate<T>(account: Account, path: string, perPage = 50, maxPages = 10): Promise<RestResult<T[]>> {
  await resolveConfig(account);
  const config = providerConfigOf(account);
  const separator = path.includes("?") ? "&" : "?";
  const initialUrl = path.startsWith("http")
    ? path
    : `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}${separator}page=1&limit=${perPage}`;
  const collected: T[] = [];
  let url: string | null = initialUrl;
  let pages = 0;
  while (url && pages < maxPages) {
    const response = await fetch(url, { headers: authHeaders(account) });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
    let page: unknown;
    try { page = JSON.parse(text); }
    catch { return { ok: false, status: response.status, error: "invalid JSON" }; }
    if (Array.isArray(page)) {
      for (const item of page) collected.push(item as T);
    } else {
      collected.push(page as T);
    }
    const link = response.headers.get("link");
    url = parseNextLink(link);
    pages += 1;
  }
  return { ok: true, status: 200, data: collected };
}

function normalizeRepo(raw: ForgejoRepo): GhRepo {
  return {
    nameWithOwner: raw.full_name,
    name: raw.name,
    owner: { login: raw.owner.login ?? raw.owner.username ?? "", avatarUrl: raw.owner.avatar_url },
    description: raw.description,
    stargazerCount: raw.stars_count ?? raw.stargazers_count ?? 0,
    forkCount: raw.forks_count ?? 0,
    primaryLanguage: raw.language ? { name: raw.language } : null,
    updatedAt: raw.updated_at,
    pushedAt: raw.pushed_at ?? raw.updated_at,
    visibility: raw.private ? "private" : raw.internal ? "internal" : "public",
    isPrivate: Boolean(raw.private),
    isArchived: Boolean(raw.archived),
    isFork: Boolean(raw.fork),
    isTemplate: Boolean(raw.template),
    viewerPermission: raw.permissions?.push === false ? "READ" : null,
    url: raw.html_url,
  };
}

function repositoryFromIssueUrl(html_url: string, fallbackFull?: string): { name: string; nameWithOwner: string } {
  // Forgejo issue html_url format: {webUrl}/{owner}/{repo}/issues/{n}
  try {
    const u = new URL(html_url);
    const parts = u.pathname.split("/").filter(Boolean);
    const owner = parts[0];
    const repo = parts[1];
    if (owner && repo) return { name: repo, nameWithOwner: `${owner}/${repo}` };
  } catch {
    // ignore
  }
  if (fallbackFull) {
    const [, repo] = fallbackFull.split("/");
    return { name: repo ?? fallbackFull, nameWithOwner: fallbackFull };
  }
  return { name: "", nameWithOwner: "" };
}

function normalizeIssue(raw: ForgejoIssueLike): GhIssue {
  const repository = raw.repository?.full_name
    ? { name: raw.repository.name ?? raw.repository.full_name.split("/")[1] ?? "", nameWithOwner: raw.repository.full_name }
    : repositoryFromIssueUrl(raw.html_url);
  return {
    repository,
    title: raw.title,
    url: raw.html_url,
    number: raw.number,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    author: raw.user ? { login: raw.user.login ?? raw.user.username ?? "", avatarUrl: raw.user.avatar_url, url: raw.user.html_url } : undefined,
    labels: (raw.labels ?? []).map((label) => ({ name: label.name, color: label.color, description: label.description })),
    commentsCount: raw.comments ?? 0,
    assignees: (raw.assignees ?? []).map((user) => ({ login: user.login ?? user.username ?? "", avatarUrl: user.avatar_url, url: user.html_url })),
  };
}

function normalizePullRequest(raw: ForgejoIssueLike): GhPullRequest {
  const base = normalizeIssue(raw);
  const reviewDecision: ReviewDecision = "REVIEW_REQUIRED";
  return {
    ...base,
    isDraft: Boolean(raw.pull_request?.draft),
    reviewDecision,
    reviewsCount: 0,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    baseRefName: "",
    headRefName: "",
  };
}

function normalizeNotification(raw: ForgejoNotification): GhNotification {
  const repoFullName = raw.repository?.full_name ?? "";
  const repoName = raw.repository?.name ?? repoFullName.split("/").pop() ?? "";
  const repoHtml = raw.repository?.html_url ?? "";
  const subjectUrl = raw.subject?.url ?? null;
  const subjectType = raw.subject?.type ?? "";
  let itemNumber: number | null = null;
  if (subjectUrl) {
    const match = /\/(?:issues|pulls)\/(\d+)/.exec(subjectUrl);
    if (match) itemNumber = Number(match[1]);
  }
  let itemHtmlUrl: string | null = null;
  if (itemNumber && repoHtml) {
    if (subjectType === "Pull") itemHtmlUrl = `${repoHtml}/pulls/${itemNumber}`;
    else if (subjectType === "Issue") itemHtmlUrl = `${repoHtml}/issues/${itemNumber}`;
  }
  const reason: GhNotificationReason = "subscribed";
  return {
    id: String(raw.id),
    unread: Boolean(raw.unread),
    reason,
    updatedAt: raw.updated_at,
    lastReadAt: null,
    subject: {
      title: raw.subject?.title ?? "",
      url: subjectUrl,
      latestCommentUrl: raw.subject?.latest_comment_url ?? null,
      type: subjectType === "Pull" ? "PullRequest" : (subjectType || ""),
    },
    repository: {
      name: repoName,
      nameWithOwner: repoFullName,
      private: Boolean(raw.repository?.private),
      htmlUrl: repoHtml,
    },
    itemNumber,
    itemHtmlUrl,
  };
}

export async function fetchForgejoOwners(account: Account): Promise<{ ok: true; owners: string[] } | { ok: false; error: string; needsAuth?: true }> {
  const user = await rest<ForgejoUser>(account, "/user");
  if (!user.ok) {
    if (user.status === 401) return { ok: false, error: "authentication required", needsAuth: true };
    return { ok: false, error: `/user: ${user.error}` };
  }
  const orgs = await rest<ForgejoOrg[]>(account, "/user/orgs");
  if (!orgs.ok) {
    if (orgs.status === 401) return { ok: false, error: "authentication required", needsAuth: true };
    return { ok: false, error: `/user/orgs: ${orgs.error}` };
  }
  const userLogin = user.data.login ?? user.data.username ?? "";
  const orgLogins = (orgs.data ?? []).map((entry) => entry.username ?? entry.name ?? "").filter(Boolean);
  const owners = Array.from(new Set([userLogin, ...orgLogins].filter(Boolean)));
  return { ok: true, owners };
}

async function fetchReposForOwner(account: Account, owner: string): Promise<GhRepo[]> {
  // Try user repos first; fall back to org repos if 404.
  const userResult = await restPaginate<ForgejoRepo>(account, `/users/${encodeURIComponent(owner)}/repos`);
  if (userResult.ok && userResult.data.length > 0) {
    return userResult.data.map(normalizeRepo);
  }
  if (userResult.ok) return [];
  if (userResult.status !== 404) return [];
  const orgResult = await restPaginate<ForgejoRepo>(account, `/orgs/${encodeURIComponent(owner)}/repos`);
  if (!orgResult.ok) return [];
  return orgResult.data.map(normalizeRepo);
}

export async function fetchForgejoRepos(account: Account, owners: string[]): Promise<GhRepo[]> {
  const lists = await Promise.all(owners.map((owner) => fetchReposForOwner(account, owner)));
  const seen = new Set<string>();
  const result: GhRepo[] = [];
  for (const list of lists) {
    for (const repo of list) {
      if (seen.has(repo.nameWithOwner)) continue;
      seen.add(repo.nameWithOwner);
      result.push(repo);
    }
  }
  return result;
}

async function fetchIssueLikes(account: Account, owners: string[], type: "issues" | "pulls"): Promise<ForgejoIssueLike[]> {
  if (!owners.length) return [];
  const all: ForgejoIssueLike[] = [];
  for (const owner of owners) {
    const params = new URLSearchParams({ type, state: "open", owner });
    const result = await restPaginate<ForgejoIssueLike>(account, `/repos/issues/search?${params.toString()}`, 50, 5);
    if (result.ok) all.push(...result.data);
  }
  return all;
}

export async function fetchForgejoIssues(account: Account, owners: string[]): Promise<GhIssue[]> {
  const raws = await fetchIssueLikes(account, owners, "issues");
  return raws.filter((entry) => !entry.pull_request).map(normalizeIssue);
}

export async function fetchForgejoPullRequests(account: Account, owners: string[]): Promise<GhPullRequest[]> {
  const raws = await fetchIssueLikes(account, owners, "pulls");
  return raws.map(normalizePullRequest);
}

export interface ForgejoNotificationsFetchResult {
  refreshed: boolean;
  notifications: GhNotification[];
  pollInterval: number;
  lastModified: string | null;
}

export async function fetchForgejoNotifications(account: Account, ifModifiedSince: string | null): Promise<ForgejoNotificationsFetchResult | { error: string; needsAuth?: true }> {
  await resolveConfig(account);
  const config = providerConfigOf(account);
  const url = `${config.baseUrl}/notifications?all=true&page=1&limit=50`;
  const headers: Record<string, string> = { ...authHeaders(account) };
  if (ifModifiedSince) headers["If-Modified-Since"] = ifModifiedSince;
  const response = await fetch(url, { headers });
  if (response.status === 401) return { error: "authentication required", needsAuth: true };
  const lastModified = response.headers.get("last-modified");
  if (response.status === 304) {
    return { refreshed: false, notifications: [], pollInterval: 60, lastModified };
  }
  if (!response.ok) {
    const text = await response.text();
    return { error: text || `HTTP ${response.status}` };
  }
  const raw = (await response.json()) as ForgejoNotification[];
  return {
    refreshed: true,
    notifications: raw.map(normalizeNotification),
    pollInterval: 60,
    lastModified,
  };
}

export async function markForgejoThreadRead(account: Account, threadId: string): Promise<{ ok: true; status: number } | { ok: false; status: number; error: string; needsAuth?: true }> {
  const result = await rest(account, `/notifications/threads/${encodeURIComponent(threadId)}`, { method: "PATCH" });
  if (result.ok) return { ok: true, status: result.status };
  if (result.status === 401) return { ok: false, status: 401, error: "authentication required", needsAuth: true };
  return { ok: false, status: result.status, error: result.error };
}

export async function markForgejoAllRead(account: Account, options: { repo?: string | null; lastReadAt?: string | null }): Promise<{ ok: true; status: number } | { ok: false; status: number; error: string; needsAuth?: true }> {
  const lastReadAt = options.lastReadAt ?? new Date().toISOString();
  const params = new URLSearchParams({ last_read_at: lastReadAt });
  const path = options.repo
    ? `/repos/${options.repo}/notifications?${params.toString()}`
    : `/notifications?${params.toString()}`;
  const result = await rest(account, path, { method: "PUT" });
  if (result.ok) return { ok: true, status: result.status };
  if (result.status === 401) return { ok: false, status: 401, error: "authentication required", needsAuth: true };
  return { ok: false, status: result.status, error: result.error };
}
