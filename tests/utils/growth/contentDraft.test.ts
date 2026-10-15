import { describe, expect, it } from "vitest";
import { buildFallbackGrowthDraft, normalizeGeneratedGrowthDraft } from "../../../src/utils/growth/contentDraft";
import { socialProposalIssue } from "../../../src/utils/socialProposals";

describe("buildFallbackGrowthDraft", () => {
  it("creates an honest research draft with source notes when blog AI is unavailable", () => {
    const result = buildFallbackGrowthDraft({
      channel: "blog", format: "doc", repository: "acme/rocket", angle: "The cost of process isolation",
      cta: "Discuss the tradeoff", audience: "Engineers", hashtags: ["#hype"],
      facts: ["Driver isolation\n\n```rust\nlet isolated = true;\n```"],
      repositoryUrl: "https://github.com/acme/rocket", sources: ["https://github.com/acme/rocket/pull/42"],
    });
    expect(result.body).toContain("> Research draft:");
    expect(result.body).toContain("## Source notes");
    expect(result.body).toContain("```rust\nlet isolated = true;\n```");
    expect(result.body).toContain("https://github.com/acme/rocket/pull/42");
    expect(result.body).not.toContain("#hype");
    expect(result.threadPosts).toEqual([]);
  });
  it("creates a deterministic platform-valid X thread from verified facts", () => {
    const input = {
      repository: "acme/rocket",
      format: "x-thread" as const,
      angle: "Explain the verified release",
      cta: "Try the repository",
      audience: "Maintainers",
      hashtags: ["#opensource", "#TypeScript", "#extra"],
      facts: ["The repository lists v2 in its releases."],
      repositoryUrl: "https://github.com/acme/rocket",
    };
    const first = buildFallbackGrowthDraft(input);
    const second = buildFallbackGrowthDraft(input);

    expect(first).toEqual(second);
    expect(first.threadPosts).toHaveLength(5);
    expect(socialProposalIssue({
      title: first.title,
      format: "x-thread",
      summary: "Maintainers; verified release angle",
      content: first.body,
      threadPosts: first.threadPosts,
    })).toBeNull();
    expect(first.body).toContain("The repository lists v2");
    expect(first.body).not.toContain("#extra");
  });
});

describe("normalizeGeneratedGrowthDraft", () => {
  it("preserves a long Markdown article and rejects social-style blog output", () => {
    const body = `# Article\n\n${"A supported explanation. ".repeat(500)}\n\n## Implementation\n\n\`\`\`ts\nconst value = 1;\n\`\`\``;
    expect(normalizeGeneratedGrowthDraft("doc", "Discuss", { title: "Article", body }, "blog").draft?.body).toBe(body);
    expect(normalizeGeneratedGrowthDraft("doc", "Discuss", { title: "Article", body: "Try our new release!" }, "blog").draft).toBeNull();
  });
  it("rebuilds X body from posts and rejects platform-invalid output", () => {
    const posts = ["Hook", "Problem", "Approach", "Evidence", "Try it"];
    expect(normalizeGeneratedGrowthDraft("x-thread", "Maintainers; update", {
      title: "Rocket update",
      body: "",
      threadPosts: posts,
    }).draft?.body).toBe(posts.join("\n\n---\n\n"));

    const invalid = normalizeGeneratedGrowthDraft("mastodon-post", "Community; update", {
      title: "Too long",
      body: "x".repeat(501),
      threadPosts: [],
    });
    expect(invalid.draft).toBeNull();
    expect(invalid.issue).toContain("500");
  });
});
