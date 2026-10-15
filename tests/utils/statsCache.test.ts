import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearStatsCache, readStatsCache, writeStatsCache } from "../../src/utils/statsCache";

describe("statsCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when no cache exists", () => {
    expect(readStatsCache()).toBeNull();
  });

  it("writes and reads back cached stats", () => {
    const data = {
      repos: [{ nameWithOwner: "acme/app", stargazerCount: 10 }],
      owners: ["acme"],
      issues: [{ title: "Bug" }],
      pullRequests: [{ title: "Fix" }],
      fetchedAt: "2026-04-29T10:00:00Z",
    };

    writeStatsCache(data);
    const result = readStatsCache();

    expect(result).not.toBeNull();
    expect(result!.repos).toEqual(data.repos);
    expect(result!.owners).toEqual(data.owners);
    expect(result!.issues).toEqual(data.issues);
    expect(result!.pullRequests).toEqual(data.pullRequests);
    expect(result!.fetchedAt).toBe(data.fetchedAt);
    expect(result!.savedAt).toBeGreaterThan(0);
  });

  it("clears cached stats", () => {
    writeStatsCache({
      repos: [],
      owners: [],
      issues: [],
      pullRequests: [],
      fetchedAt: "",
    });

    clearStatsCache();
    expect(readStatsCache()).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    localStorage.setItem("gitdeck.cache.stats", "not-json{{{");
    expect(readStatsCache()).toBeNull();
  });

  it("returns null if data shape is invalid", () => {
    localStorage.setItem("gitdeck.cache.stats", JSON.stringify({ repos: "not-array" }));
    expect(readStatsCache()).toBeNull();
  });

  it("handles localStorage quota errors gracefully", () => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };

    // Should not throw
    expect(() => writeStatsCache({
      repos: [],
      owners: [],
      issues: [],
      pullRequests: [],
      fetchedAt: "",
    })).not.toThrow();

    Storage.prototype.setItem = originalSetItem;
  });

  it("overwrites previous cache on second write", () => {
    writeStatsCache({
      repos: [{ name: "old" }],
      owners: ["old-owner"],
      issues: [],
      pullRequests: [],
      fetchedAt: "2026-01-01T00:00:00Z",
    });

    writeStatsCache({
      repos: [{ name: "new" }],
      owners: ["new-owner"],
      issues: [{ title: "Fresh" }],
      pullRequests: [],
      fetchedAt: "2026-05-03T00:00:00Z",
    });

    const result = readStatsCache();
    expect(result!.repos).toEqual([{ name: "new" }]);
    expect(result!.owners).toEqual(["new-owner"]);
    expect(result!.issues).toEqual([{ title: "Fresh" }]);
    expect(result!.fetchedAt).toBe("2026-05-03T00:00:00Z");
  });

  it("returns null if required arrays are missing", () => {
    localStorage.setItem("gitdeck.cache.stats", JSON.stringify({
      repos: [{ name: "ok" }],
      owners: ["owner"],
      fetchedAt: "2026-01-01",
      savedAt: 1,
    }));
    expect(readStatsCache()).toBeNull();
  });
});
