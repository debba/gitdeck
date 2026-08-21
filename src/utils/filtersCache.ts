/**
 * Persists sidebar filter selections to localStorage so they survive page refreshes.
 * Follows the same pattern as statsCache.ts — pure functions, shape validation, silent failure.
 */

import type { IssueFilters, PullRequestFilters, RepoFilters } from "./dashboard";

const STORAGE_KEY = "gh-dash.cache.filters";

/** JSON-safe representation (Sets become arrays). */
export interface CachedFilters {
  repoFilters: {
    search: string;
    orgs: string[];
    languages: string[];
    visibility: string;
    includeForks: boolean;
    includeArchived: boolean;
  };
  issueFilters: {
    search: string;
    orgs: string[];
    repos: string[];
    labels: string[];
    authors: string[];
    excludedAuthors?: string[];
    authorMode?: "include" | "exclude";
    assignees: string[];
    dates: { cf: string; ct: string; uf: string; ut: string };
    preset: string;
  };
  prFilters: {
    search: string;
    orgs: string[];
    repos: string[];
    labels: string[];
    authors: string[];
    excludedAuthors?: string[];
    authorMode?: "include" | "exclude";
    assignees: string[];
    dates: { cf: string; ct: string; uf: string; ut: string };
    preset: string;
  };
  // Optional so cached data from before this field existed still validates.
  sorts?: {
    issueSort: string;
    prSort: string;
    repoSort: string;
  };
  savedAt: number;
}

const VALID_VISIBILITY = new Set(["all", "public", "private"]);
const VALID_AUTHOR_MODES = new Set(["include", "exclude"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDateFilters(value: unknown): value is { cf: string; ct: string; uf: string; ut: string } {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.cf === "string" && typeof obj.ct === "string" && typeof obj.uf === "string" && typeof obj.ut === "string";
}

function validateShape(parsed: unknown): parsed is CachedFilters {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;

  // Validate repoFilters
  const rf = obj.repoFilters;
  if (!rf || typeof rf !== "object") return false;
  const repoF = rf as Record<string, unknown>;
  if (typeof repoF.search !== "string") return false;
  if (!isStringArray(repoF.orgs)) return false;
  if (!isStringArray(repoF.languages)) return false;
  if (typeof repoF.visibility !== "string") return false;
  if (typeof repoF.includeForks !== "boolean") return false;
  if (typeof repoF.includeArchived !== "boolean") return false;

  // Validate issueFilters
  const isf = obj.issueFilters;
  if (!isf || typeof isf !== "object") return false;
  const issueF = isf as Record<string, unknown>;
  if (typeof issueF.search !== "string") return false;
  if (!isStringArray(issueF.orgs)) return false;
  if (!isStringArray(issueF.repos)) return false;
  if (!isStringArray(issueF.labels)) return false;
  if (!isStringArray(issueF.authors)) return false;
  if (issueF.excludedAuthors !== undefined && !isStringArray(issueF.excludedAuthors)) return false;
  if (issueF.authorMode !== undefined && (typeof issueF.authorMode !== "string" || !VALID_AUTHOR_MODES.has(issueF.authorMode))) return false;
  if (!isStringArray(issueF.assignees)) return false;
  if (!isDateFilters(issueF.dates)) return false;
  if (typeof issueF.preset !== "string") return false;

  // Validate prFilters
  const prf = obj.prFilters;
  if (!prf || typeof prf !== "object") return false;
  const prF = prf as Record<string, unknown>;
  if (typeof prF.search !== "string") return false;
  if (!isStringArray(prF.orgs)) return false;
  if (!isStringArray(prF.repos)) return false;
  if (!isStringArray(prF.labels)) return false;
  if (!isStringArray(prF.authors)) return false;
  if (prF.excludedAuthors !== undefined && !isStringArray(prF.excludedAuthors)) return false;
  if (prF.authorMode !== undefined && (typeof prF.authorMode !== "string" || !VALID_AUTHOR_MODES.has(prF.authorMode))) return false;
  if (!isStringArray(prF.assignees)) return false;
  if (!isDateFilters(prF.dates)) return false;
  if (typeof prF.preset !== "string") return false;

  return true;
}

/**
 * Read cached filters from localStorage.
 * Returns null if no cache exists, data is unparseable, or shape is invalid.
 */
export function readFiltersCache(): CachedFilters | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!validateShape(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Convert cached JSON-safe filters back to the Set-based types used by the app.
 * Sanitizes invalid visibility values to "all".
 *
 * Stale org/language references (orgs that no longer exist in the user's data)
 * are kept in the Sets — the existing filter logic in App.tsx intersects them
 * with the current facets, so non-matching entries simply produce 0 results.
 */
function hydrateAuthorSelections(filters: { authors: string[]; excludedAuthors?: string[]; authorMode?: "include" | "exclude" }) {
  if (filters.excludedAuthors !== undefined) {
    return { authors: new Set(filters.authors), excludedAuthors: new Set(filters.excludedAuthors) };
  }

  // Older caches used authorMode to interpret one shared author selection.
  return filters.authorMode === "exclude"
    ? { authors: new Set<string>(), excludedAuthors: new Set(filters.authors) }
    : { authors: new Set(filters.authors), excludedAuthors: new Set<string>() };
}

export function hydrateFilters(cached: CachedFilters): {
  repoFilters: RepoFilters;
  issueFilters: IssueFilters;
  prFilters: PullRequestFilters;
} {
  const visibility = VALID_VISIBILITY.has(cached.repoFilters.visibility)
    ? (cached.repoFilters.visibility as "all" | "public" | "private")
    : "all";

  return {
    repoFilters: {
      search: cached.repoFilters.search,
      orgs: new Set(cached.repoFilters.orgs),
      languages: new Set(cached.repoFilters.languages),
      visibility,
      includeForks: cached.repoFilters.includeForks,
      includeArchived: cached.repoFilters.includeArchived,
    },
    issueFilters: {
      search: cached.issueFilters.search,
      orgs: new Set(cached.issueFilters.orgs),
      repos: new Set(cached.issueFilters.repos),
      labels: new Set(cached.issueFilters.labels),
      ...hydrateAuthorSelections(cached.issueFilters),
      authorMode: cached.issueFilters.authorMode ?? "include",
      assignees: new Set(cached.issueFilters.assignees),
      dates: { ...cached.issueFilters.dates },
      preset: cached.issueFilters.preset,
    },
    prFilters: {
      search: cached.prFilters.search,
      orgs: new Set(cached.prFilters.orgs),
      repos: new Set(cached.prFilters.repos),
      labels: new Set(cached.prFilters.labels),
      ...hydrateAuthorSelections(cached.prFilters),
      authorMode: cached.prFilters.authorMode ?? "include",
      assignees: new Set(cached.prFilters.assignees),
      dates: { ...cached.prFilters.dates },
      preset: cached.prFilters.preset,
    },
  };
}

/**
 * Write current filter state to localStorage. Silently fails on quota errors.
 * Converts Sets to arrays for JSON serialization.
 */
export function writeFiltersCache(
  repoFilters: RepoFilters,
  issueFilters: IssueFilters,
  prFilters: PullRequestFilters,
  sorts?: { issueSort: string; prSort: string; repoSort: string },
): void {
  try {
    const entry: CachedFilters = {
      repoFilters: {
        search: repoFilters.search,
        orgs: [...repoFilters.orgs],
        languages: [...repoFilters.languages],
        visibility: repoFilters.visibility,
        includeForks: repoFilters.includeForks,
        includeArchived: repoFilters.includeArchived,
      },
      issueFilters: {
        search: issueFilters.search,
        orgs: [...issueFilters.orgs],
        repos: [...issueFilters.repos],
        labels: [...issueFilters.labels],
        authors: [...issueFilters.authors],
        excludedAuthors: [...issueFilters.excludedAuthors],
        authorMode: issueFilters.authorMode,
        assignees: [...issueFilters.assignees],
        dates: { ...issueFilters.dates },
        preset: issueFilters.preset,
      },
      prFilters: {
        search: prFilters.search,
        orgs: [...prFilters.orgs],
        repos: [...prFilters.repos],
        labels: [...prFilters.labels],
        authors: [...prFilters.authors],
        excludedAuthors: [...prFilters.excludedAuthors],
        authorMode: prFilters.authorMode,
        assignees: [...prFilters.assignees],
        dates: { ...prFilters.dates },
        preset: prFilters.preset,
      },
      sorts: sorts ? { ...sorts } : undefined,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Quota exceeded or private browsing — ignore silently
  }
}

/**
 * Remove cached filters (e.g. on logout or "Clear all" reset).
 */
export function clearFiltersCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
