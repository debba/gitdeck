import { describe, expect, it } from "vitest";
import {
  getOwner,
  getRepositoryName,
  nameWithOwnerFromApiUrl,
  normalizePinnedRepositoryTabs,
  parseRepositoryName,
} from "../../src/utils/repository";

describe("repository utilities", () => {
  it("parses valid repository identifiers", () => {
    expect(parseRepositoryName("openai/codex")).toEqual(["openai", "codex"]);
    expect(parseRepositoryName("owner.name/repo-name_1")).toEqual(["owner.name", "repo-name_1"]);
  });

  it("rejects invalid repository identifiers", () => {
    expect(parseRepositoryName(null)).toBeNull();
    expect(parseRepositoryName("missing-slash")).toBeNull();
    expect(parseRepositoryName("too/many/parts")).toBeNull();
  });

  it("splits nameWithOwner values", () => {
    expect(getOwner("openai/codex")).toBe("openai");
    expect(getRepositoryName("openai/codex")).toBe("codex");
  });

  it("extracts nameWithOwner from a repository API url", () => {
    expect(nameWithOwnerFromApiUrl("https://api.github.com/repos/openai/codex")).toBe("openai/codex");
  });

  it("returns the input unchanged when it is not a repository API url", () => {
    expect(nameWithOwnerFromApiUrl("openai/codex")).toBe("openai/codex");
  });

  it("normalizes pinned repository tabs", () => {
    expect(normalizePinnedRepositoryTabs(null)).toEqual(["overview", "pull-requests", "issues"]);
    expect(normalizePinnedRepositoryTabs(["issues", "commits", "issues", "invalid", "forks"])).toEqual([
      "issues",
      "commits",
      "forks",
    ]);
  });

  it("limits the number of pinned repository tabs", () => {
    expect(normalizePinnedRepositoryTabs([
      "overview",
      "actions",
      "commits",
      "pull-requests",
      "issues",
      "milestones",
    ])).toHaveLength(5);
  });
});
