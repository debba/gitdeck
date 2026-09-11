import type { GoalProposal, RepositoryGoal } from "../types/goals";

export interface RepositoryGoalGroup {
  repository: string;
  goals: RepositoryGoal[];
}

/** Groups goals without changing repository or goal insertion order. */
export function groupGoalsByRepository(goals: RepositoryGoal[]): RepositoryGoalGroup[] {
  const groups = new Map<string, RepositoryGoal[]>();
  for (const goal of goals) {
    const current = groups.get(goal.repository);
    if (current) current.push(goal);
    else groups.set(goal.repository, [goal]);
  }
  return [...groups].map(([repository, repositoryGoals]) => ({ repository, goals: repositoryGoals }));
}

export interface GoalProgress {
  percentage: number;
  remaining: number;
  daysRemaining: number;
  completed: boolean;
  overdue: boolean;
}

/** Produces a copy-ready thread while keeping each X post visibly separated. */
export function formatXThreadForCopy(proposal: Pick<GoalProposal, "content" | "threadPosts">): string {
  const posts = proposal.threadPosts?.map((post) => post.trim()).filter(Boolean) ?? [];
  return posts.length ? posts.join("\n\n---\n\n") : proposal.content.trim();
}

export function calculateGoalProgress(
  goal: Pick<RepositoryGoal, "currentValue" | "targetValue" | "deadline">,
  now = new Date(),
): GoalProgress {
  const target = Math.max(1, goal.targetValue);
  const percentage = Math.min(100, Math.max(0, Math.round((goal.currentValue / target) * 100)));
  const completed = goal.currentValue >= goal.targetValue;
  const deadline = new Date(`${goal.deadline}T23:59:59.999Z`).getTime();
  const daysRemaining = Math.max(0, Math.ceil((deadline - now.getTime()) / 86_400_000));
  return {
    percentage,
    remaining: Math.max(0, goal.targetValue - goal.currentValue),
    daysRemaining,
    completed,
    overdue: !completed && deadline < now.getTime(),
  };
}
