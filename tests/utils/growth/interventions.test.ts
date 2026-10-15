import { describe, expect, it } from "vitest";
import { createGrowthInterventionDedupeKey } from "../../../src/utils/growth/interventions";

describe("createGrowthInterventionDedupeKey", () => {
  it("normalizes titles and distinguishes repository, goal, and category", () => {
    expect(createGrowthInterventionDedupeKey("acme/rocket", null, "marketing", " Share the release! "))
      .toBe("acme/rocket:repository:marketing:share-the-release");
    expect(createGrowthInterventionDedupeKey("acme/rocket", "goal-1", "community", "Share the release"))
      .toBe("acme/rocket:goal-1:community:share-the-release");
  });
});
