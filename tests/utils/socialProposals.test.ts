import { describe, expect, it } from "vitest";
import { hasCompleteSocialSet, normalizeSocialProposals, socialCharacterCount } from "../../src/utils/socialProposals";

describe("socialCharacterCount", () => {
  it("counts an emoji as one Unicode code point", () => {
    expect(socialCharacterCount("Ship it 🚀")).toBe(9);
  });
});

describe("normalizeSocialProposals", () => {
  const threadPosts = ["Hook", "Problem", "Approach", "Evidence", "Call to action"];

  it("returns one valid draft per required platform and rebuilds thread content", () => {
    const result = normalizeSocialProposals([
      { title: "X", format: "x-thread", summary: "Developers; README angle.", content: "wrong", threadPosts },
      { title: "LinkedIn", format: "linkedin-post", summary: "Technical leaders; project value.", content: "A professional post.", threadPosts: [] },
      { title: "Mastodon", format: "mastodon-post", summary: "OSS community; contribution angle.", content: "A community post.", threadPosts: [] },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0].content).toBe(threadPosts.join("\n\n---\n\n"));
    expect(hasCompleteSocialSet(result)).toBe(true);
  });

  it("rejects duplicate formats and posts that exceed platform limits", () => {
    const result = normalizeSocialProposals([
      { title: "First", format: "mastodon-post", summary: "Community audience; project angle.", content: "Valid", threadPosts: [] },
      { title: "Duplicate", format: "mastodon-post", summary: "Community audience; project angle.", content: "Also valid", threadPosts: [] },
      { title: "Too long", format: "x-thread", summary: "Developer audience; project angle.", content: "", threadPosts: [...threadPosts.slice(0, 4), "x".repeat(281)] },
    ]);

    expect(result.map((proposal) => proposal.title)).toEqual(["First"]);
    expect(hasCompleteSocialSet(result)).toBe(false);
  });
});
