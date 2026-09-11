import type { GrowthContentChannel, GrowthContentMedia } from "../../types/growth";
import type { GoalMediaSuggestion, GoalProposalFormat } from "../../types/goals";

export function normalizeLegacySuggestionTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function createLegacySuggestionDedupeKey(
  repository: string,
  goalId: string,
  title: string,
): string {
  return `${repository}:${goalId}:${normalizeLegacySuggestionTitle(title)}`;
}

export function legacyProposalChannel(format: GoalProposalFormat): GrowthContentChannel {
  if (format === "x-thread") return "x";
  if (format === "linkedin-post") return "linkedin";
  if (format === "mastodon-post") return "mastodon";
  return "other";
}

export function legacyMediaToContentMedia(
  mediaSuggestions: GoalMediaSuggestion[] | undefined,
): GrowthContentMedia[] {
  return (mediaSuggestions ?? []).map((media) => ({
    kind: media.kind,
    url: media.sourceUrl,
    alt: media.title,
    caption: media.guidance,
  }));
}
