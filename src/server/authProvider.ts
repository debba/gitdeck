import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getActive as getActiveAccountFromStore, init as initAccountStore } from "./accountStore";
import type { Account } from "./providers/types";

const execFileAsync = promisify(execFile);
const USER_URL = "https://api.github.com/user";

export type AuthMode = "device" | "gh-cli" | "token";

export interface ProviderStatus {
  authenticated: boolean;
  login: string | null;
  scope: string | null;
  detail?: string | null;
}

interface CachedToken {
  token: string;
  login: string | null;
  scope: string | null;
  fetchedAt: number;
}

const GH_CACHE_TTL_MS = 60_000;
let ghCache: CachedToken | null = null;
let envCache: CachedToken | null = null;

export function getAuthMode(): AuthMode {
  const raw = (
    process.env.GH_AUTH_MODE ??
    process.env.GITHUB_AUTH_MODE ??
    process.env.GITHUB_MODE ??
    ""
  )
    .trim()
    .toLowerCase();
  if (raw === "gh-cli" || raw === "gh" || raw === "ghcli") return "gh-cli";
  if (raw === "token" || raw === "env" || raw === "pat") return "token";
  return "device";
}

async function fetchLogin(token: string): Promise<{ login: string | null; scope: string | null }> {
  try {
    const response = await fetch(USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "gitdeck",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return { login: null, scope: response.headers.get("x-oauth-scopes") };
    const data = (await response.json()) as { login?: string };
    return {
      login: data.login ?? null,
      scope: response.headers.get("x-oauth-scopes"),
    };
  } catch {
    return { login: null, scope: null };
  }
}

async function loadGhCliToken(): Promise<CachedToken> {
  if (ghCache && Date.now() - ghCache.fetchedAt < GH_CACHE_TTL_MS) return ghCache;
  let stdout: string;
  try {
    const result = await execFileAsync("gh", ["auth", "token"], { timeout: 5000 });
    stdout = result.stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new Error("gh CLI is not installed. Install it from https://cli.github.com/ or switch GH_AUTH_MODE.");
    }
    const detail = err.stderr?.trim() || err.message;
    throw new Error(`gh auth token failed: ${detail}. Run 'gh auth login' first.`);
  }
  const token = stdout.trim();
  if (!token) throw new Error("gh auth token returned an empty token. Run 'gh auth login' first.");
  const { login, scope } = await fetchLogin(token);
  ghCache = { token, login, scope, fetchedAt: Date.now() };
  return ghCache;
}

async function loadEnvToken(): Promise<CachedToken> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set. Export a personal access token or switch GH_AUTH_MODE.");
  }
  if (envCache && envCache.token === token && Date.now() - envCache.fetchedAt < GH_CACHE_TTL_MS) {
    return envCache;
  }
  const { login, scope } = await fetchLogin(token);
  envCache = { token, login, scope, fetchedAt: Date.now() };
  return envCache;
}

export interface ExternalAccountDraft {
  token: string;
  login: string | null;
  scope: string | null;
  source: "env" | "gh-cli";
}

/**
 * Resolve an external account draft for the current auth mode.
 *
 * In `token` and `gh-cli` modes the credential lives outside the on-disk
 * account store (env var / gh CLI), so the store is never populated and the
 * data layer has no active account to resolve. This exposes the external
 * credential as a draft the account store can seed as an ephemeral account.
 *
 * Returns `null` in `device` mode, or when no external token is available
 * (the status endpoint surfaces the underlying error separately).
 */
export async function loadExternalAccountDraft(): Promise<ExternalAccountDraft | null> {
  const mode = getAuthMode();
  try {
    if (mode === "token") {
      const cached = await loadEnvToken();
      return { token: cached.token, login: cached.login, scope: cached.scope, source: "env" };
    }
    if (mode === "gh-cli") {
      const cached = await loadGhCliToken();
      return { token: cached.token, login: cached.login, scope: cached.scope, source: "gh-cli" };
    }
  } catch {
    return null;
  }
  return null;
}

export async function getActiveAccount(): Promise<Account | null> {
  await initAccountStore();
  return getActiveAccountFromStore();
}

export async function getActiveToken(): Promise<string | null> {
  const mode = getAuthMode();
  if (mode === "gh-cli") {
    const cached = await loadGhCliToken();
    return cached.token;
  }
  if (mode === "token") {
    const cached = await loadEnvToken();
    return cached.token;
  }
  const account = await getActiveAccount();
  return account?.accessToken ?? null;
}

export async function getProviderStatus(): Promise<ProviderStatus> {
  const mode = getAuthMode();
  if (mode === "gh-cli") {
    try {
      const cached = await loadGhCliToken();
      return { authenticated: true, login: cached.login, scope: cached.scope };
    } catch (error) {
      return { authenticated: false, login: null, scope: null, detail: (error as Error).message };
    }
  }
  if (mode === "token") {
    try {
      const cached = await loadEnvToken();
      return { authenticated: true, login: cached.login, scope: cached.scope };
    } catch (error) {
      return { authenticated: false, login: null, scope: null, detail: (error as Error).message };
    }
  }
  const account = await getActiveAccount();
  if (!account) return { authenticated: false, login: null, scope: null };
  return { authenticated: true, login: account.login ?? null, scope: account.scope ?? null };
}

export function resetExternalAuthCaches(): void {
  ghCache = null;
  envCache = null;
}
