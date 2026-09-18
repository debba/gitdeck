import { describe, expect, it } from "vitest";
import type { GrowthAsset } from "../../../src/types/growth";
import {
  normalizeGrowthDraftMedia,
  normalizeGrowthMediaCandidates,
} from "../../../src/utils/growth/mediaCandidates";

function asset(overrides: Partial<GrowthAsset> = {}): GrowthAsset {
  return {
    id: "asset-1",
    accountId: "account-a",
    repository: "acme/rocket",
    kind: "image",
    origin: "upload",
    path: "acme/rocket.png",
    url: null,
    title: "Rocket dashboard",
    alt: "Dashboard showing the Rocket project",
    width: 1200,
    height: 630,
    cardTemplate: null,
    cardData: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeGrowthMediaCandidates", () => {
  it("prefers asset IDs and normalizes deduplicated README and source URLs", () => {
    expect(normalizeGrowthMediaCandidates({
      repository: "acme/rocket",
      assets: [
        asset({ url: "https://cdn.example.com/dashboard.png#preview" }),
        asset({ id: "asset-2", path: null, url: null }),
      ],
      readmeMediaUrls: [
        "https://cdn.example.com/dashboard.png",
        "https://cdn.example.com/demo.mp4",
        "file:///tmp/private.png",
      ],
      additionalSources: [{ mediaUrls: ["https://example.com/cover.png", "https://cdn.example.com/demo.mp4"] }],
    })).toEqual([
      expect.objectContaining({ key: "asset:asset-1", assetId: "asset-1", kind: "image" }),
      expect.objectContaining({ key: "url:https://cdn.example.com/demo.mp4", url: "https://cdn.example.com/demo.mp4", kind: "video" }),
      expect.objectContaining({ key: "url:https://example.com/cover.png", url: "https://example.com/cover.png", kind: "image" }),
    ]);
  });
});

describe("normalizeGrowthDraftMedia", () => {
  it("allowlists selections, emits assetId or URL, and guarantees non-empty alt text", () => {
    const candidates = normalizeGrowthMediaCandidates({
      repository: "acme/rocket",
      assets: [asset()],
      readmeMediaUrls: ["https://example.com/demo.mp4"],
    });
    expect(normalizeGrowthDraftMedia([
      { assetId: "missing", alt: "Invented" },
      { url: "https://evil.example/fake.png", alt: "Invented URL" },
      { candidateKey: "asset:asset-1", alt: "", caption: "Product screen" },
      { url: "https://example.com/demo.mp4#fragment", alt: "Demo video" },
    ], candidates)).toEqual([
      {
        assetId: "asset-1",
        kind: "image",
        alt: "Dashboard showing the Rocket project",
        caption: "Product screen",
      },
      { url: "https://example.com/demo.mp4", kind: "video", alt: "Demo video" },
    ]);
  });
});
