import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFiltersCache,
  hydrateFilters,
  readFiltersCache,
  writeFiltersCache,
} from "../../src/utils/filtersCache";

function makeDefaultRepoFilters() {
  return { search: "", orgs: new Set<string>(), languages: new Set<string>(), visibility: "all" as const, includeForks: true, includeArchived: false };
}

function makeDefaultIssueFilters() {
  return { search: "", orgs: new Set<string>(), repos: new Set<string>(), labels: new Set<string>(), authors: new Set<string>(), authorMode: "include" as const, assignees: new Set<string>(), dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" };
}

function makeDefaultPrFilters() {
  return { search: "", orgs: new Set<string>(), repos: new Set<string>(), labels: new Set<string>(), authors: new Set<string>(), authorMode: "include" as const, assignees: new Set<string>(), dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" };
}

describe("filtersCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when no cache exists", () => {
    expect(readFiltersCache()).toBeNull();
  });

  it("round-trips write then read", () => {
    const repo = { ...makeDefaultRepoFilters(), orgs: new Set(["acme"]), languages: new Set(["Go"]), visibility: "private" as const };
    const issue = { ...makeDefaultIssueFilters(), search: "bug", orgs: new Set(["acme"]), authors: new Set(["renovate"]), authorMode: "exclude" as const };
    const pr = { ...makeDefaultPrFilters(), preset: "draft", authors: new Set(["alice"]), authorMode: "exclude" as const };

    writeFiltersCache(repo, issue, pr);
    const result = readFiltersCache();

    expect(result).not.toBeNull();
    expect(result!.repoFilters.orgs).toEqual(["acme"]);
    expect(result!.repoFilters.languages).toEqual(["Go"]);
    expect(result!.repoFilters.visibility).toBe("private");
    expect(result!.issueFilters.search).toBe("bug");
    expect(result!.issueFilters.orgs).toEqual(["acme"]);
    expect(result!.issueFilters.authorMode).toBe("exclude");
    expect(result!.prFilters.preset).toBe("draft");
    expect(result!.prFilters.authorMode).toBe("exclude");
    expect(result!.savedAt).toBeGreaterThan(0);
  });

  it("hydrates cached JSON back to Set-based filter types", () => {
    const repo = { ...makeDefaultRepoFilters(), orgs: new Set(["org1", "org2"]), languages: new Set(["TypeScript"]) };
    writeFiltersCache(repo, makeDefaultIssueFilters(), makeDefaultPrFilters());

    const cached = readFiltersCache()!;
    const hydrated = hydrateFilters(cached);

    expect(hydrated.repoFilters.orgs).toBeInstanceOf(Set);
    expect(hydrated.repoFilters.orgs.has("org1")).toBe(true);
    expect(hydrated.repoFilters.orgs.has("org2")).toBe(true);
    expect(hydrated.repoFilters.languages.has("TypeScript")).toBe(true);
  });

  it("hydrates legacy caches with inclusive author filters", () => {
    writeFiltersCache(makeDefaultRepoFilters(), makeDefaultIssueFilters(), makeDefaultPrFilters());
    const raw = JSON.parse(localStorage.getItem("gh-dash.cache.filters")!);
    delete raw.issueFilters.authorMode;
    delete raw.prFilters.authorMode;
    localStorage.setItem("gh-dash.cache.filters", JSON.stringify(raw));

    const hydrated = hydrateFilters(readFiltersCache()!);
    expect(hydrated.issueFilters.authorMode).toBe("include");
    expect(hydrated.prFilters.authorMode).toBe("include");
  });

  it("returns null for corrupted JSON", () => {
    localStorage.setItem("gh-dash.cache.filters", "not-json{{{");
    expect(readFiltersCache()).toBeNull();
  });

  it("returns null for invalid shape (missing repoFilters)", () => {
    localStorage.setItem("gh-dash.cache.filters", JSON.stringify({
      issueFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      prFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      savedAt: 1,
    }));
    expect(readFiltersCache()).toBeNull();
  });

  it("returns null for partial corruption (orgs is not an array)", () => {
    localStorage.setItem("gh-dash.cache.filters", JSON.stringify({
      repoFilters: { search: "", orgs: "not-array", languages: [], visibility: "all", includeForks: true, includeArchived: false },
      issueFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      prFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      savedAt: 1,
    }));
    expect(readFiltersCache()).toBeNull();
  });

  it("returns null when dates field has wrong shape", () => {
    localStorage.setItem("gh-dash.cache.filters", JSON.stringify({
      repoFilters: { search: "", orgs: [], languages: [], visibility: "all", includeForks: true, includeArchived: false },
      issueFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: "bad", preset: "" },
      prFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      savedAt: 1,
    }));
    expect(readFiltersCache()).toBeNull();
  });

  it("handles localStorage quota errors gracefully on write", () => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };

    expect(() => writeFiltersCache(
      makeDefaultRepoFilters(),
      makeDefaultIssueFilters(),
      makeDefaultPrFilters(),
    )).not.toThrow();

    Storage.prototype.setItem = originalSetItem;
  });

  it("sanitizes invalid visibility to 'all' during hydration", () => {
    localStorage.setItem("gh-dash.cache.filters", JSON.stringify({
      repoFilters: { search: "", orgs: [], languages: [], visibility: "bogus", includeForks: true, includeArchived: false },
      issueFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      prFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      savedAt: 1,
    }));

    const cached = readFiltersCache()!;
    const hydrated = hydrateFilters(cached);
    expect(hydrated.repoFilters.visibility).toBe("all");
  });

  it("stale org references do not crash hydration", () => {
    localStorage.setItem("gh-dash.cache.filters", JSON.stringify({
      repoFilters: { search: "", orgs: ["org-that-no-longer-exists", "still-valid"], languages: ["Haskell"], visibility: "all", includeForks: true, includeArchived: false },
      issueFilters: { search: "", orgs: ["ghost-org"], repos: ["ghost/repo"], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      prFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      savedAt: 1,
    }));

    const cached = readFiltersCache()!;
    const hydrated = hydrateFilters(cached);
    expect(hydrated.repoFilters.orgs.has("org-that-no-longer-exists")).toBe(true);
    expect(hydrated.repoFilters.orgs.has("still-valid")).toBe(true);
    expect(hydrated.issueFilters.orgs.has("ghost-org")).toBe(true);
  });

  it("clears cached filters", () => {
    writeFiltersCache(makeDefaultRepoFilters(), makeDefaultIssueFilters(), makeDefaultPrFilters());
    clearFiltersCache();
    expect(readFiltersCache()).toBeNull();
  });

  it("overwrites previous cache on second write", () => {
    writeFiltersCache(
      { ...makeDefaultRepoFilters(), orgs: new Set(["old-org"]) },
      makeDefaultIssueFilters(),
      makeDefaultPrFilters(),
    );

    writeFiltersCache(
      { ...makeDefaultRepoFilters(), orgs: new Set(["new-org"]) },
      makeDefaultIssueFilters(),
      makeDefaultPrFilters(),
    );

    const result = readFiltersCache()!;
    expect(result.repoFilters.orgs).toEqual(["new-org"]);
  });

  it("returns null when includeForks is not a boolean", () => {
    localStorage.setItem("gh-dash.cache.filters", JSON.stringify({
      repoFilters: { search: "", orgs: [], languages: [], visibility: "all", includeForks: "yes", includeArchived: false },
      issueFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      prFilters: { search: "", orgs: [], repos: [], labels: [], authors: [], assignees: [], dates: { cf: "", ct: "", uf: "", ut: "" }, preset: "" },
      savedAt: 1,
    }));
    expect(readFiltersCache()).toBeNull();
  });
});
