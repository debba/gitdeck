import { describe, expect, it } from "vitest";
import { buildGitLabInstanceConfig, isSameGitLabInstance } from "../../src/utils/gitlab";

describe("buildGitLabInstanceConfig", () => {
  it("builds a provider config for a custom GitLab host", () => {
    expect(buildGitLabInstanceConfig("gitlab.example.com/")).toMatchObject({
      id: "gitlab-gitlab.example.com",
      kind: "gitlab",
      webUrl: "https://gitlab.example.com",
      baseUrl: "https://gitlab.example.com/api/v4",
      oauthTokenUrl: "https://gitlab.example.com/oauth/token",
    });
  });

  it("supports HTTP and GitLab installations under a path", () => {
    const config = buildGitLabInstanceConfig("http://localhost:8080/gitlab/api/v4");
    expect(config.webUrl).toBe("http://localhost:8080/gitlab");
    expect(config.baseUrl).toBe("http://localhost:8080/gitlab/api/v4");
  });

  it("compares normalized instance URLs", () => {
    expect(isSameGitLabInstance("gitlab.example.com/", "https://gitlab.example.com")).toBe(true);
    expect(isSameGitLabInstance("https://other.example.com", "https://gitlab.example.com")).toBe(false);
  });

  it("rejects unsupported or ambiguous URLs", () => {
    expect(() => buildGitLabInstanceConfig("ftp://gitlab.example.com")).toThrow(/HTTP or HTTPS/);
    expect(() => buildGitLabInstanceConfig("https://gitlab.example.com?tenant=one")).toThrow(/query parameters/);
    expect(() => buildGitLabInstanceConfig("")).toThrow(/required/);
  });
});
