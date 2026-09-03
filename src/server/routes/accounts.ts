import { buildGitLabInstanceConfig } from "../../utils/gitlab";
import {
  add as addAccount,
  getActive as getActiveAccount,
  getProviderConfig,
  init as initAccountStore,
  list as listAccountsStore,
  listProviderConfigs,
  remove as removeAccountStore,
  setActive as setActiveAccount,
  upsertProviderConfig,
} from "../accountStore";
import { invalidateCIHealthCache } from "../ciHealth";
import { invalidateDataCache } from "../dashboardData";
import { gitLabOAuthInstanceUrl, isGitLabOAuthConfigured } from "../gitlabOAuth";
import { parseJsonBody, sendJson } from "../http";
import { invalidateNotificationsCache } from "../notifications";
import { getProviderMetrics } from "../providerDiagnostics";
import { GitLabProvider } from "../providers/gitlab";
import { getProvider, getProviderForAccount, resetProviderCache } from "../providers/registry";
import type { AppRouter, RouteContext } from "../router";
import { sendError } from "./shared";

type StoredAccount = NonNullable<Awaited<ReturnType<typeof getActiveAccount>>>;

interface AccountSummary {
  id: string;
  providerKind: string;
  providerConfigId: string;
  label: string;
  login: string | null;
  scope: string;
  source: string;
  ephemeral: boolean;
  active: boolean;
  capabilities: Record<string, boolean>;
}

/** Every account mutation invalidates the per-account caches. */
function invalidateAccountCaches(): void {
  invalidateDataCache();
  invalidateNotificationsCache();
  invalidateCIHealthCache();
}

async function summariseAccount(account: StoredAccount, activeId: string | null): Promise<AccountSummary> {
  let capabilities: Record<string, boolean> = {};
  try {
    const provider = await getProviderForAccount(account);
    capabilities = { ...provider.capabilities };
  } catch {
    // Unknown provider kind: return empty caps; the UI treats them conservatively.
  }
  return {
    id: account.id,
    providerKind: account.providerKind,
    providerConfigId: account.providerConfigId,
    label: account.label,
    login: account.login,
    scope: account.scope,
    source: account.source,
    ephemeral: Boolean(account.ephemeral),
    active: account.id === activeId,
    capabilities,
  };
}

async function list(ctx: RouteContext): Promise<void> {
  await initAccountStore();
  const all = await listAccountsStore();
  const active = await getActiveAccount();
  const activeId = active?.id ?? null;
  const accounts = await Promise.all(all.map((account) => summariseAccount(account, activeId)));
  sendJson(ctx.res, 200, { ok: true, accounts, activeId });
}

async function activate(ctx: RouteContext): Promise<void> {
  const parsed = await parseJsonBody<{ id?: string }>(ctx.req, ctx.res);
  if (!parsed) return;
  const id = (parsed.id || "").trim();
  if (!id) return sendJson(ctx.res, 400, { ok: false, error: "missing id" });
  await initAccountStore();
  const account = await setActiveAccount(id);
  if (!account) return sendJson(ctx.res, 404, { ok: false, error: "account not found" });
  invalidateAccountCaches();
  sendJson(ctx.res, 200, { ok: true, activeId: account.id });
}

async function remove(ctx: RouteContext): Promise<void> {
  const id = (ctx.url.searchParams.get("id") || "").trim();
  if (!id) return sendJson(ctx.res, 400, { ok: false, error: "missing id" });
  await initAccountStore();
  const existed = await removeAccountStore(id);
  if (!existed) return sendJson(ctx.res, 404, { ok: false, error: "account not found" });
  invalidateAccountCaches();
  sendJson(ctx.res, 200, { ok: true });
}

interface AddTokenBody {
  providerConfigId?: string;
  instanceUrl?: string;
  token?: string;
  label?: string;
}

async function addToken(ctx: RouteContext): Promise<void> {
  const parsed = await parseJsonBody<AddTokenBody>(ctx.req, ctx.res);
  if (!parsed) return;
  let providerConfigId = (parsed.providerConfigId || "").trim();
  const instanceUrl = (parsed.instanceUrl || "").trim();
  const token = (parsed.token || "").trim();
  if (!providerConfigId && !instanceUrl) {
    return sendJson(ctx.res, 400, { ok: false, error: "missing providerConfigId or instanceUrl" });
  }
  if (!token) return sendJson(ctx.res, 400, { ok: false, error: "missing token" });
  await initAccountStore();

  let config;
  let identity;
  try {
    if (instanceUrl) {
      config = buildGitLabInstanceConfig(instanceUrl);
      providerConfigId = config.id;
      identity = await new GitLabProvider(config).fetchIdentity(token);
      await upsertProviderConfig(config);
      resetProviderCache();
    } else {
      config = await getProviderConfig(providerConfigId);
      if (!config) return sendJson(ctx.res, 404, { ok: false, error: "unknown providerConfigId" });
      const provider = await getProvider(providerConfigId);
      identity = await provider.fetchIdentity(token);
    }
  } catch (error) {
    return sendError(ctx, error, 400);
  }
  if (!identity.login) return sendJson(ctx.res, 400, { ok: false, error: "provider did not return a login" });

  const safeLogin = identity.login.replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = config.kind === "github" ? "gh" : config.kind === "forgejo" ? "fj" : "gl";
  const webHost = new URL(config.webUrl).host;
  const account = await addAccount({
    id: `${prefix}_${safeLogin}_${providerConfigId}`,
    providerKind: config.kind,
    providerConfigId,
    label: parsed.label?.trim() || `${identity.login} (${webHost})`,
    login: identity.login,
    accessToken: token,
    scope: identity.scope ?? "",
    obtainedAt: new Date().toISOString(),
    source: "token",
  });
  invalidateAccountCaches();
  sendJson(ctx.res, 200, { ok: true, accountId: account.id });
}

async function providerConfigs(ctx: RouteContext): Promise<void> {
  await initAccountStore();
  const configs = await listProviderConfigs();
  const gitLabOAuth = isGitLabOAuthConfigured();
  const summaries = Object.values(configs)
    .filter((cfg) => cfg.kind !== "gitlab" || cfg.id === "gitlab.com")
    .map((cfg) => ({
      id: cfg.id,
      kind: cfg.kind,
      label: cfg.label,
      webUrl: cfg.webUrl,
      tokenSettingsUrl: cfg.kind === "gitlab"
        ? `${cfg.webUrl}/-/user_settings/personal_access_tokens`
        : `${cfg.webUrl}/user/settings/applications`,
      supportsDeviceFlow: Boolean(cfg.oauthDeviceCodeUrl) && cfg.kind === "github",
      supportsOAuth: cfg.kind === "gitlab" && gitLabOAuth,
      oauthInstanceUrl: cfg.kind === "gitlab" && gitLabOAuth ? gitLabOAuthInstanceUrl() : null,
    }));
  sendJson(ctx.res, 200, { ok: true, configs: summaries });
}

export function registerAccountRoutes(router: AppRouter): void {
  router.get("/api/accounts", list);
  router.delete("/api/accounts", remove);
  router.post("/api/accounts/activate", activate);
  router.post("/api/accounts/add-token", addToken);
  router.get("/api/provider-configs", providerConfigs);
  router.get("/api/diagnostics/provider-metrics", ({ res }) => sendJson(res, 200, getProviderMetrics()));
}
