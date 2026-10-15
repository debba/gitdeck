import type { GhRepo } from "../types/github";
import {
  GROWTH_CONTENT_ITEM_STATUSES,
  GROWTH_INTERVENTION_STATUSES,
  type GrowthWorkspaceSummary,
} from "../types/growth";
import type { RepositoryGoal } from "../types/goals";
import { growthProfileColor } from "./growth/profileDefaults";
import { calculateGoalProgress, groupGoalsByRepository } from "./goals";

export interface GrowthHomeWorkspace extends GrowthWorkspaceSummary {
  repo: GhRepo | null;
  goals: RepositoryGoal[];
  completedGoals: number;
}

export interface GrowthHomeWorkflowTotals {
  proposedInterventions: number;
  acceptedInterventions: number;
  draftContent: number;
  readyContent: number;
  nextSevenDays: number;
}

export interface GrowthHomeSummary {
  workspaces: GrowthHomeWorkspace[];
  starterRepositories: GhRepo[];
  totalGoals: number;
  completedGoals: number;
  workflowTotals: GrowthHomeWorkflowTotals;
}

function fallbackWorkspaceSummary(repository: string): GrowthWorkspaceSummary {
  return {
    repository,
    color: growthProfileColor(repository),
    interventionsByStatus: Object.fromEntries(
      GROWTH_INTERVENTION_STATUSES.map((status) => [status, 0]),
    ) as GrowthWorkspaceSummary["interventionsByStatus"],
    contentItemsByStatus: Object.fromEntries(
      GROWTH_CONTENT_ITEM_STATUSES.map((status) => [status, 0]),
    ) as GrowthWorkspaceSummary["contentItemsByStatus"],
    nextSevenDays: [],
  };
}

/** Builds deterministic account-wide home cards while preserving unavailable repository identities. */
export function buildGrowthHomeSummary(
  goals: RepositoryGoal[],
  repositories: GhRepo[],
  workspaceSummaries: GrowthWorkspaceSummary[] = [],
): GrowthHomeSummary {
  const repositoriesByName = new Map(repositories.map((repo) => [repo.nameWithOwner, repo]));
  const goalGroups = groupGoalsByRepository(goals);
  const goalsByRepository = new Map(goalGroups.map((group) => [group.repository, group.goals]));
  const summariesByRepository = new Map(
    workspaceSummaries.map((summary) => [summary.repository, summary]),
  );
  const representedRepositories = new Set([
    ...summariesByRepository.keys(),
    ...goalGroups.map((group) => group.repository),
  ]);
  const workspaces = [...representedRepositories]
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .map((repository) => {
      const repositoryGoals = goalsByRepository.get(repository) ?? [];
      return {
        ...(summariesByRepository.get(repository) ?? fallbackWorkspaceSummary(repository)),
        repo: repositoriesByName.get(repository) ?? null,
        goals: repositoryGoals,
        completedGoals: repositoryGoals.filter((goal) => calculateGoalProgress(goal).completed).length,
      };
    });
  const workflowTotals = workspaces.reduce<GrowthHomeWorkflowTotals>((totals, workspace) => ({
    proposedInterventions: totals.proposedInterventions + workspace.interventionsByStatus.proposed,
    acceptedInterventions: totals.acceptedInterventions + workspace.interventionsByStatus.accepted,
    draftContent: totals.draftContent + workspace.contentItemsByStatus.draft,
    readyContent: totals.readyContent + workspace.contentItemsByStatus.ready,
    nextSevenDays: totals.nextSevenDays + workspace.nextSevenDays.length,
  }), {
    proposedInterventions: 0,
    acceptedInterventions: 0,
    draftContent: 0,
    readyContent: 0,
    nextSevenDays: 0,
  });

  return {
    workspaces,
    starterRepositories: repositories.filter((repo) => !representedRepositories.has(repo.nameWithOwner)),
    totalGoals: goals.length,
    completedGoals: workspaces.reduce((total, workspace) => total + workspace.completedGoals, 0),
    workflowTotals,
  };
}
