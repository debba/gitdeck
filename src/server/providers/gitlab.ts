import type { GhIssue, GhPullRequest, GhRepo } from "../../types/github";
import { refreshGitLabTokenIfNeeded } from "../gitlabTokenRefresh";
import {
  fetchGitLabIssues,
  fetchGitLabMergeRequests,
  fetchGitLabOwners,
  fetchGitLabRepos,
  fetchGitLabTodos,
  markAllGitLabTodosRead,
  markGitLabTodoRead,
} from "./gitlabData";
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

const CAPABILITIES: ProviderCapabilities = {
  graphql: false,
  notifications: true,
  projects: false,
  ciWorkflows: false,
  codeSearch: false,
  dependents: false,
  traffic: false,
  stargazerHistory: false,
};

export class GitLabProvider implements Provider {
  readonly kind = "gitlab" as const;
  readonly capabilities = CAPABILITIES;

  constructor(readonly config: ProviderConfig) {}

  async startDeviceFlow(): Promise<DeviceFlowStart> {
    throw new Error(`Device flow is not enabled for ${this.config.id}. Add a personal access token instead.`);
  }

  async pollDeviceFlow(): Promise<DeviceFlowPoll> {
    return { status: "error", error: "device flow not supported" };
  }

  async fetchIdentity(token: string): Promise<ProviderIdentity> {
    const response = await fetch(`${this.config.baseUrl}/user`, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.config.userAgent,
        "PRIVATE-TOKEN": token,
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Identity lookup failed: ${text || `HTTP ${response.status}`}`);
    const data = JSON.parse(text) as { username?: string; avatar_url?: string; web_url?: string };
    if (!data.username) throw new Error("GitLab /user response missing username");
    return {
      login: data.username,
      scope: null,
      avatarUrl: data.avatar_url ?? null,
      htmlUrl: data.web_url ?? null,
    };
  }

  private async refreshToken(account: Account): Promise<void> {
    await refreshGitLabTokenIfNeeded(account, this.config);
  }

  async listOwners(account: Account): Promise<OwnersOutcome> {
    await this.refreshToken(account);
    return fetchGitLabOwners(account, this.config);
  }

  async listRepos(account: Account, _owners: string[]): Promise<GhRepo[]> {
    await this.refreshToken(account);
    return fetchGitLabRepos(account, this.config);
  }

  async listIssues(account: Account, _owners: string[]): Promise<GhIssue[]> {
    await this.refreshToken(account);
    return fetchGitLabIssues(account, this.config);
  }

  async listPullRequests(account: Account, _owners: string[]): Promise<GhPullRequest[]> {
    await this.refreshToken(account);
    return fetchGitLabMergeRequests(account, this.config);
  }

  async fetchNotifications(account: Account, _ifModifiedSince: string | null): Promise<NotificationsFetchOutcome> {
    await this.refreshToken(account);
    return fetchGitLabTodos(account, this.config);
  }

  async markNotificationRead(account: Account, threadId: string): Promise<NotificationMutationOutcome> {
    await this.refreshToken(account);
    return markGitLabTodoRead(account, this.config, threadId);
  }

  async markAllNotificationsRead(account: Account): Promise<NotificationMutationOutcome> {
    await this.refreshToken(account);
    return markAllGitLabTodosRead(account, this.config);
  }

  avatarUrl(login: string): string {
    return `${this.config.webUrl}/${encodeURIComponent(login)}.png`;
  }

  webUrlFor(kind: "user" | "repo" | "issue" | "pr", parts: Record<string, string | number>): string {
    const base = this.config.webUrl;
    switch (kind) {
      case "user": return `${base}/${parts.login}`;
      case "repo": return `${base}/${parts.owner}/${parts.repo}`;
      case "issue": return `${base}/${parts.owner}/${parts.repo}/-/issues/${parts.number}`;
      case "pr": return `${base}/${parts.owner}/${parts.repo}/-/merge_requests/${parts.number}`;
    }
  }
}
