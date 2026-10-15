import type { RepositoryGoal } from "../types/goals";
import { calculateGoalProgress, type GoalProgress } from "./goals";

export interface GrowthWorkspaceGoalProgress {
  goal: RepositoryGoal;
  progress: GoalProgress;
}

export interface GrowthWorkspaceGoalSummary {
  goals: GrowthWorkspaceGoalProgress[];
  completed: number;
  overdue: number;
}

/** Summarizes mission progress for one repository workspace. */
export function buildGrowthWorkspaceGoalSummary(
  goals: RepositoryGoal[],
  now = new Date(),
): GrowthWorkspaceGoalSummary {
  const summarizedGoals = goals.map((goal) => ({
    goal,
    progress: calculateGoalProgress(goal, now),
  }));

  return {
    goals: summarizedGoals,
    completed: summarizedGoals.filter(({ progress }) => progress.completed).length,
    overdue: summarizedGoals.filter(({ progress }) => progress.overdue).length,
  };
}
