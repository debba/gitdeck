import { describe, expect, it } from "vitest";
import {
  createLegacySuggestionDedupeKey,
  legacyMediaToContentMedia,
  legacyProposalChannel,
  normalizeLegacySuggestionTitle,
} from "../../../src/utils/growth/legacySuggestions";

describe("legacy Growth Studio suggestion mapping", () => {
  it("normalizes titles and builds repository- and goal-scoped dedupe keys", () => {
    expect(normalizeLegacySuggestionTitle("  Share   What's New!  ")).toBe("share-what-s-new");
    expect(normalizeLegacySuggestionTitle("Novità e comunità")).toBe("novità-e-comunità");
    expect(createLegacySuggestionDedupeKey("owner/repo", "goal-1", "Share the release"))
      .toBe("owner/repo:goal-1:share-the-release");
  });

  it("maps social formats to channels and preserves other legacy formats", () => {
    expect(legacyProposalChannel("x-thread")).toBe("x");
    expect(legacyProposalChannel("linkedin-post")).toBe("linkedin");
    expect(legacyProposalChannel("mastodon-post")).toBe("mastodon");
    expect(legacyProposalChannel("discussion")).toBe("other");
  });

  it("maps legacy media metadata to content attachments", () => {
    expect(legacyMediaToContentMedia([{
      kind: "image",
      title: "Release screenshot",
      sourceUrl: "https://example.com/release.png",
      guidance: "Crop to the feature panel.",
    }])).toEqual([{
      kind: "image",
      url: "https://example.com/release.png",
      alt: "Release screenshot",
      caption: "Crop to the feature panel.",
    }]);
    expect(legacyMediaToContentMedia(undefined)).toEqual([]);
  });
});
