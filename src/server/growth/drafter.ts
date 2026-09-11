import type {
  GrowthContentItem,
  GrowthContentMedia,
  GrowthProfile,
} from "../../types/growth";
import {
  buildFallbackGrowthDraft,
  normalizeGeneratedGrowthDraft,
  type GrowthDraftCopy,
} from "../../utils/growth/contentDraft";
import {
  growthContentMediaFromCandidate,
  normalizeGrowthDraftMedia,
  normalizeGrowthMediaCandidates,
  type GrowthMediaCandidate,
} from "../../utils/growth/mediaCandidates";
import { AiNotConfiguredError, AiRequestError, generateStructured } from "../ai/client";
import { isAiConfigured } from "../ai/settings";
import {
  getContentItem,
  getGrowthProfile,
  listGrowthAssets,
  updateContentItem,
} from "./store";
import { collectRepositorySignals, type GrowthRepositorySignals } from "./signals";

export const GROWTH_DRAFTER_GENERATION_VERSION = 1;

export class GrowthContentDraftConflictError extends Error {
  constructor() {
    super("Only idea or draft content can be drafted.");
    this.name = "GrowthContentDraftConflictError";
  }
}

export interface GrowthContentDraftResult {
  contentItem: GrowthContentItem;
  aiEnabled: boolean;
  usedFallback: boolean;
  cached: boolean;
  mediaRequired: boolean;
}

interface DrafterAnswer {
  title?: unknown;
  body?: unknown;
  threadPosts?: unknown;
  sources?: unknown;
  media?: unknown;
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

function additionalSourceUrls(sources: readonly unknown[]): string[] {
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return [];
    const entry = source as Record<string, unknown>;
    const values: unknown[] = [entry.url];
    if (typeof entry.repository === "string") values.push(`https://github.com/${entry.repository}`);
    if (Array.isArray(entry.releases)) {
      for (const release of entry.releases) {
        if (release && typeof release === "object" && !Array.isArray(release)) {
          values.push((release as Record<string, unknown>).url);
        }
      }
    }
    return values.flatMap((value) => {
      const url = normalizeHttpUrl(value);
      return url ? [url] : [];
    });
  });
}

function verifiedSourceUrls(
  item: GrowthContentItem,
  signals: GrowthRepositorySignals,
  mediaCandidates: readonly GrowthMediaCandidate[],
): string[] {
  const values: unknown[] = [
    ...item.sources,
    signals.repositoryMetadata?.url,
    ...signals.openIssues.map((issue) => issue.url),
    ...signals.openPullRequests.map((pullRequest) => pullRequest.url),
    ...signals.releases.map((release) => release.html_url),
    ...signals.recentCommits.map((commit) => commit.html_url),
    ...additionalSourceUrls(signals.additionalSources),
    ...mediaCandidates.map((candidate) => candidate.url),
  ];
  const result: string[] = [];
  for (const value of values) {
    const url = normalizeHttpUrl(value);
    if (url && !result.includes(url)) result.push(url);
  }
  return result;
}

function normalizedSources(value: unknown, allowedSources: readonly string[], fallback: readonly string[]): string[] {
  const allowed = new Set(allowedSources);
  const selected: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = normalizeHttpUrl(entry);
      if (url && allowed.has(url) && !selected.includes(url)) selected.push(url);
    }
  }
  if (selected.length > 0) return selected;
  return fallback.flatMap((entry) => {
    const url = normalizeHttpUrl(entry);
    return url && allowed.has(url) ? [url] : [];
  }).filter((url, index, entries) => entries.indexOf(url) === index);
}

function compactText(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function verifiedFacts(signals: GrowthRepositorySignals): string[] {
  const facts: string[] = [];
  if (signals.repositoryMetadata?.description) {
    facts.push(`Repository description: ${compactText(signals.repositoryMetadata.description, 300)}`);
  }
  const release = signals.releases[0];
  if (release) {
    const name = compactText(release.name || release.tag_name || "a published release", 160);
    facts.push(`The repository lists ${name} in its releases.`);
  }
  const commit = signals.recentCommits[0];
  if (commit?.commit.message) {
    facts.push(`A recent repository commit is titled “${compactText(commit.commit.message.split("\n")[0], 180)}”.`);
  }
  if (signals.readme?.excerpt) {
    facts.push(`README excerpt: ${compactText(signals.readme.excerpt, 280)}`);
  }
  const goal = signals.goals[0];
  if (goal) facts.push(`A tracked ${goal.metric} mission records ${goal.current} of ${goal.target}.`);
  return facts;
}

function promptContext(
  item: GrowthContentItem,
  profile: GrowthProfile,
  signals: GrowthRepositorySignals,
  mediaCandidates: readonly GrowthMediaCandidate[],
  allowedSources: readonly string[],
): Record<string, unknown> {
  return {
    generatedOn: signals.generatedOn,
    repository: item.repository,
    slot: {
      channel: item.channel,
      format: item.format,
      angle: item.angle,
      pillar: item.pillar,
      cta: item.summary,
      sources: item.sources,
    },
    profile: {
      language: profile.language,
      voice: profile.voice,
      audience: profile.audience,
      hashtags: profile.hashtags,
      avoid: profile.avoid,
    },
    repositoryMetadata: signals.repositoryMetadata ? {
      description: signals.repositoryMetadata.description,
      primaryLanguage: signals.repositoryMetadata.primaryLanguage?.name ?? null,
      stars: signals.repositoryMetadata.stargazerCount,
      forks: signals.repositoryMetadata.forkCount,
      url: signals.repositoryMetadata.url,
    } : null,
    releases: signals.releases.map((release) => ({
      name: release.name || release.tag_name || null,
      url: release.html_url ?? null,
      publishedAt: release.published_at ?? null,
      notesExcerpt: release.body ? compactText(release.body, 500) : null,
    })),
    recentCommits: signals.recentCommits.slice(0, 10).map((commit) => ({
      message: commit.commit.message.split("\n")[0],
      url: commit.html_url,
      authoredAt: commit.commit.author?.date ?? null,
    })),
    openIssues: signals.openIssues.slice(0, 10).map((issue) => ({ title: issue.title, url: issue.url })),
    openPullRequests: signals.openPullRequests.slice(0, 6).map((pullRequest) => ({
      title: pullRequest.title,
      url: pullRequest.url,
      isDraft: pullRequest.isDraft,
    })),
    readmeExcerpt: signals.readme?.excerpt ?? null,
    goals: signals.goals,
    additionalSources: signals.additionalSources,
    allowedSources,
    mediaCandidates: mediaCandidates.map((candidate) => ({
      candidateKey: candidate.key,
      kind: candidate.kind,
      label: candidate.label,
      existingAlt: candidate.alt,
    })),
  };
}

async function requestDraft(
  item: GrowthContentItem,
  profile: GrowthProfile,
  signals: GrowthRepositorySignals,
  mediaCandidates: readonly GrowthMediaCandidate[],
  allowedSources: readonly string[],
): Promise<DrafterAnswer> {
  const result = await generateStructured<DrafterAnswer>({
    instructions: [
      "Draft one publishable, evidence-grounded open-source content item for the exact supplied format and profile language.",
      "Use only facts in verifiedSignals, preserve the requested angle, pillar and CTA, and do not describe unfinished issue or pull-request work as shipped.",
      "Follow the profile voice, audience, hashtags and avoid list.",
      "For x-thread return 5–7 ordered posts of at most 280 Unicode characters and at most two hashtags across the thread. For linkedin-post stay within 3000 characters and three hashtags. For mastodon-post stay within 500 characters and two hashtags.",
      "Cite only URLs in allowedSources. Select media only by candidateKey from mediaCandidates, write useful non-empty alt text, and never create a media URL.",
      "Return JSON only.",
    ].join(" "),
    input: JSON.stringify({
      format: item.format,
      verifiedSignals: promptContext(item, profile, signals, mediaCandidates, allowedSources),
    }),
    schemaName: "growth_content_draft",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        threadPosts: { type: "array", minItems: 0, maxItems: 7, items: { type: "string", maxLength: 3000 } },
        sources: { type: "array", items: { type: "string", format: "uri" } },
        media: {
          type: "array",
          minItems: 0,
          maxItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              candidateKey: { type: "string" },
              alt: { type: "string" },
              caption: { type: "string" },
            },
            required: ["candidateKey", "alt", "caption"],
          },
        },
      },
      required: ["title", "body", "threadPosts", "sources", "media"],
    },
    maxOutputTokens: item.format === "x-thread" ? 2_400 : 1_800,
  });
  return result.data;
}

function fallbackDraft(
  item: GrowthContentItem,
  profile: GrowthProfile,
  signals: GrowthRepositorySignals,
): GrowthDraftCopy {
  return buildFallbackGrowthDraft({
    repository: item.repository,
    format: item.format,
    angle: item.angle,
    cta: item.summary,
    audience: profile.audience,
    hashtags: profile.hashtags,
    facts: verifiedFacts(signals),
    repositoryUrl: normalizeHttpUrl(signals.repositoryMetadata?.url)
      ?? `https://github.com/${item.repository}`,
  });
}

/** Drafts one account-scoped planned item in place without changing protected content. */
export async function draftGrowthContentItem(
  accountId: string,
  id: string,
  options: { refresh?: boolean } = {},
): Promise<GrowthContentDraftResult | null> {
  const item = getContentItem(accountId, id);
  if (!item) return null;
  if (item.status !== "idea" && item.status !== "draft") throw new GrowthContentDraftConflictError();
  if (!options.refresh && item.status === "draft" && item.generatedAt !== null && item.body.trim()) {
    return {
      contentItem: item,
      aiEnabled: isAiConfigured(),
      usedFallback: false,
      cached: true,
      mediaRequired: item.media.length === 0,
    };
  }

  const profile = getGrowthProfile(accountId, item.repository);
  const [signals, assets] = await Promise.all([
    collectRepositorySignals(accountId, item.repository),
    Promise.resolve(listGrowthAssets(accountId, item.repository)),
  ]);
  const mediaCandidates = normalizeGrowthMediaCandidates({
    repository: item.repository,
    assets,
    readmeMediaUrls: signals.readme?.mediaUrls,
    additionalSources: signals.additionalSources,
  });
  const allowedSources = verifiedSourceUrls(item, signals, mediaCandidates);
  let aiEnabled = isAiConfigured();
  let usedFallback = !aiEnabled;
  let copy: GrowthDraftCopy;
  let answer: DrafterAnswer | null = null;

  if (aiEnabled) {
    try {
      answer = await requestDraft(item, profile, signals, mediaCandidates, allowedSources);
      const normalized = normalizeGeneratedGrowthDraft(item.format, item.summary, answer);
      if (!normalized.draft) throw new AiRequestError(`AI returned a platform-invalid draft: ${normalized.issue}`);
      copy = normalized.draft;
    } catch (error) {
      if (!(error instanceof AiNotConfiguredError)) throw error;
      aiEnabled = false;
      usedFallback = true;
      copy = fallbackDraft(item, profile, signals);
    }
  } else {
    copy = fallbackDraft(item, profile, signals);
  }

  let media: GrowthContentMedia[] = normalizeGrowthDraftMedia(answer?.media, mediaCandidates);
  if (media.length === 0 && mediaCandidates.length > 0) {
    media = [growthContentMediaFromCandidate(mediaCandidates[0])];
  }
  const sources = normalizedSources(answer?.sources, allowedSources, item.sources);
  const contentItem = updateContentItem(accountId, item.id, {
    title: copy.title,
    body: copy.body,
    threadPosts: copy.threadPosts,
    media,
    sources,
    status: "draft",
    generatedAt: new Date().toISOString(),
    generationVersion: GROWTH_DRAFTER_GENERATION_VERSION,
  });
  if (!contentItem) return null;
  return {
    contentItem,
    aiEnabled,
    usedFallback,
    cached: false,
    mediaRequired: contentItem.media.length === 0,
  };
}
