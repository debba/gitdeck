import { describe, expect, it } from "vitest";
import type { RepositoryGoal } from "../../src/types/goals";
import { buildGrowthWorkspaceGoalSummary } from "../../src/utils/growthWorkspace";

function goal(id: string, currentValue: number, targetValue: number, deadline: string): RepositoryGoal {
  return {
    id,
    accountId: "account-a",
    repository: "acme/rocket",
    metric: "stars",
    targetValue,
    currentValue,
    deadline,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    suggestions: [],
    suggestionsGeneratedAt: null,
    aiEnabled: true,
  };
}

describe("buildGrowthWorkspaceGoalSummary", () => {
  it("returns an empty summary for a workspace without missions", () => {
    expect(buildGrowthWorkspaceGoalSummary([], new Date("2026-09-04T00:00:00.000Z"))).toEqual({
      goals: [],
      completed: 0,
      overdue: 0,
    });
  });

  it("reuses bounded goal progress and counts completed and overdue missions", () => {
    const summary = buildGrowthWorkspaceGoalSummary([
      goal("active", 4, 10, "2026-09-10"),
      goal("complete", 12, 10, "2026-09-01"),
      goal("overdue", 2, 10, "2026-09-03"),
    ], new Date("2026-09-04T00:00:00.000Z"));

    expect(summary.completed).toBe(1);
    expect(summary.overdue).toBe(1);
    expect(summary.goals.map(({ progress }) => progress.percentage)).toEqual([40, 100, 20]);
  });
});
