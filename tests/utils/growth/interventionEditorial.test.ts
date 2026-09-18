import { describe, expect, it } from "vitest";
import { interventionEditorialPolicy } from "../../../src/utils/growth/interventionEditorial";
import { interventionSuggestionsIssue } from "../../../src/utils/growth/editorialQuality";
import { DEFAULT_GROWTH_CHANNELS } from "../../../src/utils/growth/profileDefaults";

const documentation = "The documented workflow explains the driver protocol and configuration. ".repeat(5);

describe("intervention editorial channel policy", () => {
  it("reserves a blog recommendation from evergreen documentation without needing a release", () => {
    const policy = interventionEditorialPolicy(DEFAULT_GROWTH_CHANNELS, [documentation]);
    expect(policy.requireBlog).toBe(true);
    expect(policy.destinations).toContain("blog");
    const suggestion = { title: "Protocol choices", category: "engineering", action: "Explain the documented workflow", destination: "social" };
    expect(interventionSuggestionsIssue({ suggestions: [suggestion] }, policy)).toContain("blog channel is enabled");
    expect(interventionSuggestionsIssue({ suggestions: [{ ...suggestion, destination: "blog" }] }, policy)).toBeNull();
  });

  it("respects an explicitly disabled blog channel and rejects unknown destinations", () => {
    const policy = interventionEditorialPolicy({ ...DEFAULT_GROWTH_CHANNELS, blog: false }, [documentation]);
    expect(policy.requireBlog).toBe(false);
    expect(policy.destinations).not.toContain("blog");
    expect(interventionSuggestionsIssue({ suggestions: [{ title: "Article", action: "Write it", category: "engineering", destination: "blog" }] }, policy)).toContain("enabled editorial destinations");
  });

  it("does not force article generation from missing evidence or issue titles alone", () => {
    expect(interventionEditorialPolicy(DEFAULT_GROWTH_CHANNELS, [null, undefined, "Fix bug"]).requireBlog).toBe(false);
  });
});
