import type {
  GrowthReviewFilters,
  GrowthWeeklyReview,
} from "../../types/growth";
import {
  buildGrowthWeeklyReview,
  buildUtcIsoReviewWeekRanges,
} from "../../utils/growth/weeklyReview";
import { generateStructured } from "../ai/client";
import { isAiConfigured } from "../ai/settings";
import { getGrowthPerformanceSummary } from "./performance";
import {
  listContentItems,
  listContentPerformance,
  listGrowthInterventions,
} from "./store";

interface ReviewNarrativeAnswer {
  narrative?: string;
}

const MAX_AI_NARRATIVE_LENGTH = 900;

function narrativeInput(review: GrowthWeeklyReview): string {
  return JSON.stringify({
    scope: review.repository ?? "all repositories",
    reviewPeriod: review.reviewPeriod,
    upcomingPeriod: review.upcomingPeriod,
    publishedItems: review.publishedItems.map((item) => ({
      repository: item.repository,
      title: item.title,
      channel: item.channel,
      pillar: item.pillar,
      performance: item.performance,
    })),
    missedItems: review.missedItems.map((item) => ({
      repository: item.repository,
      title: item.title,
      scheduledFor: item.scheduledFor,
    })),
    upcomingItems: review.upcomingItems.map((item) => ({
      repository: item.repository,
      title: item.title,
      scheduledFor: item.scheduledFor,
    })),
    performance: review.performance,
    channelFindings: review.channelFindings,
    pillarFindings: review.pillarFindings,
    deterministicNarrative: review.narrative,
  });
}

async function generateReviewNarrative(review: GrowthWeeklyReview): Promise<string | null> {
  const result = await generateStructured<ReviewNarrativeAnswer>({
    instructions: [
      "Write one concise weekly Growth Review narrative using only the supplied facts.",
      "Do not add, estimate, combine, or reinterpret metric values; keep 48-hour and 7-day windows separate.",
      "Mention useful outcomes, misses, and the upcoming week without adding recommendations.",
      "Return JSON only with a narrative string no longer than 900 characters.",
    ].join(" "),
    input: narrativeInput(review),
    schemaName: "growth_weekly_review_narrative",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { narrative: { type: "string", maxLength: 900 } },
      required: ["narrative"],
    },
    maxOutputTokens: 400,
  });
  const narrative = typeof result.data?.narrative === "string"
    ? result.data.narrative.replace(/\s+/g, " ").trim()
    : "";
  return narrative && narrative.length <= MAX_AI_NARRATIVE_LENGTH ? narrative : null;
}

/** Builds a read-only repository or account-wide review from persisted Growth Studio data. */
export async function getGrowthWeeklyReview(
  accountId: string,
  filters: GrowthReviewFilters = {},
  clock: () => Date = () => new Date(),
): Promise<GrowthWeeklyReview> {
  const now = clock();
  const fixedClock = () => new Date(now.getTime());
  const ranges = buildUtcIsoReviewWeekRanges(fixedClock);
  const contentItems = listContentItems(accountId, { repository: filters.repository });
  const interventions = listGrowthInterventions(accountId, { repository: filters.repository });
  const performanceRows = listContentPerformance(accountId, { repository: filters.repository });
  const deterministic = buildGrowthWeeklyReview({
    repository: filters.repository,
    contentItems,
    performanceRows,
    performanceSummary: getGrowthPerformanceSummary(accountId, {
      repository: filters.repository,
      from: ranges.reviewPeriod.start,
      to: ranges.reviewPeriod.end,
    }),
    interventions,
  }, fixedClock);
  const aiEnabled = isAiConfigured();
  if (!aiEnabled) return { ...deterministic, aiEnabled: false, usedFallback: true };

  try {
    const narrative = await generateReviewNarrative(deterministic);
    if (!narrative) return { ...deterministic, aiEnabled: true, usedFallback: true };
    return { ...deterministic, narrative, aiEnabled: true, usedFallback: false };
  } catch {
    return { ...deterministic, aiEnabled: true, usedFallback: true };
  }
}
