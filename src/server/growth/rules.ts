import type { GrowthIntervention } from "../../types/growth";
import { detectGrowthOpportunities } from "../../utils/growth/opportunityRules";
import { collectRepositorySignals } from "./signals";
import {
  listContentItems,
  upsertGrowthRuleIntervention,
} from "./store";

export interface GrowthOpportunityScanResult {
  interventions: GrowthIntervention[];
  scannedAt: string;
}

/** Collects server-side forge signals and persists the currently detected rule opportunities. */
export async function scanRepositoryGrowthOpportunities(
  accountId: string,
  repository: string,
  now = new Date(),
): Promise<GrowthOpportunityScanResult> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid scan time");
  const signals = await collectRepositorySignals(accountId, repository);
  const contentItems = listContentItems(accountId, { repository });
  const detected = detectGrowthOpportunities({
    now,
    repository,
    stars: signals.repositoryMetadata?.stargazerCount ?? null,
    releases: signals.releases.map((release) => ({
      name: release.name,
      tagName: release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
    })),
    openIssues: signals.openIssues,
    mergedPullRequests: signals.mergedPullRequests,
    goals: signals.goals,
    contentItems,
  });
  const interventions = detected.map((candidate) => upsertGrowthRuleIntervention({
    accountId,
    repository,
    goalId: candidate.goalId,
    category: candidate.category,
    title: candidate.title,
    action: candidate.action,
    ruleKey: candidate.ruleKey,
  }));
  return { interventions, scannedAt: now.toISOString() };
}
