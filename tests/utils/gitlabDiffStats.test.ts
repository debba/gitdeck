import { describe, expect, it } from "vitest";
import {
  buildGitLabDiffStatsQuery,
  gitLabDiffStatsRateLimited,
  gitLabGraphqlUrl,
  parseGitLabChangesCount,
  readGitLabDiffStats,
} from "../../src/utils/gitlabDiffStats";

describe("gitLabGraphqlUrl", () => {
  it("uses the instance root, including a relative self-hosted install", () => {
    expect(gitLabGraphqlUrl("https://gitlab.com")).toBe("https://gitlab.com/api/graphql");
    expect(gitLabGraphqlUrl("https://git.example.com/gitlab/")).toBe("https://git.example.com/gitlab/api/graphql");
  });
});

describe("parseGitLabChangesCount", () => {
  it("parses a numeric file count and ignores truncated values", () => {
    expect(parseGitLabChangesCount("3")).toBe(3);
    expect(parseGitLabChangesCount(" 0 ")).toBe(0);
    expect(parseGitLabChangesCount("1000+")).toBeNull();
    expect(parseGitLabChangesCount("")).toBeNull();
    expect(parseGitLabChangesCount(null)).toBeNull();
    expect(parseGitLabChangesCount("nope")).toBeNull();
  });
});

describe("buildGitLabDiffStatsQuery", () => {
  it("batches merge requests by alias and escapes the project path", () => {
    const query = buildGitLabDiffStatsQuery([
      { projectPath: "group/app", iid: 8 },
      { projectPath: "group/app\"quoted", iid: 9 },
    ]);

    expect(query).toContain('m0: project(fullPath: "group/app") { mergeRequest(iid: "8")');
    expect(query).toContain('m1: project(fullPath: "group/app\\"quoted") { mergeRequest(iid: "9")');
    expect(query).toContain("diffStatsSummary { additions deletions fileCount }");
  });
});

describe("readGitLabDiffStats", () => {
  it("maps summaries and leaves missing merge requests empty", () => {
    expect(readGitLabDiffStats({
      data: {
        m0: { mergeRequest: { diffStatsSummary: { additions: 12, deletions: 4, fileCount: 3 } } },
        m1: { mergeRequest: null },
        m2: { mergeRequest: { diffStatsSummary: { additions: 0, deletions: 0, fileCount: 1 } } },
      },
    }, 3)).toEqual([
      { additions: 12, deletions: 4, changedFiles: 3 },
      null,
      { additions: 0, deletions: 0, changedFiles: 1 },
    ]);
  });

  it("detects a rate limit reported in a GraphQL error payload", () => {
    const payload = { errors: [{ message: "Rate limit exceeded" }] };
    expect(gitLabDiffStatsRateLimited(payload)).toBe(true);
    expect(readGitLabDiffStats(payload, 1)).toEqual([null]);
  });
});
