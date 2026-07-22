import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadExternalAccountDraft } from "./authProvider";
import { DATA_DIR, LEGACY_DATA_DIR } from "./config";
import type { Account, AccountStoreData, ProviderConfig } from "./providers/types";

// Stable id for the ephemeral account synthesised from an external credential
// (env token / gh CLI) in non-device auth modes.
const EXTERNAL_ACCOUNT_ID = "external";

const ACCOUNTS_PATH = resolve(DATA_DIR, "accounts.json");
const ACCOUNTS_TMP_PATH = resolve(DATA_DIR, "accounts.json.tmp");
const LEGACY_TOKEN_PATH = resolve(DATA_DIR, "auth.json");
const LEGACY_BACKUP_PATH = resolve(DATA_DIR, "auth.json.legacy.bak");

const DEFAULT_PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  "github.com": {
    id: "github.com",
    kind: "github",
    label: "GitHub",
    baseUrl: "https://api.github.com",
    webUrl: "https://github.com",
    graphqlUrl: "https://api.github.com/graphql",
    oauthAuthorizeUrl: "https://github.com/login/oauth/authorize",
    oauthDeviceCodeUrl: "https://github.com/login/device/code",
    oauthTokenUrl: "https://github.com/login/oauth/access_token",
    oauthScopes: "repo read:org project read:user user:email",
    userAgent: "gitdeck",
  },
  "codeberg.org": {
    id: "codeberg.org",
    kind: "forgejo",
    label: "Codeberg",
    baseUrl: "https://codeberg.org/api/v1",
    webUrl: "https://codeberg.org",
    oauthAuthorizeUrl: "https://codeberg.org/login/oauth/authorize",
    oauthTokenUrl: "https://codeberg.org/login/oauth/access_token",
    oauthScopes: "read:repository read:notification read:user",
    userAgent: "gitdeck",
  },
};

interface InternalState {
  persisted: AccountStoreData;
  ephemeral: Account[];
}

let state: InternalState | null = null;
let initPromise: Promise<void> | null = null;

function emptyData(): AccountStoreData {
  return {
    version: 1,
    activeId: null,
    accounts: [],
    providerConfigs: { ...DEFAULT_PROVIDER_CONFIGS },
  };
}

function mergeProviderConfigs(
  configs: Record<string, ProviderConfig> | undefined,
): Record<string, ProviderConfig> {
  return { ...DEFAULT_PROVIDER_CONFIGS, ...(configs ?? {}) };
}

async function readAccountsFile(): Promise<AccountStoreData | null> {
  try {
    const raw = await readFile(ACCOUNTS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as AccountStoreData;
    if (parsed?.version !== 1 || !Array.isArray(parsed.accounts)) return null;
    parsed.providerConfigs = mergeProviderConfigs(parsed.providerConfigs);
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

interface LegacyToken {
  accessToken: string;
  scope?: string;
  obtainedAt?: string;
  login?: string;
}

async function readLegacyToken(): Promise<LegacyToken | null> {
  try {
    const raw = await readFile(LEGACY_TOKEN_PATH, "utf-8");
    const parsed = JSON.parse(raw) as LegacyToken;
    if (!parsed?.accessToken) return null;
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

function migrateLegacy(legacy: LegacyToken): AccountStoreData {
  const data = emptyData();
  const loginSlug = (legacy.login ?? "legacy").replace(/[^a-zA-Z0-9_-]/g, "_");
  const account: Account = {
    id: `gh_${loginSlug}`,
    providerKind: "github",
    providerConfigId: "github.com",
    label: legacy.login ? `${legacy.login} (github.com)` : "GitHub",
    login: legacy.login ?? null,
    accessToken: legacy.accessToken,
    scope: legacy.scope ?? "",
    obtainedAt: legacy.obtainedAt ?? new Date().toISOString(),
    source: "device",
  };
  data.accounts.push(account);
  data.activeId = account.id;
  return data;
}

async function writePersisted(data: AccountStoreData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2);
  await writeFile(ACCOUNTS_TMP_PATH, payload, { mode: 0o600 });
  await rename(ACCOUNTS_TMP_PATH, ACCOUNTS_PATH);
}

async function backupLegacy(): Promise<void> {
  try {
    await rename(LEGACY_TOKEN_PATH, LEGACY_BACKUP_PATH);
  } catch {
    // best-effort
  }
}

async function migrateLegacyDataDir(): Promise<void> {
  if (DATA_DIR === LEGACY_DATA_DIR) return;
  try {
    await access(DATA_DIR);
    return;
  } catch {
    // new dir absent — check legacy
  }
  try {
    await access(LEGACY_DATA_DIR);
  } catch {
    return;
  }
  try {
    await rename(LEGACY_DATA_DIR, DATA_DIR);
  } catch {
    // best-effort: leave legacy in place if rename fails
  }
}

async function doInit(): Promise<void> {
  await migrateLegacyDataDir();
  const existing = await readAccountsFile();
  if (existing) {
    state = { persisted: existing, ephemeral: [] };
    return;
  }
  const legacy = await readLegacyToken();
  if (legacy) {
    const migrated = migrateLegacy(legacy);
    await writePersisted(migrated);
    await backupLegacy();
    state = { persisted: migrated, ephemeral: [] };
    return;
  }
  state = { persisted: emptyData(), ephemeral: [] };
}

export async function init(): Promise<void> {
  if (state) return;
  if (!initPromise) {
    initPromise = doInit().finally(() => {
      initPromise = null;
    });
  }
  await initPromise;
}

async function ensureState(): Promise<InternalState> {
  if (!state) await init();
  if (!state) throw new Error("accountStore failed to initialise");
  return state;
}

/**
 * Seed (or refresh) the ephemeral external account from the current auth mode.
 *
 * In `token` / `gh-cli` modes the credential never reaches the on-disk store,
 * so without this the store stays empty and every data endpoint returns 401
 * even though `/api/auth/status` reports the token as authenticated. In
 * `device` mode (or when the external token is gone) this is a no-op that also
 * drops any previously-seeded external account.
 */
async function ensureExternalAccount(s: InternalState): Promise<void> {
  const draft = await loadExternalAccountDraft();
  if (!draft) {
    s.ephemeral = s.ephemeral.filter((account) => account.id !== EXTERNAL_ACCOUNT_ID);
    return;
  }
  const existing = s.ephemeral.find((account) => account.id === EXTERNAL_ACCOUNT_ID);
  const account: Account = {
    id: EXTERNAL_ACCOUNT_ID,
    providerKind: "github",
    providerConfigId: "github.com",
    label: draft.login ? `${draft.login} (${draft.source})` : `GitHub (${draft.source})`,
    login: draft.login,
    accessToken: draft.token,
    scope: draft.scope ?? "",
    obtainedAt: existing?.obtainedAt ?? new Date().toISOString(),
    source: draft.source,
    ephemeral: true,
  };
  s.ephemeral = [...s.ephemeral.filter((entry) => entry.id !== EXTERNAL_ACCOUNT_ID), account];
}

export async function list(): Promise<Account[]> {
  const s = await ensureState();
  await ensureExternalAccount(s);
  return [...s.persisted.accounts, ...s.ephemeral];
}

export async function get(id: string): Promise<Account | null> {
  const all = await list();
  return all.find((account) => account.id === id) ?? null;
}

export async function getActive(): Promise<Account | null> {
  const s = await ensureState();
  await ensureExternalAccount(s);
  const activeId = s.persisted.activeId;
  if (activeId) {
    const persisted = s.persisted.accounts.find((account) => account.id === activeId);
    if (persisted) return persisted;
  }
  // If no persisted active, prefer an ephemeral env-based account.
  if (s.ephemeral.length > 0) return s.ephemeral[0];
  return s.persisted.accounts[0] ?? null;
}

export async function setActive(id: string): Promise<Account | null> {
  const s = await ensureState();
  const target =
    s.persisted.accounts.find((account) => account.id === id) ??
    s.ephemeral.find((account) => account.id === id);
  if (!target) return null;
  if (s.persisted.activeId !== id && !target.ephemeral) {
    s.persisted.activeId = id;
    await writePersisted(s.persisted);
  } else if (target.ephemeral) {
    // Cannot persist an ephemeral as active; just return it.
  }
  return target;
}

export async function add(account: Account): Promise<Account> {
  const s = await ensureState();
  if (account.ephemeral) {
    const without = s.ephemeral.filter((existing) => existing.id !== account.id);
    s.ephemeral = [...without, account];
    return account;
  }
  const without = s.persisted.accounts.filter((existing) => existing.id !== account.id);
  s.persisted.accounts = [...without, account];
  if (!s.persisted.activeId) s.persisted.activeId = account.id;
  await writePersisted(s.persisted);
  return account;
}

export async function update(id: string, patch: Partial<Account>): Promise<Account | null> {
  const s = await ensureState();
  const idx = s.persisted.accounts.findIndex((account) => account.id === id);
  if (idx >= 0) {
    const merged = { ...s.persisted.accounts[idx], ...patch, id };
    s.persisted.accounts = [
      ...s.persisted.accounts.slice(0, idx),
      merged,
      ...s.persisted.accounts.slice(idx + 1),
    ];
    await writePersisted(s.persisted);
    return merged;
  }
  const eIdx = s.ephemeral.findIndex((account) => account.id === id);
  if (eIdx >= 0) {
    const merged = { ...s.ephemeral[eIdx], ...patch, id };
    s.ephemeral = [...s.ephemeral.slice(0, eIdx), merged, ...s.ephemeral.slice(eIdx + 1)];
    return merged;
  }
  return null;
}

export async function remove(id: string): Promise<boolean> {
  const s = await ensureState();
  const before = s.persisted.accounts.length;
  s.persisted.accounts = s.persisted.accounts.filter((account) => account.id !== id);
  if (s.persisted.accounts.length !== before) {
    if (s.persisted.activeId === id) {
      s.persisted.activeId = s.persisted.accounts[0]?.id ?? null;
    }
    await writePersisted(s.persisted);
    return true;
  }
  s.ephemeral = s.ephemeral.filter((account) => account.id !== id);
  return false;
}

export async function clear(): Promise<void> {
  const s = await ensureState();
  s.persisted = emptyData();
  s.ephemeral = [];
  try {
    await rm(ACCOUNTS_PATH, { force: true });
  } catch {
    // best-effort
  }
}

export async function getProviderConfig(providerConfigId: string): Promise<ProviderConfig | null> {
  const s = await ensureState();
  return s.persisted.providerConfigs[providerConfigId] ?? null;
}

export async function listProviderConfigs(): Promise<Record<string, ProviderConfig>> {
  const s = await ensureState();
  return { ...s.persisted.providerConfigs };
}

export async function upsertProviderConfig(config: ProviderConfig): Promise<void> {
  const s = await ensureState();
  s.persisted.providerConfigs = { ...s.persisted.providerConfigs, [config.id]: config };
  await writePersisted(s.persisted);
}

export function resetForTesting(): void {
  state = null;
  initPromise = null;
}
