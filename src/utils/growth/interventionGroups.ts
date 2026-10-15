import type { GrowthContentItem, GrowthIntervention } from "../../types/growth";
import { INTERVENTION_DESTINATIONS } from "../../types/goals";
import { contentIdFromEvergreenRuleKey } from "./evergreen";

export const GROWTH_INTERVENTION_GROUPS = INTERVENTION_DESTINATIONS;
export type GrowthInterventionGroupId = typeof GROWTH_INTERVENTION_GROUPS[number];

export interface GrowthInterventionGroup {
  id: GrowthInterventionGroupId;
  interventions: GrowthIntervention[];
}

function groupFromText(text: string): GrowthInterventionGroupId | null {
  const community = /\b(?:reddit|subreddit|hacker\s*news|lobste(?:rs|r)(?:\.rs)?|show\s+hn|ask\s+hn|hn|forum|discord|discourse|communities|community|comunit[aà]|discussions?|discussioni)\b/i.test(text);
  const social = /\b(?:socials?|linkedin|mastodon|bluesky|twitter|tweets?|instagram|facebook|tiktok)\b|\bx\.com\b|\b(?:on|to|su)\s+x\b|\bx\s+(?:post|campaign|thread)\b/i.test(text);
  if (/^(?:share|promote|submit|cross[ -]post|condividi|condividere|promuovi|proponi)\b/i.test(text.trim())) {
    if (community) return "communities";
    if (social) return "social";
  }
  if (/\b(?:blog|markdown|long[ -]form|deep[ -]dive|technical article|articol[oi] tecnic[oi]|approfondiment[oi])\b/i.test(text)
    || /\b(?:write|draft|publish|scrivi|scrivere|pubblica|pubblicare)\s+(?:(?:a|an|un|una|un[’'])\s*)?(?:article|articolo|tutorial)\b/i.test(text)) return "blog";
  if (community) return "communities";
  if (social) return "social";
  return null;
}

function groupFromContent(item: GrowthContentItem): GrowthInterventionGroupId | null {
  if (item.channel === "blog") return "blog";
  if (item.channel === "discussion") return "communities";
  if (["x", "linkedin", "mastodon", "bluesky"].includes(item.channel)) return "social";
  if (item.format === "discussion") return "communities";
  if (["x-thread", "linkedin-post", "mastodon-post", "post"].includes(item.format)) return "social";
  return null;
}

/** Assigns each existing intervention once, without relabeling its category or changing saved data. */
export function growthInterventionGroup(
  intervention: GrowthIntervention,
  contentItems: readonly GrowthContentItem[],
): GrowthInterventionGroupId {
  const ownedContent = contentItems.filter((item) => item.accountId === intervention.accountId
    && item.repository === intervention.repository);
  const evergreenId = intervention.origin === "rule" ? contentIdFromEvergreenRuleKey(intervention.ruleKey) : null;
  const evergreen = evergreenId ? ownedContent.find((item) => item.id === evergreenId) : undefined;
  if (evergreen) {
    const group = groupFromContent(evergreen);
    if (group) return group;
  }

  if (intervention.destination) return intervention.destination;

  // The main deliverable in the title takes priority over its distribution destinations in the action.
  const intendedGroup = groupFromText(intervention.title) ?? groupFromText(intervention.action);
  if (intendedGroup) return intendedGroup;
  const linkedGroups = new Set(ownedContent.filter((item) => item.interventionId === intervention.id).map(groupFromContent));
  for (const group of GROWTH_INTERVENTION_GROUPS) {
    if (linkedGroups.has(group)) return group;
  }
  if (intervention.category === "community") return "communities";
  if (intervention.ruleKey?.startsWith("release:") || intervention.ruleKey?.startsWith("star-milestone:")) return "social";
  return "other";
}

export function groupGrowthInterventions(
  interventions: readonly GrowthIntervention[],
  contentItems: readonly GrowthContentItem[],
): GrowthInterventionGroup[] {
  const groups = GROWTH_INTERVENTION_GROUPS.map((id): GrowthInterventionGroup => ({ id, interventions: [] }));
  for (const intervention of interventions) {
    const group = growthInterventionGroup(intervention, contentItems);
    groups.find(({ id }) => id === group)!.interventions.push(intervention);
  }
  return groups;
}
