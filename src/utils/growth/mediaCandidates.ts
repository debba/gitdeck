import type { GrowthAsset, GrowthContentMedia } from "../../types/growth";
import { isVideoMediaUrl } from "../socialProposals";

export interface GrowthMediaCandidate {
  key: string;
  assetId?: string;
  url?: string;
  kind: "image" | "video";
  label: string;
  alt: string;
}

export interface GrowthMediaCandidateInput {
  repository: string;
  assets: readonly GrowthAsset[];
  readmeMediaUrls?: readonly unknown[];
  additionalSources?: readonly unknown[];
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sourceLabel(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "Project media");
  } catch {
    return "Project media";
  }
}

function additionalMediaUrls(sources: readonly unknown[]): unknown[] {
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return [];
    const mediaUrls = (source as { mediaUrls?: unknown }).mediaUrls;
    return Array.isArray(mediaUrls) ? mediaUrls : [];
  });
}

/** Builds a stable, deduplicated allowlist from stored assets and collected source media. */
export function normalizeGrowthMediaCandidates(input: GrowthMediaCandidateInput): GrowthMediaCandidate[] {
  const candidates: GrowthMediaCandidate[] = [];
  const seenAssets = new Set<string>();
  const seenUrls = new Set<string>();

  for (const asset of input.assets) {
    if (!asset.id.trim() || seenAssets.has(asset.id) || (!asset.path && !normalizeHttpUrl(asset.url))) continue;
    seenAssets.add(asset.id);
    const normalizedAssetUrl = normalizeHttpUrl(asset.url);
    if (normalizedAssetUrl) seenUrls.add(normalizedAssetUrl);
    const fallback = `${input.repository} ${asset.kind}`;
    const label = asset.title.trim() || asset.alt.trim() || fallback;
    candidates.push({
      key: `asset:${asset.id}`,
      assetId: asset.id,
      kind: asset.kind,
      label,
      alt: asset.alt.trim() || label,
    });
  }

  const sourceUrls = [
    ...(input.readmeMediaUrls ?? []),
    ...additionalMediaUrls(input.additionalSources ?? []),
  ];
  for (const value of sourceUrls) {
    const url = normalizeHttpUrl(value);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const label = sourceLabel(url);
    candidates.push({
      key: `url:${url}`,
      url,
      kind: isVideoMediaUrl(url) ? "video" : "image",
      label,
      alt: label || `${input.repository} media`,
    });
  }

  return candidates;
}

function findCandidate(
  entry: Record<string, unknown>,
  candidates: readonly GrowthMediaCandidate[],
): GrowthMediaCandidate | undefined {
  if (typeof entry.candidateKey === "string") {
    const key = entry.candidateKey.trim();
    const matched = candidates.find((candidate) => candidate.key === key);
    if (matched) return matched;
  }
  if (typeof entry.assetId === "string") {
    const assetId = entry.assetId.trim();
    const matched = candidates.find((candidate) => candidate.assetId === assetId);
    if (matched) return matched;
  }
  const url = normalizeHttpUrl(entry.url);
  return url ? candidates.find((candidate) => candidate.url === url) : undefined;
}

export function growthContentMediaFromCandidate(
  candidate: GrowthMediaCandidate,
  alt = candidate.alt,
  caption?: string,
): GrowthContentMedia {
  return {
    kind: candidate.kind,
    alt: alt.trim() || candidate.alt,
    ...(candidate.assetId ? { assetId: candidate.assetId } : { url: candidate.url! }),
    ...(caption?.trim() ? { caption: caption.trim() } : {}),
  };
}

/** Resolves model selections against the supplied allowlist and discards invented assets and URLs. */
export function normalizeGrowthDraftMedia(
  value: unknown,
  candidates: readonly GrowthMediaCandidate[],
  limit = 2,
): GrowthContentMedia[] {
  if (!Array.isArray(value) || limit <= 0) return [];
  const selected: GrowthContentMedia[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const candidate = findCandidate(entry, candidates);
    if (!candidate || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    selected.push(growthContentMediaFromCandidate(
      candidate,
      typeof entry.alt === "string" ? entry.alt : candidate.alt,
      typeof entry.caption === "string" ? entry.caption : undefined,
    ));
    if (selected.length >= limit) break;
  }
  return selected;
}
