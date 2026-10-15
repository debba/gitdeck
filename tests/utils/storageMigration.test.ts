import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyStorage } from "../../src/utils/storageMigration";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("migrateLegacyStorage", () => {
  it("preserves preferences and caches while leaving unrelated data alone", () => {
    const entries = {
      "gh-dash.theme": "light",
      "gh-dash.language": "it",
      "gh-dash.cache.filters": JSON.stringify({ boards: ["PVT_roadmap"] }),
      "gh-dash.cache.stats": JSON.stringify({ repos: [] }),
      "gh-dash.welcomeSeen": "1",
    };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    localStorage.setItem("unrelated.preference", "keep");

    migrateLegacyStorage(localStorage);

    for (const [key, value] of Object.entries(entries)) {
      expect(localStorage.getItem(key.replace("gh-dash.", "gitdeck."))).toBe(value);
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem("unrelated.preference")).toBe("keep");
  });

  it("keeps newer Gitdeck values even when they are empty", () => {
    localStorage.setItem("gh-dash.theme", "light");
    localStorage.setItem("gitdeck.theme", "dark");
    localStorage.setItem("gh-dash.language", "it");
    localStorage.setItem("gitdeck.language", "");

    migrateLegacyStorage(localStorage);

    expect(localStorage.getItem("gitdeck.theme")).toBe("dark");
    expect(localStorage.getItem("gitdeck.language")).toBe("");
    expect(localStorage.getItem("gh-dash.theme")).toBeNull();
  });

  it("is safe to run on every application load", () => {
    localStorage.setItem("gh-dash.inboxDensity", "compact");
    migrateLegacyStorage();
    migrateLegacyStorage();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("gitdeck.inboxDensity")).toBe("compact");
  });

  it("keeps the original value on write failure and retries successfully", () => {
    localStorage.setItem("gh-dash.theme", "light");
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new DOMException("Storage full", "QuotaExceededError"); });

    expect(() => migrateLegacyStorage(localStorage)).not.toThrow();
    expect(localStorage.getItem("gh-dash.theme")).toBe("light");
    expect(localStorage.getItem("gitdeck.theme")).toBeNull();

    migrateLegacyStorage(localStorage);
    expect(localStorage.getItem("gitdeck.theme")).toBe("light");
    expect(localStorage.getItem("gh-dash.theme")).toBeNull();
  });

  it("does not prevent startup when browser storage is inaccessible", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Access denied", "SecurityError"); });
    expect(() => migrateLegacyStorage()).not.toThrow();
  });
});
