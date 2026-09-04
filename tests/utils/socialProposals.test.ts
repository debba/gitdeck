import { describe, expect, it } from "vitest";
import type { GoalProposal } from "../../src/types/goals";
import { attachSourceMedia, extractMediaUrls, extractWebPageSignal, hasCompleteSocialSet, normalizeContentSources, normalizeSocialProposals, socialCharacterCount } from "../../src/utils/socialProposals";

describe("socialCharacterCount", () => {
  it("counts an emoji as one Unicode code point", () => {
    expect(socialCharacterCount("Ship it 🚀")).toBe(9);
  });
});

describe("normalizeContentSources", () => {
  it("accepts repositories and HTTP websites while removing duplicates and unsafe URLs", () => {
    expect(normalizeContentSources([
      { type: "repository", value: "owner/project" },
      { type: "repository", value: "owner/project" },
      { type: "website", value: "https://example.com/media#gallery" },
      { type: "website", value: "file:///etc/passwd" },
    ])).toEqual([
      { type: "repository", value: "owner/project" },
      { type: "website", value: "https://example.com/media" },
    ]);
  });
});

describe("extractMediaUrls", () => {
  it("finds Markdown and HTML media and resolves relative URLs", () => {
    expect(extractMediaUrls(
      "![Demo](assets/demo.png)\n<video src=\"https://cdn.example/demo.mp4\"></video>",
      "https://raw.example/owner/repo/main/README.md",
    )).toEqual([
      "https://raw.example/owner/repo/main/assets/demo.png",
      "https://cdn.example/demo.mp4",
    ]);
  });
});

describe("extractWebPageSignal", () => {
  it("extracts readable source content and resolves page media", () => {
    const result = extractWebPageSignal(
      `<html><head><title>Latest &amp; greatest</title><meta property="og:image" content="/cover.png"></head><body><script>ignore()</script><h1>Version 2</h1><p>Faster builds.</p></body></html>`,
      "https://example.com/releases/v2",
    );
    expect(result.title).toBe("Latest & greatest");
    expect(result.excerpt).toContain("Version 2 Faster builds.");
    expect(result.excerpt).not.toContain("ignore");
    expect(result.mediaUrls).toEqual(["https://example.com/cover.png"]);
  });
});

describe("attachSourceMedia", () => {
  it("rotates concrete project assets between posts and removes invented media", () => {
    const proposals = [
      { title: "X", format: "x-thread", summary: "s", content: "c", mediaSuggestions: [{ kind: "image", title: "Fake", sourceUrl: "https://fake.test/x.png", guidance: "g" }] },
      { title: "LinkedIn", format: "linkedin-post", summary: "s", content: "c" },
    ] as GoalProposal[];
    const result = attachSourceMedia(proposals, ["https://source.test/a.png", "https://source.test/demo.mp4"]);
    expect(result[0].mediaSuggestions?.[0].sourceUrl).toBe("https://source.test/a.png");
    expect(result[1].mediaSuggestions?.[0]).toMatchObject({ kind: "video", sourceUrl: "https://source.test/demo.mp4" });
  });
});

describe("normalizeSocialProposals", () => {
  const threadPosts = ["Hook", "Problem", "Approach", "Evidence", "Call to action"];

  it("returns one valid draft per required platform and rebuilds thread content", () => {
    const result = normalizeSocialProposals([
      { title: "X", format: "x-thread", summary: "Developers; README angle.", content: "wrong", threadPosts },
      { title: "LinkedIn", format: "linkedin-post", summary: "Technical leaders; project value.", content: "A professional post.", threadPosts: [] },
      { title: "Mastodon", format: "mastodon-post", summary: "OSS community; contribution angle.", content: "A community post.", threadPosts: [], mediaSuggestions: [
        { kind: "image", title: "Demo", sourceUrl: "https://example.com/demo.png", guidance: "Use the existing screenshot." },
        { kind: "audio", title: "Invalid", sourceUrl: "file:///demo", guidance: "No." },
      ] },
    ]);

    expect(result).toHaveLength(3);
    expect(result[2].mediaSuggestions).toEqual([{ kind: "image", title: "Demo", sourceUrl: "https://example.com/demo.png", guidance: "Use the existing screenshot." }]);
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
