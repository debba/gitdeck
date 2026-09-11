import { describe, expect, it } from "vitest";
import { calculateGoalProgress, formatXThreadForCopy, groupGoalsByRepository } from "../../src/utils/goals";
import type { RepositoryGoal } from "../../src/types/goals";

describe("groupGoalsByRepository", () => {
  it("combines goals for the same repository while preserving order", () => {
    const goal = (id: string, repository: string) => ({ id, repository }) as RepositoryGoal;
    const groups = groupGoalsByRepository([
      goal("stars", "acme/rocket"),
      goal("forks", "other/tool"),
      goal("downloads", "acme/rocket"),
    ]);

    expect(groups.map((group) => group.repository)).toEqual(["acme/rocket", "other/tool"]);
    expect(groups[0].goals.map((entry) => entry.id)).toEqual(["stars", "downloads"]);
  });
});

describe("formatXThreadForCopy", () => {
  it("joins complete X posts with a visible separator", () => {
    expect(formatXThreadForCopy({ content: "fallback", threadPosts: [" First post ", "Second post"] }))
      .toBe("First post\n\n---\n\nSecond post");
  });

  it("uses legacy content when structured posts are absent", () => {
    expect(formatXThreadForCopy({ content: " Legacy thread ", threadPosts: [] })).toBe("Legacy thread");
  });
});

describe("calculateGoalProgress", () => {
  it("calculates bounded progress and remaining time", () => {
    expect(calculateGoalProgress(
      { currentValue: 75, targetValue: 100, deadline: "2026-02-10" },
      new Date("2026-02-08T12:00:00Z"),
    )).toEqual({ percentage: 75, remaining: 25, daysRemaining: 3, completed: false, overdue: false });
  });

  it("marks completed goals and caps progress", () => {
    const result = calculateGoalProgress(
      { currentValue: 120, targetValue: 100, deadline: "2020-01-01" },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result).toMatchObject({ percentage: 100, remaining: 0, completed: true, overdue: false });
  });

  it("marks unfinished goals past their deadline as overdue", () => {
    const result = calculateGoalProgress(
      { currentValue: 2, targetValue: 10, deadline: "2025-12-31" },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.overdue).toBe(true);
    expect(result.daysRemaining).toBe(0);
  });
});
