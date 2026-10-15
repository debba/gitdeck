import type { CreateGrowthContentItemInput, GrowthContentItem } from "../../types/growth";

export const EVERGREEN_RECYCLE_AGE_DAYS = 60;
export const EVERGREEN_RULE_PREFIX = "evergreen:";
const DAY_MS = 86_400_000;

function parseIsoDateTime(value: string | null): number | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!calendar) return null;
  const year = Number(calendar[1]);
  const month = Number(calendar[2]);
  const day = Number(calendar[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Returns the stable opportunity identity for one persisted content item. */
export function createEvergreenRuleKey(contentId: string): string | null {
  const normalized = contentId.trim();
  return normalized && !normalized.includes(":") ? `${EVERGREEN_RULE_PREFIX}${normalized}` : null;
}

/** Resolves a content ID only from the exact stable evergreen rule-key shape. */
export function contentIdFromEvergreenRuleKey(ruleKey: string | null): string | null {
  if (ruleKey === null || !ruleKey.startsWith(EVERGREEN_RULE_PREFIX)) return null;
  const contentId = ruleKey.slice(EVERGREEN_RULE_PREFIX.length);
  return contentId && !contentId.includes(":") && contentId === contentId.trim() ? contentId : null;
}

/** Checks recycling eligibility against an injected clock and fails closed for invalid dates. */
export function isEvergreenContentEligible(item: GrowthContentItem, now: Date): boolean {
  const currentTime = now.getTime();
  const publishedAt = parseIsoDateTime(item.publishedAt);
  return Number.isFinite(currentTime)
    && item.status === "published"
    && item.evergreen === 1
    && publishedAt !== null
    && currentTime - publishedAt >= EVERGREEN_RECYCLE_AGE_DAYS * DAY_MS;
}

/** Builds the deliberately blank idea that must pass through drafting and media review again. */
export function buildEvergreenIdeaInput(
  source: GrowthContentItem,
  interventionId: string,
): CreateGrowthContentItemInput {
  return {
    accountId: source.accountId,
    repository: source.repository,
    planId: null,
    interventionId,
    goalIds: [...source.goalIds],
    channel: source.channel,
    format: source.format,
    pillar: source.pillar,
    angle: "",
    title: "",
    summary: "",
    body: "",
    threadPosts: [],
    media: [],
    sources: [...source.sources],
    status: "idea",
    scheduledFor: null,
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
  };
}
