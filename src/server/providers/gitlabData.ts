import type {
  GhIssue,
  GhNotification,
  GhNotificationReason,
  GhPullRequest,
  GhRepo,
  GhUser,
} from "../../types/github";
import type { Account, ProviderConfig } from "./types";

interface GitLabUser {
  id: number;
  username: string;
  name?: string;
  avatar_url?: string;
  web_url?: string;
}

interface GitLabNamespace {
  full_path: string;
  avatar_url?: string | null;
}

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  namespace: GitLabNamespace;
  star_count: number;
  forks_count: number;
  open_issues_count?: number;
  last_activity_at: string;
  visibility: string;
  archived: boolean;
  forked_from_project?: unknown;
  topics?: string[];
  permissions?: {
    project_access?: { access_level: number } | null;
    group_access?: { access_level: number } | null;
  };
}

interface GitLabIssue {
  iid: number;
  title: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  author: GitLabUser;
  labels?: string[];
  assignees?: GitLabUser[];
  user_notes_count?: number;
  references?: { full?: string };
}

interface GitLabMergeRequest extends GitLabIssue {
  draft?: boolean;
  work_in_progress?: boolean;
  target_branch?: string;
  source_branch?: string;
  changes_count?: string | null;
  reviewers?: GitLabUser[];
}

interface GitLabTodo {
  id: number;
  action_name?: string;
  created_at: string;
  target_type?: string;
  target?: { iid?: number; title?: string; web_url?: string } | null;
  project?: GitLabProject | null;
}

type RestResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; error: string };

function headers(account: Account, config: ProviderConfig): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": config.userAgent,
    "PRIVATE-TOKEN": account.accessToken,
  };
}

async function rest<T>(account: Account, config: ProviderConfig, path: string, init?: RequestInit): Promise<RestResult<T>> {
  const url = path.startsWith("http") ? path : `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(account, config), ...((init?.headers as Record<string, string>) ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
  if (!text) return { ok: true, status: response.status, data: null as T };
  try {
    return { ok: true, status: response.status, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: response.status, error: "invalid JSON" };
  }
}

async function paginate<T>(account: Account, config: ProviderConfig, path: string, maxPages = 10): Promise<RestResult<T[]>> {
  const separator = path.includes("?") ? "&" : "?";
  const collected: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await rest<T[]>(account, config, `${path}${separator}per_page=100&page=${page}`);
    if (!result.ok) return result;
    collected.push(...result.data);
    if (result.data.length < 100) break;
  }
  return { ok: true, status: 200, data: collected };
}

function permission(project: GitLabProject): string | null {
  const level = Math.max(
    project.permissions?.project_access?.access_level ?? 0,
    project.permissions?.group_access?.access_level ?? 0,
  );
  if (level >= 40) return "ADMIN";
  if (level >= 30) return "WRITE";
  if (level > 0) return "READ";
  return null;
}

function normalizeRepo(project: GitLabProject): GhRepo {
  return {
    nameWithOwner: project.path_with_namespace,
    name: project.name,
    owner: {
      login: project.namespace.full_path,
      avatarUrl: project.namespace.avatar_url ?? undefined,
    },
    description: project.description,
    stargazerCount: project.star_count ?? 0,
    forkCount: project.forks_count ?? 0,
    openIssueCount: project.open_issues_count ?? 0,
    primaryLanguage: null,
    updatedAt: project.last_activity_at,
    pushedAt: project.last_activity_at,
    visibility: project.visibility,
    isPrivate: project.visibility === "private",
    isArchived: Boolean(project.archived),
    isFork: Boolean(project.forked_from_project),
    isTemplate: false,
    viewerPermission: permission(project),
    url: project.web_url,
  };
}

function user(raw: GitLabUser | undefined): GhUser | undefined {
  if (!raw) return undefined;
  return { login: raw.username, avatarUrl: raw.avatar_url, url: raw.web_url };
}

function projectPathFromItem(raw: GitLabIssue): string {
  const reference = raw.references?.full;
  if (reference) {
    const marker = reference.lastIndexOf("#");
    if (marker > 0) return reference.slice(0, marker);
    const mergeMarker = reference.lastIndexOf("!");
    if (mergeMarker > 0) return reference.slice(0, mergeMarker);
  }
  try {
    const parts = new URL(raw.web_url).pathname.split("/-/")[0].split("/").filter(Boolean);
    return parts.join("/");
  } catch {
    return "";
  }
}

function normalizeIssue(raw: GitLabIssue): GhIssue {
  const fullName = projectPathFromItem(raw);
  return {
    repository: { name: fullName.split("/").pop() ?? "", nameWithOwner: fullName },
    title: raw.title,
    url: raw.web_url,
    number: raw.iid,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    author: user(raw.author),
    labels: (raw.labels ?? []).map((name) => ({ name })),
    commentsCount: raw.user_notes_count ?? 0,
    assignees: (raw.assignees ?? []).map((entry) => user(entry) as GhUser),
  };
}

function normalizeMergeRequest(raw: GitLabMergeRequest): GhPullRequest {
  return {
    ...normalizeIssue(raw),
    isDraft: Boolean(raw.draft ?? raw.work_in_progress),
    reviewDecision: "REVIEW_REQUIRED",
    reviewsCount: raw.reviewers?.length ?? 0,
    additions: 0,
    deletions: 0,
    changedFiles: Number(raw.changes_count) || 0,
    baseRefName: raw.target_branch ?? "",
    headRefName: raw.source_branch ?? "",
  };
}

function todoReason(action: string | undefined): GhNotificationReason {
  switch (action) {
    case "assigned": return "assign";
    case "mentioned": return "mention";
    case "directly_addressed": return "mention";
    case "review_requested": return "review_requested";
    default: return "subscribed";
  }
}

function normalizeTodo(todo: GitLabTodo): GhNotification {
  const project = todo.project;
  const number = todo.target?.iid ?? null;
  return {
    id: String(todo.id),
    unread: true,
    reason: todoReason(todo.action_name),
    updatedAt: todo.created_at,
    lastReadAt: null,
    subject: {
      title: todo.target?.title ?? "",
      url: null,
      latestCommentUrl: null,
      type: todo.target_type === "MergeRequest" ? "PullRequest" : (todo.target_type ?? ""),
    },
    repository: {
      name: project?.name ?? "",
      nameWithOwner: project?.path_with_namespace ?? "",
      private: project?.visibility === "private",
      htmlUrl: project?.web_url ?? "",
    },
    itemNumber: number,
    itemHtmlUrl: todo.target?.web_url ?? null,
  };
}

export async function fetchGitLabOwners(account: Account, config: ProviderConfig) {
  const identity = await rest<GitLabUser>(account, config, "/user");
  if (!identity.ok) {
    return identity.status === 401
      ? { ok: false as const, error: "authentication required", needsAuth: true as const }
      : { ok: false as const, error: `/user: ${identity.error}` };
  }
  const projects = await paginate<GitLabProject>(account, config, "/projects?membership=true&simple=true", 10);
  const namespaces = projects.ok ? projects.data.map((project) => project.namespace.full_path) : [];
  return { ok: true as const, owners: Array.from(new Set([identity.data.username, ...namespaces].filter(Boolean))) };
}

export async function fetchGitLabRepos(account: Account, config: ProviderConfig): Promise<GhRepo[]> {
  const result = await paginate<GitLabProject>(account, config, "/projects?membership=true&simple=true&order_by=last_activity_at", 10);
  return result.ok ? result.data.map(normalizeRepo) : [];
}

export async function fetchGitLabIssues(account: Account, config: ProviderConfig): Promise<GhIssue[]> {
  const result = await paginate<GitLabIssue>(account, config, "/issues?scope=all&state=opened&order_by=updated_at", 10);
  return result.ok ? result.data.map(normalizeIssue) : [];
}

export async function fetchGitLabMergeRequests(account: Account, config: ProviderConfig): Promise<GhPullRequest[]> {
  const result = await paginate<GitLabMergeRequest>(account, config, "/merge_requests?scope=all&state=opened&order_by=updated_at", 10);
  return result.ok ? result.data.map(normalizeMergeRequest) : [];
}

export async function fetchGitLabTodos(account: Account, config: ProviderConfig) {
  const result = await paginate<GitLabTodo>(account, config, "/todos?state=pending", 5);
  if (!result.ok) {
    return result.status === 401
      ? { ok: false as const, error: "authentication required", needsAuth: true as const }
      : { ok: false as const, error: result.error };
  }
  return {
    ok: true as const,
    refreshed: true,
    notifications: result.data.map(normalizeTodo),
    pollInterval: 60,
    lastModified: null,
  };
}

export async function markGitLabTodoRead(account: Account, config: ProviderConfig, id: string) {
  const result = await rest(account, config, `/todos/${encodeURIComponent(id)}/mark_as_done`, { method: "POST" });
  if (result.ok) return { ok: true as const, status: result.status };
  return { ok: false as const, status: result.status, error: result.error, ...(result.status === 401 ? { needsAuth: true as const } : {}) };
}

export async function markAllGitLabTodosRead(account: Account, config: ProviderConfig) {
  const result = await rest(account, config, "/todos/mark_as_done", { method: "POST" });
  if (result.ok) return { ok: true as const, status: result.status };
  return { ok: false as const, status: result.status, error: result.error, ...(result.status === 401 ? { needsAuth: true as const } : {}) };
}
