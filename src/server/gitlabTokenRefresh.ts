import { update } from "./accountStore";
import type { Account, ProviderConfig } from "./providers/types";

export async function refreshGitLabTokenIfNeeded(account: Account, config: ProviderConfig): Promise<void> {
  if (!account.refreshToken || !account.expiresAt) return;
  if (Date.parse(account.expiresAt) - Date.now() > 60_000) return;

  const clientId = process.env.GITLAB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITLAB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("GitLab OAuth credentials are no longer configured");

  const response = await fetch(`${config.webUrl}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
  });
  const text = await response.text();
  let data: { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string } = {};
  try { data = JSON.parse(text) as typeof data; } catch { /* handled below */ }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || text || `GitLab token refresh failed: HTTP ${response.status}`);
  }

  account.accessToken = data.access_token;
  account.refreshToken = data.refresh_token ?? account.refreshToken;
  account.expiresAt = new Date(Date.now() + (data.expires_in ?? 7200) * 1000).toISOString();
  await update(account.id, {
    accessToken: account.accessToken,
    refreshToken: account.refreshToken,
    expiresAt: account.expiresAt,
  });
}
