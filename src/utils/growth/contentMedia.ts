import type {
  GrowthAssetMetadata,
  GrowthContentItemStatus,
  GrowthContentMedia,
} from "../../types/growth";

const MEDIA_REQUIRED_STATUSES = new Set<GrowthContentItemStatus>([
  "ready",
  "scheduled",
  "published",
]);

function normalizedOptionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

export function isGrowthAssetAttached(
  media: readonly GrowthContentMedia[],
  assetId: string,
): boolean {
  const normalizedId = assetId.trim();
  return Boolean(normalizedId) && media.some((entry) => entry.assetId?.trim() === normalizedId);
}

export function attachGrowthAssetMedia(
  media: readonly GrowthContentMedia[],
  asset: GrowthAssetMetadata,
  alt: string,
  caption = "",
): GrowthContentMedia[] | null {
  const assetId = asset.id.trim();
  const normalizedAlt = alt.trim();
  if (!assetId || !normalizedAlt || isGrowthAssetAttached(media, assetId)) return null;

  return [
    ...media,
    {
      assetId,
      kind: asset.kind,
      alt: normalizedAlt,
      ...(normalizedOptionalText(caption) ? { caption: caption.trim() } : {}),
    },
  ];
}

export function updateGrowthContentMedia(
  media: readonly GrowthContentMedia[],
  index: number,
  alt: string,
  caption = "",
): GrowthContentMedia[] | null {
  const normalizedAlt = alt.trim();
  if (!Number.isInteger(index) || index < 0 || index >= media.length || !normalizedAlt) return null;

  return media.map((entry, entryIndex) => {
    if (entryIndex !== index) return entry;
    const updated: GrowthContentMedia = { ...entry, alt: normalizedAlt };
    const normalizedCaption = normalizedOptionalText(caption);
    if (normalizedCaption) updated.caption = normalizedCaption;
    else delete updated.caption;
    return updated;
  });
}

export function canRemoveGrowthContentMedia(
  media: readonly GrowthContentMedia[],
  index: number,
  status: GrowthContentItemStatus,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= media.length) return false;
  return !MEDIA_REQUIRED_STATUSES.has(status) || media.length > 1;
}

export function removeGrowthContentMedia(
  media: readonly GrowthContentMedia[],
  index: number,
  status: GrowthContentItemStatus,
): GrowthContentMedia[] | null {
  if (!canRemoveGrowthContentMedia(media, index, status)) return null;
  return media.filter((_, entryIndex) => entryIndex !== index);
}
