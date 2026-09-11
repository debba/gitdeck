import {
  GROWTH_ASSET_MIME_TYPES,
  MAX_GROWTH_ASSET_BYTES,
  type GrowthAssetMimeType,
} from "../../types/growth";

export type GrowthAssetUploadValidationIssue =
  | "missing-file"
  | "missing-title"
  | "missing-alt"
  | "unsupported-type"
  | "empty-file"
  | "file-too-large";

interface GrowthAssetUploadCandidate {
  file: Pick<Blob, "size" | "type"> | null;
  title: string;
  alt: string;
}

export function isGrowthAssetMimeType(value: string): value is GrowthAssetMimeType {
  return GROWTH_ASSET_MIME_TYPES.includes(value as GrowthAssetMimeType);
}

export function validateGrowthAssetUpload(
  candidate: GrowthAssetUploadCandidate,
): GrowthAssetUploadValidationIssue | null {
  if (!candidate.file) return "missing-file";
  if (!candidate.title.trim()) return "missing-title";
  if (!candidate.alt.trim()) return "missing-alt";
  if (!isGrowthAssetMimeType(candidate.file.type)) return "unsupported-type";
  if (candidate.file.size === 0) return "empty-file";
  if (candidate.file.size > MAX_GROWTH_ASSET_BYTES) return "file-too-large";
  return null;
}
