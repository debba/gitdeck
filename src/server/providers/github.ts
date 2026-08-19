import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GhIssue,
  GhLabel,
  GhNotification,
  GhNotificationReason,
  GhPullRequest,
  GhRepo,
  GhUser,
  ReviewDecision,
} from "../../types/github";
import type {
  Account,
  DeviceFlowPoll,
  DeviceFlowStart,
  NotificationMutationOutcome,
  NotificationsFetchOutcome,
  OwnersOutcome,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderIdentity,
} from "./types";

const execFileAsync = promisify(execFile);

const CAPABILITIES: ProviderCapabilities = {
  graphql: true,
  notifications: true,
  projects: true,
  ciWorkflows: true,
  codeSearch: true,
  dependents: true,
  traffic: true,
  stargazerHistory: true,
};

interface PendingFlow {
  deviceCode: string;
  interval: number;
  expiresAt: number;
}

export class GitHubProvider implements Provider {
  readonly kind = "github" as const;
  readonly capabilities = CAPABILITIES;

  private pending: PendingFlow | null = null;
  private lastPollAt = 0;

  constructor(readonly config: ProviderConfig) {}

  private clientId(): string {
    const id = this.config.oauthClientId ?? process.env.GITHUB_CLIENT_ID?.trim();
    if (!id) {
      throw new Error(
        "GITHUB_CLIENT_ID is not set. Register an OAuth App at https://github.com/settings/developers " +
          "(enable Device Flow) and export GITHUB_CLIENT_ID before starting the server.",
      );
    }
    return id;
  }

  private scopes(): string {
    return (
      process.env.GITHUB_OAUTH_SCOPES?.trim() ||
      this.config.oauthScopes ||
      "repo read:org project read:user user:email"
    );
  }

  async startDeviceFlow(): Promise<DeviceFlowStart> {
    const url = this.config.oauthDeviceCodeUrl;
    if (!url) throw new Error(`Device flow URL not configured for ${this.config.id}`);
    const body = new URLSearchParams({ client_id: this.clientId(), scope: this.scopes() });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const text = await response.text();
    let parsed: {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
      error_description?: string;
    } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // body not JSON
    }
    if (!response.ok || parsed.error || !parsed.device_code) {
      const detail = parsed.error_description || parsed.error || text || `HTTP ${response.status}`;
      throw new Error(`GitHub device-code request failed: ${detail}`);
    }
    this.pending = {
      deviceCode: parsed.device_code,
      interval: Math.max(5, parsed.interval || 5),
      expiresAt: Date.now() + (parsed.expires_in ?? 900) * 1000,
    };
    this.lastPollAt = 0;
    return {
      userCode: parsed.user_code ?? "",
      verificationUri: parsed.verification_uri ?? "",
      expiresIn: parsed.expires_in ?? 0,
      interval: parsed.interval ?? 5,
      deviceCode: parsed.device_code,
    };
  }

  async pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll> {
    if (!this.pending || this.pending.deviceCode !== deviceCode) {
      return { status: "error", error: "no pending device flow" };
    }
    if (Date.now() >= this.pending.expiresAt) {
      this.pending = null;
      return { status: "expired" };
    }
    const minInterval = this.pending.interval * 1000;
    if (Date.now() - this.lastPollAt < minInterval) return { status: "throttled" };
    this.lastPollAt = Date.now();

    const url = this.config.oauthTokenUrl;
    if (!url) return { status: "error", error: "oauthTokenUrl not configured" };
    const body = new URLSearchParams({
      client_id: this.clientId(),
      device_code: this.pending.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data = (await response.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
      interval?: number;
    };

    if (data.access_token) {
      const identity = await this.fetchIdentity(data.access_token);
      this.pending = null;
      return {
        status: "ok",
        accessToken: data.access_token,
        scope: data.scope ?? "",
        login: identity.login,
      };
    }

    switch (data.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        if (data.interval) this.pending.interval = Math.max(this.pending.interval, data.interval);
        return { status: "throttled", interval: data.interval };
      case "expired_token":
        this.pending = null;
        return { status: "expired" };
      case "access_denied":
        this.pending = null;
        return { status: "denied" };
      default:
        return { status: "error", error: data.error_description || data.error || "unknown error" };
    }
  }

  async fetchIdentity(token: string): Promise<ProviderIdentity> {
    const response = await fetch(`${this.config.baseUrl}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": this.config.userAgent,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      return { login: "", scope: response.headers.get("x-oauth-scopes") };
    }
    const data = (await response.json()) as { login?: string; avatar_url?: string; html_url?: string };
    return {
      login: data.login ?? "",
      scope: response.headers.get("x-oauth-scopes"),
      avatarUrl: data.avatar_url ?? null,
      htmlUrl: data.html_url ?? null,
    };
  }

  async loadFromGhCli(): Promise<{ token: string } | null> {
    try {
      const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 5000 });
      const token = stdout.trim();
      if (!token) return null;
      return { token };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string };
      if (err.code === "ENOENT") {
        throw new Error(
          "gh CLI is not installed. Install it from https://cli.github.com/ or switch GH_AUTH_MODE.",
        );
      }
      const detail = err.stderr?.trim() || err.message;
      throw new Error(`gh auth token failed: ${detail}. Run 'gh auth login' first.`);
    }
  }

  private restHeaders(account: Account, extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      "User-Agent": this.config.userAgent,
      Authorization: `Bearer ${account.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(extra ?? {}),
    };
  }

  private async restGet<T>(account: Account, path: string): Promise<{ ok: true; data: T; status: number } | { ok: false; status: number; error: string }> {
    const url = path.startsWith("http") ? path : `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetch(url, { headers: this.restHeaders(account) });
    if (response.status === 204) return { ok: true, data: null as T, status: 204 };
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
    try { return { ok: true, data: JSON.parse(text) as T, status: response.status }; }
    catch { return { ok: false, status: response.status, error: "invalid JSON" }; }
  }

  private async gqlCall<T>(account: Account, query: string, variables: Record<string, unknown>): Promise<T> {
    const url = this.config.graphqlUrl ?? `${this.config.baseUrl}/graphql`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": this.config.userAgent,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 401) throw new GitHubAuthRequiredError();
    const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(json.errors.map((entry) => entry.message).join("; "));
    if (!json.data) throw new Error("Empty GraphQL response");
    return json.data;
  }

  async listOwners(account: Account): Promise<OwnersOutcome> {
    try {
      const user = await this.restGet<{ login: string }>(account, "/user");
      if (!user.ok) {
        if (user.status === 401) return { ok: false, error: "authentication required", needsAuth: true };
        return { ok: false, error: `/user: ${user.error}` };
      }
      const orgs = await this.restGet<{ login: string }[]>(account, "/user/orgs");
      if (!orgs.ok) {
        if (orgs.status === 401) return { ok: false, error: "authentication required", needsAuth: true };
        return { ok: false, error: `/user/orgs: ${orgs.error}` };
      }
      const owners = Array.from(
        new Set([user.data.login, ...orgs.data.map((entry) => entry.login)].filter(Boolean)),
      );
      return { ok: true, owners };
    } catch (error) {
      if (error instanceof GitHubAuthRequiredError) return { ok: false, error: "authentication required", needsAuth: true };
      return { ok: false, error: (error as Error).message || String(error) };
    }
  }

  async listRepos(account: Account, owners: string[]): Promise<GhRepo[]> {
    const lists = await Promise.all(owners.map((owner) => this.reposForOwner(account, owner)));
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

  private async reposForOwner(account: Account, owner: string): Promise<GhRepo[]> {
    const collected: GhRepo[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      let data: RepoListResponse;
      try {
        data = await this.gqlCall<RepoListResponse>(account, REPO_LIST_QUERY, { owner, cursor });
      } catch {
        return collected;
      }
      const owned = data.repositoryOwner?.repositories;
      if (!owned) return collected;
      for (const node of owned.nodes) {
        collected.push({
          nameWithOwner: node.nameWithOwner,
          name: node.name,
          owner: node.owner,
          description: node.description,
          stargazerCount: node.stargazerCount,
          forkCount: node.forkCount,
          primaryLanguage: node.primaryLanguage,
          updatedAt: node.updatedAt,
          pushedAt: node.pushedAt,
          visibility: node.visibility?.toLowerCase() ?? "",
          isPrivate: node.isPrivate,
          isArchived: node.isArchived,
          isFork: node.isFork,
          isTemplate: node.isTemplate,
          viewerPermission: node.viewerPermission,
          url: node.url,
        });
      }
      if (!owned.pageInfo.hasNextPage) break;
      cursor = owned.pageInfo.endCursor;
      if (!cursor) break;
    }
    return collected;
  }

  async listIssues(account: Account, owners: string[]): Promise<GhIssue[]> {
    if (!owners.length) return [];
    const q = `is:issue is:open ${owners.map((owner) => `user:${owner}`).join(" ")}`.trim();
    const collected: GhIssue[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const data: IssueSearchResponse = await this.gqlCall<IssueSearchResponse>(account, ISSUE_SEARCH_QUERY, { q, cursor });
      for (const raw of data.search.nodes) {
        if (raw.__typename !== "Issue") continue;
        const node = raw as IssueSearchNode;
        collected.push({
          repository: node.repository,
          title: node.title,
          url: node.url,
          number: node.number,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          author: node.author ?? undefined,
          labels: node.labels?.nodes ?? [],
          commentsCount: node.comments?.totalCount ?? 0,
          assignees: node.assignees?.nodes ?? [],
        });
      }
      if (!data.search.pageInfo.hasNextPage) break;
      cursor = data.search.pageInfo.endCursor;
      if (!cursor) break;
    }
    return collected;
  }

  async listPullRequests(account: Account, owners: string[]): Promise<GhPullRequest[]> {
    if (!owners.length) return [];
    const q = `is:pr is:open ${owners.map((owner) => `user:${owner}`).join(" ")}`.trim();
    const collected: GhPullRequest[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const data: PullRequestSearchResponse = await this.gqlCall<PullRequestSearchResponse>(account, PR_SEARCH_QUERY, { q, cursor });
      for (const raw of data.search.nodes) {
        if (raw.__typename !== "PullRequest") continue;
        const node = raw as PullRequestSearchNode;
        collected.push({
          repository: node.repository,
          title: node.title,
          url: node.url,
          number: node.number,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          author: node.author ?? undefined,
          labels: node.labels?.nodes ?? [],
          commentsCount: node.comments?.totalCount ?? 0,
          assignees: node.assignees?.nodes ?? [],
          isDraft: node.isDraft,
          reviewDecision: node.reviewDecision,
          reviewsCount: node.reviews?.totalCount ?? 0,
          additions: node.additions,
          deletions: node.deletions,
          changedFiles: node.changedFiles,
          baseRefName: node.baseRefName,
          headRefName: node.headRefName,
        });
      }
      if (!data.search.pageInfo.hasNextPage) break;
      cursor = data.search.pageInfo.endCursor;
      if (!cursor) break;
    }
    return collected;
  }

  async fetchNotifications(account: Account, ifModifiedSince: string | null): Promise<NotificationsFetchOutcome> {
    const initial = `${this.config.baseUrl}/notifications?all=true&participating=false&per_page=50`;
    const collected: GhNotification[] = [];
    let url: string | null = initial;
    let firstLastModified: string | null = null;
    let firstPollInterval = 60;
    let firstStatus = 0;
    let pages = 0;
    while (url && pages < 5) {
      const headers = this.restHeaders(account, pages === 0 && ifModifiedSince ? { "If-Modified-Since": ifModifiedSince } : undefined);
      const response = await fetch(url, { headers });
      if (response.status === 401) return { ok: false, error: "authentication required", needsAuth: true };
      const lastModified = response.headers.get("last-modified");
      const intervalHeader = response.headers.get("x-poll-interval");
      const pollInterval = intervalHeader ? Math.max(1, Number(intervalHeader)) : 60;
      if (pages === 0) {
        firstLastModified = lastModified;
        firstPollInterval = pollInterval;
        firstStatus = response.status;
        if (response.status === 304) {
          return { ok: true, refreshed: false, notifications: [], lastModified: firstLastModified, pollInterval: firstPollInterval };
        }
      }
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: text || `HTTP ${response.status}` };
      }
      const raw = (await response.json()) as RawGitHubNotification[];
      for (const entry of raw) collected.push(normalizeGitHubNotification(entry));
      const link = response.headers.get("link");
      url = parseNextLink(link);
      pages += 1;
    }
    return {
      ok: true,
      refreshed: firstStatus !== 304,
      notifications: collected,
      lastModified: firstLastModified,
      pollInterval: firstPollInterval,
    };
  }

  async markNotificationRead(account: Account, threadId: string): Promise<NotificationMutationOutcome> {
    return this.notificationMutate(account, "PATCH", `/notifications/threads/${encodeURIComponent(threadId)}`);
  }

  async markAllNotificationsRead(account: Account, options: { repo?: string | null; lastReadAt?: string | null }): Promise<NotificationMutationOutcome> {
    const lastReadAt = options.lastReadAt ?? new Date().toISOString();
    const path = options.repo ? `/repos/${options.repo}/notifications` : "/notifications";
    return this.notificationMutate(account, "PUT", path, { last_read_at: lastReadAt, read: true });
  }

  private async notificationMutate(account: Account, method: "PATCH" | "PUT", path: string, body?: unknown): Promise<NotificationMutationOutcome> {
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: this.restHeaders(account, body ? { "Content-Type": "application/json" } : undefined),
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401) return { ok: false, status: 401, error: "authentication required", needsAuth: true };
      if (!response.ok && response.status !== 205) {
        const text = await response.text();
        return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
      }
      return { ok: true, status: response.status };
    } catch (error) {
      return { ok: false, status: 500, error: (error as Error).message || String(error) };
    }
  }

  avatarUrl(login: string, size = 64): string {
    return `${this.config.webUrl}/${encodeURIComponent(login)}.png?size=${size}`;
  }

  webUrlFor(
    kind: "user" | "repo" | "issue" | "pr",
    parts: Record<string, string | number>,
  ): string {
    const base = this.config.webUrl;
    switch (kind) {
      case "user":
        return `${base}/${parts.login}`;
      case "repo":
        return `${base}/${parts.owner}/${parts.repo}`;
      case "issue":
        return `${base}/${parts.owner}/${parts.repo}/issues/${parts.number}`;
      case "pr":
        return `${base}/${parts.owner}/${parts.repo}/pull/${parts.number}`;
    }
  }
}

export class GitHubAuthRequiredError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "GitHubAuthRequiredError";
  }
}

const REPO_LIST_QUERY = `
query($owner: String!, $cursor: String) {
  repositoryOwner(login: $owner) {
    repositories(first: 100, after: $cursor, ownerAffiliations: [OWNER]) {
      pageInfo { endCursor hasNextPage }
      nodes {
        nameWithOwner name
        owner { login avatarUrl }
        description stargazerCount forkCount
        primaryLanguage { name }
        updatedAt pushedAt
        visibility
        isPrivate isArchived isFork isTemplate viewerPermission url
      }
    }
  }
}`;

const ISSUE_SEARCH_QUERY = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo { endCursor hasNextPage }
    nodes {
      __typename
      ... on Issue {
        number title url createdAt updatedAt
        author { login url avatarUrl }
        repository { name nameWithOwner }
        labels(first: 20) { nodes { name color description } }
        comments { totalCount }
        assignees(first: 10) { nodes { login url avatarUrl } }
      }
    }
  }
}`;

const PR_SEARCH_QUERY = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo { endCursor hasNextPage }
    nodes {
      __typename
      ... on PullRequest {
        number title url createdAt updatedAt
        isDraft reviewDecision
        author { login url avatarUrl }
        repository { name nameWithOwner }
        labels(first: 20) { nodes { name color description } }
        comments { totalCount }
        reviews { totalCount }
        assignees(first: 10) { nodes { login url avatarUrl } }
        additions deletions changedFiles
        baseRefName headRefName
      }
    }
  }
}`;

interface IssueSearchNode {
  __typename: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string; url: string; avatarUrl?: string } | null;
  repository: { name: string; nameWithOwner: string };
  labels: { nodes: GhLabel[] };
  comments: { totalCount: number };
  assignees: { nodes: GhUser[] };
}

interface IssueSearchResponse {
  search: {
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
    nodes: (IssueSearchNode | { __typename: string })[];
  };
}

interface PullRequestSearchNode {
  __typename: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  author: { login: string; url: string; avatarUrl?: string } | null;
  repository: { name: string; nameWithOwner: string };
  labels: { nodes: GhLabel[] };
  comments: { totalCount: number };
  reviews: { totalCount: number };
  assignees: { nodes: GhUser[] };
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRefName: string;
  headRefName: string;
}

interface PullRequestSearchResponse {
  search: {
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
    nodes: (PullRequestSearchNode | { __typename: string })[];
  };
}

interface RepoNode {
  nameWithOwner: string;
  name: string;
  owner: { login: string; avatarUrl?: string };
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string } | null;
  updatedAt: string;
  pushedAt: string;
  visibility: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  isTemplate: boolean;
  viewerPermission: string | null;
  url: string;
}

interface RepoListResponse {
  repositoryOwner: {
    repositories: {
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      nodes: RepoNode[];
    };
  } | null;
}

interface RawGitHubNotification {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  last_read_at: string | null;
  subject: { title: string; url: string | null; latest_comment_url: string | null; type: string };
  repository: { name: string; full_name: string; private: boolean; html_url: string };
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

const SUBJECT_NUMBER_PATTERN = /\/(?:issues|pulls)\/(\d+)$/;

function normalizeGitHubNotification(raw: RawGitHubNotification): GhNotification {
  const itemNumber = (() => {
    if (!raw.subject?.url) return null;
    const match = SUBJECT_NUMBER_PATTERN.exec(raw.subject.url);
    return match ? Number(match[1]) : null;
  })();
  const repoHtml = raw.repository?.html_url ?? "";
  const subjectType = raw.subject?.type ?? "";
  let itemHtmlUrl: string | null = null;
  if (itemNumber && raw.subject?.url) {
    if (subjectType === "PullRequest") itemHtmlUrl = `${repoHtml}/pull/${itemNumber}`;
    else if (subjectType === "Issue") itemHtmlUrl = `${repoHtml}/issues/${itemNumber}`;
  }
  return {
    id: raw.id,
    unread: Boolean(raw.unread),
    reason: raw.reason as GhNotificationReason,
    updatedAt: raw.updated_at,
    lastReadAt: raw.last_read_at,
    subject: {
      title: raw.subject?.title ?? "",
      url: raw.subject?.url ?? null,
      latestCommentUrl: raw.subject?.latest_comment_url ?? null,
      type: subjectType,
    },
    repository: {
      name: raw.repository?.name ?? "",
      nameWithOwner: raw.repository?.full_name ?? "",
      private: Boolean(raw.repository?.private),
      htmlUrl: repoHtml,
    },
    itemNumber,
    itemHtmlUrl,
  };
}
