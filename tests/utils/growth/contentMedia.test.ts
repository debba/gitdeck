import { describe, expect, it } from "vitest";
import type { GrowthAssetMetadata, GrowthContentMedia } from "../../../src/types/growth";
import {
  attachGrowthAssetMedia,
  canRemoveGrowthContentMedia,
  isGrowthAssetAttached,
  removeGrowthContentMedia,
  updateGrowthContentMedia,
} from "../../../src/utils/growth/contentMedia";

function asset(overrides: Partial<GrowthAssetMetadata> = {}): GrowthAssetMetadata {
  return {
    id: "asset-1",
    accountId: "account-a",
    repository: "acme/repo",
    kind: "image",
    origin: "upload",
    url: null,
    title: "Release card",
    alt: "Release dashboard",
    width: 1200,
    height: 630,
    cardTemplate: null,
    cardData: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

const legacy: GrowthContentMedia = {
  kind: "image",
  url: "https://example.com/legacy.png",
  alt: "Legacy image",
};

describe("growth content media", () => {
  it("attaches trimmed asset metadata while preserving legacy media", () => {
    expect(attachGrowthAssetMedia([legacy], asset(), "  Updated alt  ", "  Product view  ")).toEqual([
      legacy,
      { assetId: "asset-1", kind: "image", alt: "Updated alt", caption: "Product view" },
    ]);
    expect(attachGrowthAssetMedia([], asset({ id: "video-1", kind: "video" }), "Demo")).toEqual([
      { assetId: "video-1", kind: "video", alt: "Demo" },
    ]);
  });

  it("rejects duplicate selections and empty attachment alt text", () => {
    const selected = [{ assetId: "asset-1", kind: "image" as const, alt: "Card" }];
    expect(isGrowthAssetAttached(selected, " asset-1 ")).toBe(true);
    expect(attachGrowthAssetMedia(selected, asset(), "Another alt")).toBeNull();
    expect(attachGrowthAssetMedia([], asset(), "   ")).toBeNull();
  });

  it("edits alt and captions without dropping URL or asset identity", () => {
    expect(updateGrowthContentMedia([legacy], 0, "  Better alt ", "  Caption  ")).toEqual([{
      ...legacy,
      alt: "Better alt",
      caption: "Caption",
    }]);
    expect(updateGrowthContentMedia([{ ...legacy, caption: "Old" }], 0, "Alt", " ")).toEqual([{
      ...legacy,
      alt: "Alt",
    }]);
    expect(updateGrowthContentMedia([legacy], 0, " ")).toBeNull();
    expect(updateGrowthContentMedia([legacy], 2, "Alt")).toBeNull();
  });

  it("allows ordinary removal but protects the final attachment in guarded statuses", () => {
    expect(canRemoveGrowthContentMedia([legacy], 0, "draft")).toBe(true);
    expect(removeGrowthContentMedia([legacy], 0, "draft")).toEqual([]);
    for (const status of ["ready", "scheduled", "published"] as const) {
      expect(canRemoveGrowthContentMedia([legacy], 0, status)).toBe(false);
      expect(removeGrowthContentMedia([legacy], 0, status)).toBeNull();
      expect(removeGrowthContentMedia([legacy, { ...legacy, url: "https://example.com/second.png" }], 0, status))
        .toHaveLength(1);
    }
  });
});
