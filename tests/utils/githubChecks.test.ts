import { describe, expect, it } from "vitest";
import { GitHubResponseError } from "../../src/server/providers/github";
import {
  githubCheckStatusUnavailable,
  githubChecksUrl,
  mapGitHubStatusCheckRollup,
} from "../../src/utils/githubChecks";

const url = "https://github.com/acme/app/pull/10";

describe("mapGitHubStatusCheckRollup", () => {
  it("maps the combined rollup onto the shared badge and links to the checks page", () => {
    expect(mapGitHubStatusCheckRollup({ state: "SUCCESS" }, url)).toEqual({
      status: "success",
      url: "https://github.com/acme/app/pull/10/checks",
    });
    expect(mapGitHubStatusCheckRollup({ state: "FAILURE" }, url)?.status).toBe("failed");
    expect(mapGitHubStatusCheckRollup({ state: "ERROR" }, url)?.status).toBe("failed");
    expect(mapGitHubStatusCheckRollup({ state: "EXPECTED" }, url)?.status).toBe("pending");
  });

  it("shows running when a pending rollup has a check in progress", () => {
    expect(mapGitHubStatusCheckRollup({
      state: "PENDING",
      contexts: { nodes: [{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null }] },
    }, url)?.status).toBe("running");
  });

  it("shows skipped or canceled when every check finished that way", () => {
    expect(mapGitHubStatusCheckRollup({
      state: "SUCCESS",
      contexts: { nodes: [
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
      ] },
    }, url)?.status).toBe("skipped");
    expect(mapGitHubStatusCheckRollup({
      state: "SUCCESS",
      contexts: { nodes: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "CANCELLED" }] },
    }, url)?.status).toBe("canceled");
  });

  it("keeps a failed combined status when another check was skipped", () => {
    expect(mapGitHubStatusCheckRollup({
      state: "FAILURE",
      contexts: { nodes: [
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
        { __typename: "StatusContext", state: "SUCCESS" },
      ] },
    }, url)?.status).toBe("failed");
  });

  it("omits the badge when the rollup is missing", () => {
    expect(mapGitHubStatusCheckRollup(null, url)).toBeNull();
    expect(mapGitHubStatusCheckRollup({}, url)).toBeNull();
  });

  it("builds a checks url for a GitHub Enterprise pull request", () => {
    expect(githubChecksUrl("https://github.example.com/acme/app/pull/4/")).toBe(
      "https://github.example.com/acme/app/pull/4/checks",
    );
  });
});

describe("githubCheckStatusUnavailable", () => {
  it("treats forbidden and rate-limit responses as a reason to omit badges", () => {
    expect(githubCheckStatusUnavailable(new GitHubResponseError(403, "forbidden"))).toBe(true);
    expect(githubCheckStatusUnavailable(new GitHubResponseError(429, "rate limit"))).toBe(true);
    expect(githubCheckStatusUnavailable(new Error("API rate limit exceeded"))).toBe(true);
    expect(githubCheckStatusUnavailable(new Error("Resource not accessible by personal access token"))).toBe(true);
    expect(githubCheckStatusUnavailable(new Error("Something else broke"))).toBe(false);
  });
});
