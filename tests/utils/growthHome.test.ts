import { describe, expect, it } from "vitest";
import type { GhRepo } from "../../src/types/github";
import type { GrowthContentItem, GrowthWorkspaceSummary } from "../../src/types/growth";
import type { RepositoryGoal } from "../../src/types/goals";
import { growthProfileColor } from "../../src/utils/growth/profileDefaults";
import { buildGrowthHomeSummary } from "../../src/utils/growthHome";

function repo(nameWithOwner: string): GhRepo {
  const [owner, name] = nameWithOwner.split("/");
  return {
    nameWithOwner,
    name,
    owner: { login: owner },
    description: `${name} description`,
    stargazerCount: 10,
    forkCount: 2,
    primaryLanguage: null,
    updatedAt: "2026-09-04T00:00:00.000Z",
    pushedAt: "2026-09-04T00:00:00.000Z",
    visibility: "PUBLIC",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    url: `https://github.com/${nameWithOwner}`,
  };
}

function goal(id: string, repository: string, currentValue: number, targetValue = 10): RepositoryGoal {
  return {
    id,
    accountId: "account-a",
    repository,
    metric: "stars",
    targetValue,
    currentValue,
    deadline: "2026-12-31",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    suggestions: [],
    suggestionsGeneratedAt: null,
    aiEnabled: true,
  };
}

function workspace(
  repository: string,
  overrides: Partial<GrowthWorkspaceSummary> = {},
): GrowthWorkspaceSummary {
  return {
    repository,
    color: "#2563EB",
    interventionsByStatus: { proposed: 0, accepted: 0, dismissed: 0, done: 0 },
    contentItemsByStatus: { idea: 0, draft: 0, ready: 0, scheduled: 0, published: 0, skipped: 0 },
    nextSevenDays: [],
    ...overrides,
  };
}

describe("buildGrowthHomeSummary", () => {
  it("retains workspace summaries, totals account workflow, and excludes represented repositories", () => {
    const active = repo("acme/active");
    const profileOnly = repo("acme/profile-only");
    const starter = repo("acme/starter");
    const upcoming = [{} as GrowthContentItem, {} as GrowthContentItem];
    const summary = buildGrowthHomeSummary([
      goal("complete", active.nameWithOwner, 10),
      goal("open", active.nameWithOwner, 4),
    ], [active, profileOnly, starter], [
      workspace(active.nameWithOwner, {
        color: "#BE123C",
        interventionsByStatus: { proposed: 2, accepted: 1, dismissed: 1, done: 0 },
        contentItemsByStatus: { idea: 1, draft: 3, ready: 2, scheduled: 1, published: 4, skipped: 0 },
        nextSevenDays: upcoming,
      }),
      workspace(profileOnly.nameWithOwner, {
        color: "#047857",
        interventionsByStatus: { proposed: 1, accepted: 2, dismissed: 0, done: 0 },
        contentItemsByStatus: { idea: 0, draft: 1, ready: 4, scheduled: 0, published: 0, skipped: 0 },
      }),
    ]);

    expect(summary).toMatchObject({
      totalGoals: 2,
      completedGoals: 1,
      workflowTotals: {
        proposedInterventions: 3,
        acceptedInterventions: 3,
        draftContent: 4,
        readyContent: 6,
        nextSevenDays: 2,
      },
    });
    expect(summary.workspaces.map(({ repository }) => repository)).toEqual([
      "acme/active",
      "acme/profile-only",
    ]);
    expect(summary.workspaces[0]).toMatchObject({
      repository: "acme/active",
      color: "#BE123C",
      repo: active,
      completedGoals: 1,
      contentItemsByStatus: { draft: 3, ready: 2 },
    });
    expect(summary.starterRepositories).toEqual([starter]);
  });

  it("keeps a complete fallback workspace when repository metadata or API data is unavailable", () => {
    const summary = buildGrowthHomeSummary(
      [goal("legacy", "legacy/missing", 1)],
      [repo("acme/starter")],
    );

    expect(summary.workspaces[0]).toMatchObject({
      repository: "legacy/missing",
      color: growthProfileColor("legacy/missing"),
      repo: null,
      completedGoals: 0,
      interventionsByStatus: { proposed: 0, accepted: 0, dismissed: 0, done: 0 },
      contentItemsByStatus: { idea: 0, draft: 0, ready: 0, scheduled: 0, published: 0, skipped: 0 },
      nextSevenDays: [],
    });
    expect(summary.starterRepositories).toHaveLength(1);
  });

  it("includes profile-only repositories and returns deterministic zero totals when empty", () => {
    const profileOnly = repo("acme/profile-only");
    const starter = repo("acme/starter");
    const profileSummary = workspace(profileOnly.nameWithOwner, { color: "#7C3AED" });
    const summary = buildGrowthHomeSummary([], [profileOnly, starter], [profileSummary]);

    expect(summary.workspaces).toEqual([{
      ...profileSummary,
      repo: profileOnly,
      goals: [],
      completedGoals: 0,
    }]);
    expect(summary.workflowTotals).toEqual({
      proposedInterventions: 0,
      acceptedInterventions: 0,
      draftContent: 0,
      readyContent: 0,
      nextSevenDays: 0,
    });
    expect(summary.starterRepositories).toEqual([starter]);

    expect(buildGrowthHomeSummary([], [], []).workflowTotals).toEqual(summary.workflowTotals);
  });
});
