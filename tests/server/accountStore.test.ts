import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { TMP_DIR, LEGACY_TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  const base = resolve(tmpdir(), `gh-dash-accountstore-${process.pid}-${Date.now()}`);
  return {
    TMP_DIR: base,
    LEGACY_TMP_DIR: `${base}-legacy`,
  };
});

vi.mock("../../src/server/config", () => ({
  DATA_DIR: TMP_DIR,
  LEGACY_DATA_DIR: LEGACY_TMP_DIR,
}));

vi.mock("../../src/server/authProvider", () => ({
  loadExternalAccountDraft: vi.fn(async () => null),
}));

const store = await import("../../src/server/accountStore");
const { loadExternalAccountDraft } = await import("../../src/server/authProvider");
const mockedDraft = loadExternalAccountDraft as unknown as ReturnType<typeof vi.fn>;

const ACCOUNTS_PATH = resolve(TMP_DIR, "accounts.json");
const LEGACY_TOKEN_PATH = resolve(TMP_DIR, "auth.json");
const LEGACY_BACKUP_PATH = resolve(TMP_DIR, "auth.json.legacy.bak");

async function writeLegacyToken(payload: Record<string, unknown>): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(LEGACY_TOKEN_PATH, JSON.stringify(payload), { mode: 0o600 });
}

async function readAccountsFile(): Promise<unknown> {
  const raw = await readFile(ACCOUNTS_PATH, "utf-8");
  return JSON.parse(raw);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("accountStore", () => {
  beforeEach(async () => {
    store.resetForTesting();
    await rm(TMP_DIR, { recursive: true, force: true });
    // Default to device mode (no external credential) for existing cases.
    mockedDraft.mockReset();
    mockedDraft.mockResolvedValue(null);
  });

  it("bootstraps empty when no legacy file exists", async () => {
    await store.init();
    const active = await store.getActive();
    expect(active).toBeNull();
    const all = await store.list();
    expect(all).toEqual([]);
    expect(await fileExists(ACCOUNTS_PATH)).toBe(false);
  });

  it("migrates legacy auth.json into accounts.json and backs up the legacy file", async () => {
    await writeLegacyToken({
      accessToken: "ghs_abc",
      scope: "repo read:org",
      obtainedAt: "2026-04-01T00:00:00Z",
      login: "debba",
    });

    await store.init();

    const active = await store.getActive();
    expect(active).not.toBeNull();
    expect(active?.accessToken).toBe("ghs_abc");
    expect(active?.login).toBe("debba");
    expect(active?.providerKind).toBe("github");
    expect(active?.providerConfigId).toBe("github.com");
    expect(active?.id).toBe("gh_debba");

    expect(await fileExists(LEGACY_TOKEN_PATH)).toBe(false);
    expect(await fileExists(LEGACY_BACKUP_PATH)).toBe(true);

    const data = (await readAccountsFile()) as {
      activeId: string;
      accounts: { id: string }[];
      providerConfigs: Record<string, unknown>;
    };
    expect(data.activeId).toBe("gh_debba");
    expect(data.accounts).toHaveLength(1);
    expect(data.providerConfigs["github.com"]).toBeDefined();
    expect(data.providerConfigs["codeberg.org"]).toBeDefined();
    expect(data.providerConfigs["gitlab.com"]).toBeDefined();
  });

  it("is idempotent across re-initializations", async () => {
    await writeLegacyToken({ accessToken: "tok", scope: "repo", login: "alice" });
    await store.init();
    store.resetForTesting();
    await store.init();
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].login).toBe("alice");
  });

  it("supports add/setActive/remove on persisted accounts", async () => {
    await store.init();
    const a = await store.add({
      id: "gh_one",
      providerKind: "github",
      providerConfigId: "github.com",
      label: "one (github.com)",
      login: "one",
      accessToken: "t1",
      scope: "repo",
      obtainedAt: "2026-05-01T00:00:00Z",
      source: "device",
    });
    const b = await store.add({
      id: "gh_two",
      providerKind: "github",
      providerConfigId: "github.com",
      label: "two (github.com)",
      login: "two",
      accessToken: "t2",
      scope: "repo",
      obtainedAt: "2026-05-02T00:00:00Z",
      source: "device",
    });
    expect((await store.getActive())?.id).toBe(a.id);
    await store.setActive(b.id);
    expect((await store.getActive())?.id).toBe(b.id);
    await store.remove(b.id);
    const active = await store.getActive();
    expect(active?.id).toBe(a.id);
  });

  it("seeds an ephemeral external account in token/gh-cli mode", async () => {
    // Regression: in token/gh-cli mode the store is never populated from disk,
    // so getActive() returned null and every data endpoint 401'd even though
    // /api/auth/status reported the token as authenticated.
    mockedDraft.mockResolvedValue({
      token: "ghp_regression",
      login: "octocat",
      scope: "repo, read:org",
      source: "env",
    });
    await store.init();

    const active = await store.getActive();
    expect(active).not.toBeNull();
    expect(active?.id).toBe("external");
    expect(active?.accessToken).toBe("ghp_regression");
    expect(active?.login).toBe("octocat");
    expect(active?.scope).toBe("repo, read:org");
    expect(active?.source).toBe("env");
    expect(active?.ephemeral).toBe(true);
    expect(active?.providerConfigId).toBe("github.com");

    const all = await store.list();
    expect(all).toHaveLength(1);
    // The external account is ephemeral — never written to disk.
    expect(await fileExists(ACCOUNTS_PATH)).toBe(false);
  });

  it("drops the ephemeral external account when the credential disappears", async () => {
    mockedDraft.mockResolvedValue({ token: "t", login: "x", scope: "", source: "gh-cli" });
    await store.init();
    expect((await store.getActive())?.id).toBe("external");

    // Token unset / gh logout at runtime -> no draft.
    mockedDraft.mockResolvedValue(null);
    expect(await store.getActive()).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("does not persist ephemeral accounts", async () => {
    await store.init();
    await store.add({
      id: "_env_token",
      providerKind: "github",
      providerConfigId: "github.com",
      label: "env",
      login: "env",
      accessToken: "tok",
      scope: "",
      obtainedAt: "2026-05-01T00:00:00Z",
      source: "env",
      ephemeral: true,
    });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(await fileExists(ACCOUNTS_PATH)).toBe(false);
  });
});
