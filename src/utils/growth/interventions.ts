import type { GrowthInterventionCategory } from "../../types/growth";
import { normalizeLegacySuggestionTitle } from "./legacySuggestions";

/** Stable identity for one repository backlog action, independent of mutable copy. */
export function createGrowthInterventionDedupeKey(
  repository: string,
  goalId: string | null,
  category: GrowthInterventionCategory,
  title: string,
): string {
  return [
    repository,
    goalId ?? "repository",
    category,
    normalizeLegacySuggestionTitle(title),
  ].join(":");
}
