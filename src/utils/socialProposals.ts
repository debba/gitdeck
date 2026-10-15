import type { GoalContentSource, GoalMediaSuggestion, GoalProposal, GoalProposalFormat } from "../types/goals";
import { parseRepositoryName } from "./repository";

export const SOCIAL_PROPOSAL_FORMATS = ["x-thread", "linkedin-post", "mastodon-post"] as const satisfies readonly GoalProposalFormat[];

const SOCIAL_LIMITS: Partial<Record<GoalProposalFormat, number>> = {
  "x-thread": 280,
  "linkedin-post": 3_000,
  "mastodon-post": 500,
};

/** Counts Unicode code points rather than UTF-16 units, which avoids double-counting most emoji. */
export function socialCharacterCount(text: string): number {
  return Array.from(text).length;
}

function hashtagCount(text: string): number {
  return [...text.matchAll(/(?:^|\s)#[\p{L}\p{N}_]+/gu)].length;
}

function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Validates, canonicalizes, and limits user-provided campaign sources. */
export function normalizeContentSources(entries: unknown, limit = 6): GoalContentSource[] {
  if (!Array.isArray(entries)) return [];
  const sources: GoalContentSource[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const type = entry.type;
    let value: string | null = null;
    if (type === "repository") {
      const parsed = parseRepositoryName(String(entry.value ?? "").trim());
      value = parsed ? `${parsed[0]}/${parsed[1]}` : null;
    }
    if (type === "website") value = normalizeHttpUrl(String(entry.value ?? ""));
    if (!value) continue;
    const key = `${type}:${value.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ type, value } as GoalContentSource);
    if (sources.length >= limit) break;
  }
  return sources;
}

export function extractMediaUrls(markdown: string, baseUrl?: string | null): string[] {
  const candidates = [
    ...[...markdown.matchAll(/!\[[^\]]*\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+["'][^"']*["'])?\)/g)].map((match) => match[1]),
    ...[...markdown.matchAll(/<(?:img|video|source)\b[^>]*?\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]),
    ...[...markdown.matchAll(/<meta\b[^>]*?property=["'](?:og:image|og:video|twitter:image)["'][^>]*?content=["']([^"']+)["']/gi)].map((match) => match[1]),
    ...[...markdown.matchAll(/<meta\b[^>]*?content=["']([^"']+)["'][^>]*?property=["'](?:og:image|og:video|twitter:image)["']/gi)].map((match) => match[1]),
    ...[...markdown.matchAll(/\[[^\]]+\]\(([^\s)]+\.(?:mp4|webm|mov|gif)(?:\?[^\s)]*)?)\)/gi)].map((match) => match[1]),
  ];
  const urls: string[] = [];
  for (const candidate of candidates) {
    try {
      const resolved = new URL(candidate, baseUrl ?? undefined);
      if ((resolved.protocol === "http:" || resolved.protocol === "https:") && !urls.includes(resolved.toString())) urls.push(resolved.toString());
    } catch { /* Ignore malformed and unresolved relative links. */ }
  }
  return urls.slice(0, 12);
}

export interface WebPageSignal {
  title: string | null;
  excerpt: string;
  mediaUrls: string[];
}

/** Extracts readable text and concrete media from a bounded HTML response. */
export function extractWebPageSignal(html: string, pageUrl: string, excerptLength = 7_000): WebPageSignal {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const decode = (value: string) => value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'");
  const clean = (value: string) => decode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const readable = html
    .replace(/<(?:script|style|noscript|svg)\b[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  return {
    title: titleMatch ? clean(titleMatch[1]) || null : null,
    excerpt: clean(readable).slice(0, excerptLength),
    mediaUrls: extractMediaUrls(html, pageUrl),
  };
}

export function isVideoMediaUrl(value: string): boolean {
  try {
    return /\.(?:mp4|webm|mov|m4v)(?:$|\?)/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

/** Ensures each post receives a concrete source asset, rotating the project library between posts. */
export function attachSourceMedia(proposals: GoalProposal[], mediaUrls: string[]): GoalProposal[] {
  const assets = [...new Set(mediaUrls.map(normalizeHttpUrl).filter((url): url is string => Boolean(url)))];
  if (!assets.length) return proposals.map((proposal) => ({ ...proposal, mediaSuggestions: [] }));
  const allowed = new Set(assets);
  return proposals.map((proposal, index) => {
    const selected = (proposal.mediaSuggestions ?? []).filter((media) => allowed.has(media.sourceUrl)).slice(0, 2);
    if (selected.length) return { ...proposal, mediaSuggestions: selected };
    const sourceUrl = assets[index % assets.length];
    const filename = decodeURIComponent(new URL(sourceUrl).pathname.split("/").pop() || "Source asset");
    return {
      ...proposal,
      mediaSuggestions: [{
        kind: isVideoMediaUrl(sourceUrl) ? "video" : "image",
        title: filename,
        sourceUrl,
        guidance: "Attach this existing source asset to the post and verify reuse rights before publishing.",
      }],
    };
  });
}

function normalizeMediaSuggestions(value: unknown): GoalMediaSuggestion[] {
  if (!Array.isArray(value)) return [];
  const suggestions: GoalMediaSuggestion[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const kind = entry.kind === "image" || entry.kind === "video" ? entry.kind : null;
    const sourceUrl = normalizeHttpUrl(String(entry.sourceUrl ?? ""));
    const title = String(entry.title ?? "").trim();
    const guidance = String(entry.guidance ?? "").trim();
    if (!kind || !sourceUrl || !title || !guidance || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    suggestions.push({ kind, sourceUrl, title, guidance });
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

export function socialProposalIssue(proposal: GoalProposal): string | null {
  if (!proposal.title.trim()) return "missing title";
  if (!proposal.summary.trim()) return "missing audience and angle summary";
  if (!proposal.content.trim()) return "missing content";
  if (!SOCIAL_PROPOSAL_FORMATS.includes(proposal.format as (typeof SOCIAL_PROPOSAL_FORMATS)[number])) {
    return `unsupported social format: ${proposal.format}`;
  }

  if (proposal.format === "x-thread") {
    const posts = proposal.threadPosts?.map((post) => post.trim()).filter(Boolean) ?? [];
    if (posts.length < 5 || posts.length > 7) return "X thread must contain 5–7 posts";
    if (posts.some((post) => socialCharacterCount(post) > SOCIAL_LIMITS["x-thread"]!)) return "X post exceeds 280 characters";
    if (hashtagCount(posts.join("\n")) > 2) return "X thread contains more than 2 hashtags";
    return null;
  }

  const limit = SOCIAL_LIMITS[proposal.format];
  if (limit && socialCharacterCount(proposal.content) > limit) return `${proposal.format} exceeds ${limit} characters`;
  const hashtagLimit = proposal.format === "linkedin-post" ? 3 : 2;
  return hashtagCount(proposal.content) > hashtagLimit ? `${proposal.format} contains too many hashtags` : null;
}

/**
 * Sanitizes model output and rejects incomplete, duplicate, or platform-invalid
 * social drafts instead of showing content that cannot actually be published.
 */
export function normalizeSocialProposals(entries: unknown): GoalProposal[] {
  if (!Array.isArray(entries)) return [];
  const proposals: GoalProposal[] = [];
  const seenFormats = new Set<string>();
  const seenContent = new Set<string>();

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const format = String(entry.format ?? "") as GoalProposalFormat;
    const posts = format === "x-thread" && Array.isArray(entry.threadPosts)
      ? entry.threadPosts.map((post) => String(post).trim()).filter(Boolean).slice(0, 7)
      : undefined;
    const content = format === "x-thread" && posts?.length
      ? posts.join("\n\n---\n\n")
      : String(entry.content ?? "").trim();
    const proposal: GoalProposal = {
      title: String(entry.title ?? "").trim(),
      format,
      summary: String(entry.summary ?? "").trim(),
      content,
      threadPosts: posts,
      mediaSuggestions: normalizeMediaSuggestions(entry.mediaSuggestions),
    };
    const fingerprint = content.toLocaleLowerCase();
    if (seenFormats.has(format) || seenContent.has(fingerprint) || socialProposalIssue(proposal)) continue;
    seenFormats.add(format);
    seenContent.add(fingerprint);
    proposals.push(proposal);
  }
  return proposals;
}

export function hasCompleteSocialSet(proposals: GoalProposal[]): boolean {
  return SOCIAL_PROPOSAL_FORMATS.every((format) => proposals.some((proposal) => proposal.format === format));
}
