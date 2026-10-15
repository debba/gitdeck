import { describe, expect, it } from "vitest";
import { MAX_GROWTH_ASSET_BYTES } from "../../../src/types/growth";
import {
  isGrowthAssetMimeType,
  validateGrowthAssetUpload,
} from "../../../src/utils/growth/assets";

function file(type = "image/png", size = 100): Pick<Blob, "size" | "type"> {
  return { type, size };
}

describe("growth asset upload validation", () => {
  it("accepts every upload MIME type", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
    ]) {
      expect(isGrowthAssetMimeType(type)).toBe(true);
      expect(validateGrowthAssetUpload({ file: file(type), title: "Asset", alt: "Useful description" })).toBeNull();
    }
  });

  it("reports required fields before file constraints", () => {
    expect(validateGrowthAssetUpload({ file: null, title: "", alt: "" })).toBe("missing-file");
    expect(validateGrowthAssetUpload({ file: file(), title: " ", alt: "Description" })).toBe("missing-title");
    expect(validateGrowthAssetUpload({ file: file(), title: "Asset", alt: " " })).toBe("missing-alt");
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(validateGrowthAssetUpload({ file: file("image/svg+xml"), title: "Asset", alt: "Description" }))
      .toBe("unsupported-type");
    expect(validateGrowthAssetUpload({ file: file("image/png", 0), title: "Asset", alt: "Description" }))
      .toBe("empty-file");
    expect(validateGrowthAssetUpload({
      file: file("image/png", MAX_GROWTH_ASSET_BYTES + 1),
      title: "Asset",
      alt: "Description",
    })).toBe("file-too-large");
  });
});
