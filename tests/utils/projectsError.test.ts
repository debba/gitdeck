import { describe, expect, it } from "vitest";
import { projectsAccessHint } from "../../src/utils/projectsError";

describe("projectsAccessHint", () => {
  it("points fine-grained tokens to a classic token", () => {
    const message = "Resource not accessible by personal access token; Resource not accessible by personal access token";

    expect(projectsAccessHint(message)).toContain("Use a classic personal access token with the 'project' scope");
  });

  it("points tokens missing the project scope to gh auth refresh", () => {
    const message = "Your token has not been granted the required scopes to execute this query.";

    expect(projectsAccessHint(message)).toContain("gh auth refresh -h github.com -s project");
  });

  it("returns no hint for unrelated errors", () => {
    expect(projectsAccessHint("Project not found")).toBeNull();
  });
});
