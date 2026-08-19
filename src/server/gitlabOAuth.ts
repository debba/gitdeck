import { randomBytes } from "node:crypto";
import { add, setActive, upsertProviderConfig } from "./accountStore";
import { GitLabProvider } from "./providers/gitlab";
import { resetProviderCache } from "./providers/registry";
import { buildGitLabInstanceConfig } from "../utils/gitlab";

interface PendingGitLabOAuth {
  state: string;
  config: ReturnType<typeof buildGitLabInstanceConfig>;
  redirectUri: string;
  expiresAt: number;
}

let pending: PendingGitLabOAuth | null = null;

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GITLAB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITLAB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GitLab OAuth requires GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

export function isGitLabOAuthConfigured(): boolean {
  return Boolean(process.env.GITLAB_CLIENT_ID?.trim() && process.env.GITLAB_CLIENT_SECRET?.trim());
}

export function gitLabOAuthInstanceUrl(): string {
  return buildGitLabInstanceConfig(process.env.GITLAB_OAUTH_INSTANCE_URL?.trim() || "https://gitlab.com").webUrl;
}

export function startGitLabOAuth(instanceUrl: string, redirectUri: string): string {
  const { clientId } = credentials();
  const config = buildGitLabInstanceConfig(instanceUrl);
  if (config.webUrl !== gitLabOAuthInstanceUrl()) {
    throw new Error(`GitLab OAuth is configured for ${gitLabOAuthInstanceUrl()}; use a personal access token for this instance`);
  }
  const state = randomBytes(24).toString("base64url");
  pending = { state, config, redirectUri, expiresAt: Date.now() + 10 * 60_000 };

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope: "api read_user read_repository",
  });
  return `${config.webUrl}/oauth/authorize?${query.toString()}`;
}

export async function finishGitLabOAuth(code: string, state: string): Promise<void> {
  const flow = pending;
  pending = null;
  if (!flow || flow.state !== state || Date.now() >= flow.expiresAt) {
    throw new Error("Invalid or expired GitLab OAuth state");
  }
  const { clientId, clientSecret } = credentials();
  const response = await fetch(`${flow.config.webUrl}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: flow.redirectUri,
    }),
  });
  const text = await response.text();
  let data: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string } = {};
  try { data = JSON.parse(text) as typeof data; } catch { /* invalid response handled below */ }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || text || `GitLab OAuth failed: HTTP ${response.status}`);
  }

  const provider = new GitLabProvider(flow.config);
  const identity = await provider.fetchIdentity(data.access_token);
  const safeLogin = identity.login.replace(/[^a-zA-Z0-9_-]/g, "_");
  await upsertProviderConfig(flow.config);
  resetProviderCache();
  const account = await add({
    id: `gl_${safeLogin}_${flow.config.id}`,
    providerKind: "gitlab",
    providerConfigId: flow.config.id,
    label: `${identity.login} (${new URL(flow.config.webUrl).host})`,
    login: identity.login,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString(),
    scope: data.scope ?? "",
    obtainedAt: new Date().toISOString(),
    source: "oauth",
  });
  await setActive(account.id);
}

export function resetGitLabOAuthForTesting(): void {
  pending = null;
}
