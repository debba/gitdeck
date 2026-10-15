import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";

const { TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve } = require("node:path") as typeof import("node:path");
  return {
    TMP_DIR: resolve(tmpdir(), `gitdeck-tokenstore-${process.pid}-${Date.now()}`),
  };
});

vi.mock("../../src/server/config", () => ({
  DATA_DIR: TMP_DIR,
}));

const { clearToken, readToken, resetTokenCache, updateLogin, writeToken } = await import(
  "../../src/server/tokenStore"
);

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("tokenStore", () => {
  beforeEach(async () => {
    resetTokenCache();
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it("returns null when no token has been saved", async () => {
    expect(await readToken()).toBeNull();
  });

  it("round-trips a token through write/read", async () => {
    await writeToken({ accessToken: "abc", scope: "repo", obtainedAt: "2026-04-28T00:00:00Z" });
    resetTokenCache();
    const stored = await readToken();
    expect(stored?.accessToken).toBe("abc");
    expect(stored?.scope).toBe("repo");
  });

  it("preserves other fields when updating the login", async () => {
    await writeToken({ accessToken: "x", scope: "repo", obtainedAt: "now" });
    await updateLogin("alice");
    const stored = await readToken();
    expect(stored?.login).toBe("alice");
    expect(stored?.accessToken).toBe("x");
    expect(stored?.scope).toBe("repo");
  });

  it("does nothing when updateLogin is called without a stored token", async () => {
    await updateLogin("alice");
    expect(await readToken()).toBeNull();
  });

  it("clears the stored token", async () => {
    await writeToken({ accessToken: "x", scope: "repo", obtainedAt: "now" });
    await clearToken();
    expect(await readToken()).toBeNull();
  });
});
