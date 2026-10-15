import { describe, expect, it } from "vitest";
import { projectsAccessHint } from "../../src/utils/projectsError";

describe("projectsAccessHint", () => {
  it("points fine-grained tokens to a classic token", () => {
    const message = "Resource not accessible by personal access token; Resource not accessible by personal access token";

    expect(projectsAccessHint(message)).toContain("Use a classic personal access token with the 'project' scope");
  });

  it("names the scopes GitHub reports as missing", () => {
    const message = [
      "Your token has not been granted the required scopes to execute this query. The 'login' field requires one of the following scopes: ['read:org'], but your token has only been granted the: ['read:project', 'repo'] scopes.",
      "Your token has not been granted the required scopes to execute this query. The 'projectsV2' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes.",
      "Your token has not been granted the required scopes to execute this query. The 'login' field requires one of the following scopes: ['read:org'], but your token has only been granted the: ['read:project', 'repo'] scopes.",
    ].join("; ");

    const hint = projectsAccessHint(message);

    expect(hint).toContain("'read:org', 'read:project'");
    expect(hint).toContain("gh auth refresh -h github.com -s read:org,read:project");
  });

  it("points tokens missing an unnamed scope to gh auth refresh", () => {
    const message = "Your token has not been granted the required scopes to execute this query.";

    expect(projectsAccessHint(message)).toContain("gh auth refresh -h github.com -s project");
  });

  it("returns no hint for unrelated errors", () => {
    expect(projectsAccessHint("Project not found")).toBeNull();
  });
});
