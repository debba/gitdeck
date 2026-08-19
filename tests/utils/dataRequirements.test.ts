import { describe, expect, it } from "vitest";
import { allDashboardResources, dataRequirementsForTab } from "../../src/utils/dataRequirements";

describe("dataRequirementsForTab", () => {
  it("loads all inbox datasets because inbox combines them", () => {
    expect([...dataRequirementsForTab("inbox")]).toEqual(["repos", "issues", "prs"]);
  });

  it("does not load unrelated datasets for focused views", () => {
    expect([...dataRequirementsForTab("repos")]).toEqual(["repos"]);
    expect([...dataRequirementsForTab("issues")]).toEqual(["repos", "issues"]);
    expect([...dataRequirementsForTab("prs")]).toEqual(["repos", "prs"]);
    expect([...dataRequirementsForTab("ci")]).toEqual(["repos"]);
    expect([...dataRequirementsForTab("digests")]).toEqual([]);
    expect([...dataRequirementsForTab("kanban")]).toEqual([]);
  });

  it("loads only datasets used by a deep-linked repository tab", () => {
    expect([...dataRequirementsForTab("digests", true)]).toEqual(["repos"]);
    expect([...dataRequirementsForTab("repos", true, "issues")]).toEqual(["repos", "issues"]);
    expect([...dataRequirementsForTab("repos", true, "pull-requests")]).toEqual(["repos", "prs"]);
  });

  it("provides all resources only for explicitly global features", () => {
    expect([...allDashboardResources()]).toEqual(["repos", "issues", "prs"]);
  });
});
