import type {
  GhIssue,
  GhPullRequest,
  GhRepo,
} from "../../types/github";
import { readUpstreamJson } from "../upstream";
import {
  fetchForgejoIssues,
  fetchForgejoNotifications,
  fetchForgejoOwners,
  fetchForgejoPullRequests,
  fetchForgejoRepos,
  markForgejoAllRead,
  markForgejoThreadRead,
} from "./forgejoData";
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

export class ForgejoProvider implements Provider {
  readonly kind = "forgejo" as const;
  readonly capabilities = CAPABILITIES;

  constructor(readonly config: ProviderConfig) {}

  async startDeviceFlow(): Promise<DeviceFlowStart> {
    throw new Error(
      `Device flow is not enabled for ${this.config.id}. Add a personal access token instead.`,
    );
  }

  async pollDeviceFlow(): Promise<DeviceFlowPoll> {
    return { status: "error", error: "device flow not supported" };
  }

  async fetchIdentity(token: string): Promise<ProviderIdentity> {
    const response = await fetch(`${this.config.baseUrl}/user`, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.config.userAgent,
        Authorization: `token ${token}`,
      },
    });
    const identity = await readUpstreamJson<{
      login?: string;
      username?: string;
      avatar_url?: string;
      html_url?: string;
    } | null>(this.config.label, response);
    if (!identity.ok) throw new Error(`Identity lookup failed: ${identity.error}`);
    const data = identity.data ?? {};
    const login = data.login ?? data.username ?? "";
    if (!login) throw new Error("Forgejo /user response missing login");
    return {
      login,
      scope: null,
      avatarUrl: data.avatar_url ?? null,
      htmlUrl: data.html_url ?? null,
    };
  }

  async listOwners(account: Account): Promise<OwnersOutcome> {
    return fetchForgejoOwners(account);
  }

  async listRepos(account: Account, owners: string[]): Promise<GhRepo[]> {
    return fetchForgejoRepos(account, owners);
  }

  async listIssues(account: Account, owners: string[]): Promise<GhIssue[]> {
    return fetchForgejoIssues(account, owners);
  }

  async listPullRequests(account: Account, owners: string[]): Promise<GhPullRequest[]> {
    return fetchForgejoPullRequests(account, owners);
  }

  async fetchNotifications(account: Account, ifModifiedSince: string | null): Promise<NotificationsFetchOutcome> {
    const result = await fetchForgejoNotifications(account, ifModifiedSince);
    if ("error" in result) return { ok: false, error: result.error, needsAuth: result.needsAuth };
    return {
      ok: true,
      refreshed: result.refreshed,
      notifications: result.notifications,
      lastModified: result.lastModified,
      pollInterval: result.pollInterval,
    };
  }

  async markNotificationRead(account: Account, threadId: string): Promise<NotificationMutationOutcome> {
    const result = await markForgejoThreadRead(account, threadId);
    if (result.ok) return { ok: true, status: result.status };
    return { ok: false, status: result.status, error: result.error, needsAuth: result.needsAuth };
  }

  async markAllNotificationsRead(account: Account, options: { repo?: string | null; lastReadAt?: string | null }): Promise<NotificationMutationOutcome> {
    const result = await markForgejoAllRead(account, options);
    if (result.ok) return { ok: true, status: result.status };
    return { ok: false, status: result.status, error: result.error, needsAuth: result.needsAuth };
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
        return `${base}/${parts.owner}/${parts.repo}/pulls/${parts.number}`;
    }
  }
}
