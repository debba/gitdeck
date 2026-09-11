import { describe, expect, it } from "vitest";
import {
  normalizeGrowthAssetImportCandidates,
  normalizeGrowthAssetImportUrl,
} from "../../../src/utils/growth/importCandidates";

describe("growth asset import candidates", () => {
  it("resolves relative URLs, removes fragments, and deduplicates normalized URLs", () => {
    expect(normalizeGrowthAssetImportCandidates([
      {
        origin: "readme",
        source: "acme/rocket README",
        baseUrl: "https://raw.example/acme/rocket/main/README.md",
        mediaUrls: [
          "./images/release-card.png#preview",
          "https://raw.example/acme/rocket/main/images/release-card.png",
          "../demo.webm",
        ],
      },
      {
        origin: "website",
        source: "Project website",
        mediaUrls: ["https://raw.example/acme/rocket/main/images/release-card.png#other"],
      },
    ])).toEqual([
      {
        origin: "readme",
        source: "acme/rocket README",
        url: "https://raw.example/acme/rocket/main/images/release-card.png",
        title: "release card.png",
        alt: "release card.png",
      },
      {
        origin: "readme",
        source: "acme/rocket README",
        url: "https://raw.example/acme/rocket/demo.webm",
        title: "demo.webm",
        alt: "demo.webm",
      },
    ]);
  });

  it("preserves README and configured website origins in stable source order", () => {
    expect(normalizeGrowthAssetImportCandidates([
      {
        origin: "readme",
        source: "acme/docs",
        title: "Documentation preview",
        mediaUrls: ["https://cdn.example/docs.png"],
      },
      {
        origin: "website",
        source: "https://project.example",
        title: "Project home",
        mediaUrls: ["https://cdn.example/demo.mp4"],
      },
    ])).toEqual([
      expect.objectContaining({ origin: "readme", source: "acme/docs", title: "Documentation preview" }),
      expect.objectContaining({ origin: "website", source: "https://project.example", title: "Project home" }),
    ]);
  });

  it("rejects malformed, credentialed, and non-HTTP URLs", () => {
    expect(normalizeGrowthAssetImportUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeGrowthAssetImportUrl("https://user:secret@example.com/private.png")).toBeNull();
    expect(normalizeGrowthAssetImportCandidates([{
      origin: "website",
      source: "Site",
      mediaUrls: [null, "relative.png", "ftp://example.com/video.mp4"],
    }])).toEqual([]);
  });
});
