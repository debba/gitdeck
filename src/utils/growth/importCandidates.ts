import type {
  GrowthAssetImportCandidate,
  GrowthAssetImportOrigin,
} from "../../types/growth";

export interface GrowthAssetImportSource {
  origin: GrowthAssetImportOrigin;
  source: string;
  title?: string | null;
  baseUrl?: string | null;
  mediaUrls: readonly unknown[];
}

/** Canonicalizes an HTTP media URL for candidate matching and repository-level deduplication. */
export function normalizeGrowthAssetImportUrl(value: string, baseUrl?: string | null): string | null {
  try {
    const url = new URL(value.trim(), baseUrl ?? undefined);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function inferredTitle(urlValue: string, source: GrowthAssetImportSource): string {
  const explicit = source.title?.replace(/\s+/g, " ").trim();
  if (explicit) return explicit.slice(0, 500);
  try {
    const filename = decodeURIComponent(new URL(urlValue).pathname.split("/").filter(Boolean).pop() ?? "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (filename) return filename.slice(0, 500);
  } catch {
    // The URL was already normalized; retain the source fallback if decoding fails.
  }
  return source.source.trim().slice(0, 500) || "Imported media";
}

/** Builds a stable candidate set, resolving relative links and preferring the first source for duplicates. */
export function normalizeGrowthAssetImportCandidates(
  sources: readonly GrowthAssetImportSource[],
  limit = 48,
): GrowthAssetImportCandidate[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const candidates: GrowthAssetImportCandidate[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (source.origin !== "readme" && source.origin !== "website") continue;
    const sourceLabel = source.source.trim();
    if (!sourceLabel) continue;
    for (const rawUrl of source.mediaUrls) {
      if (typeof rawUrl !== "string") continue;
      const url = normalizeGrowthAssetImportUrl(rawUrl, source.baseUrl);
      if (!url) continue;
      const key = url;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = inferredTitle(url, source);
      candidates.push({
        origin: source.origin,
        source: sourceLabel,
        url,
        title,
        alt: title,
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}
