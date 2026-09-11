import { useEffect, useState } from "react";
import {
  buildGrowthAssetFileUrl,
  fetchGrowthAssets,
} from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import type {
  GrowthAssetMetadata,
  GrowthContentItemStatus,
  GrowthContentMedia,
} from "../../types/growth";
import {
  attachGrowthAssetMedia,
  canRemoveGrowthContentMedia,
  isGrowthAssetAttached,
  removeGrowthContentMedia,
  updateGrowthContentMedia,
} from "../../utils/growth/contentMedia";

interface GrowthMediaPickerProps {
  accountId: string;
  repository: string;
  media: readonly GrowthContentMedia[];
  status: GrowthContentItemStatus;
  disabled?: boolean;
  onChange: (media: GrowthContentMedia[]) => Promise<void>;
}

interface MediaFields {
  alt: string;
  caption: string;
}

function fieldsForMedia(media: readonly GrowthContentMedia[]): MediaFields[] {
  return media.map((entry) => ({ alt: entry.alt, caption: entry.caption ?? "" }));
}

export function GrowthMediaPicker({
  accountId,
  repository,
  media,
  status,
  disabled = false,
  onChange,
}: GrowthMediaPickerProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<GrowthAssetMetadata[]>([]);
  const [assetFields, setAssetFields] = useState<Record<string, MediaFields>>({});
  const [selectedFields, setSelectedFields] = useState<MediaFields[]>(() => fieldsForMedia(media));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    setSelectedFields(fieldsForMedia(media));
    setOperationError("");
  }, [media]);

  useEffect(() => {
    setAssets([]);
    setAssetFields({});
    setLoadError("");
    setOperationError("");
    setBusy("");
    if (!accountId || !repository) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void fetchGrowthAssets(repository, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setAssets(result);
        setAssetFields(Object.fromEntries(result.map((asset) => [
          asset.id,
          { alt: asset.alt, caption: "" },
        ])));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setLoadError(t("growth.contentMediaLibraryError", { message: (cause as Error).message }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountId, repository, t]);

  async function persist(action: string, nextMedia: GrowthContentMedia[] | null) {
    if (!nextMedia) {
      setOperationError(t("growth.contentMediaAltRequired"));
      return;
    }
    setBusy(action);
    setOperationError("");
    try {
      await onChange(nextMedia);
    } catch (cause) {
      setOperationError(t("growth.contentMediaUpdateError", { message: (cause as Error).message }));
    } finally {
      setBusy("");
    }
  }

  function updateAssetField(asset: GrowthAssetMetadata, field: keyof MediaFields, value: string) {
    setAssetFields((current) => ({
      ...current,
      [asset.id]: {
        ...(current[asset.id] ?? { alt: asset.alt, caption: "" }),
        [field]: value,
      },
    }));
    setOperationError("");
  }

  function attach(asset: GrowthAssetMetadata) {
    const fields = assetFields[asset.id] ?? { alt: asset.alt, caption: "" };
    void persist(
      `attach-${asset.id}`,
      attachGrowthAssetMedia(media, asset, fields.alt, fields.caption),
    );
  }

  function saveSelected(index: number) {
    const fields = selectedFields[index] ?? { alt: media[index]?.alt ?? "", caption: media[index]?.caption ?? "" };
    void persist(`save-${index}`, updateGrowthContentMedia(media, index, fields.alt, fields.caption));
  }

  function removeSelected(index: number) {
    void persist(`remove-${index}`, removeGrowthContentMedia(media, index, status));
  }

  return (
    <div className="growth-media-picker">
      <div className="growth-media-picker-selected">
        <h4>{t("growth.contentMediaSelectedTitle")}</h4>
        {media.length === 0 ? (
          <p className="growth-content-empty-note">{t("growth.contentMediaNoneSelected")}</p>
        ) : (
          <div className="growth-media-picker-selected-list">
            {media.map((entry, index) => {
              const fields = selectedFields[index] ?? { alt: entry.alt, caption: entry.caption ?? "" };
              const altId = `growth-content-media-alt-${index}`;
              const captionId = `growth-content-media-caption-${index}`;
              const removable = canRemoveGrowthContentMedia(media, index, status);
              return (
                <article key={`${entry.assetId ?? entry.url ?? "media"}-${index}`}>
                  <div className="growth-media-picker-selected-head">
                    <strong>{entry.alt}</strong>
                    <span>{entry.assetId ? t("growth.contentMediaLibrarySelected") : t("growth.contentMediaLegacy")}</span>
                  </div>
                  <label htmlFor={altId}>
                    {t("growth.contentMediaAltLabel")}
                    <input
                      id={altId}
                      required
                      maxLength={2000}
                      value={fields.alt}
                      disabled={disabled || busy !== ""}
                      onChange={(event) => {
                        setSelectedFields((current) => current.map((value, fieldIndex) => (
                          fieldIndex === index ? { ...value, alt: event.target.value } : value
                        )));
                        setOperationError("");
                      }}
                    />
                  </label>
                  <label htmlFor={captionId}>
                    {t("growth.contentMediaCaptionLabel")}
                    <input
                      id={captionId}
                      maxLength={2000}
                      value={fields.caption}
                      disabled={disabled || busy !== ""}
                      onChange={(event) => {
                        setSelectedFields((current) => current.map((value, fieldIndex) => (
                          fieldIndex === index ? { ...value, caption: event.target.value } : value
                        )));
                        setOperationError("");
                      }}
                    />
                  </label>
                  <div className="growth-media-picker-actions">
                    <button className="btn ghost" type="button" disabled={disabled || busy !== ""} onClick={() => saveSelected(index)}>
                      {busy === `save-${index}` ? t("growth.contentMediaSaving") : t("growth.contentMediaSaveDetails")}
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={disabled || busy !== "" || !removable}
                      title={!removable ? t("growth.contentMediaRemoveProtected") : undefined}
                      onClick={() => removeSelected(index)}
                    >
                      {busy === `remove-${index}` ? t("growth.contentMediaRemoving") : t("growth.contentMediaRemove")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="growth-media-picker-library">
        <h4>{t("growth.contentMediaLibraryTitle")}</h4>
        {loading ? <p className="growth-media-picker-state" role="status">{t("growth.contentMediaLibraryLoading")}</p> : null}
        {loadError ? <p className="growth-media-picker-error" role="alert">{loadError}</p> : null}
        {!loading && !loadError && assets.length === 0 ? (
          <p className="growth-media-picker-state">{t("growth.contentMediaLibraryEmpty")}</p>
        ) : null}
        {assets.length ? (
          <div className="growth-media-picker-assets" aria-label={t("growth.contentMediaLibraryLabel")}>
            {assets.map((asset, index) => {
              const fields = assetFields[asset.id] ?? { alt: asset.alt, caption: "" };
              const selected = isGrowthAssetAttached(media, asset.id);
              const altId = `growth-content-asset-alt-${index}`;
              const captionId = `growth-content-asset-caption-${index}`;
              return (
                <article className={selected ? "is-selected" : ""} key={asset.id}>
                  <div className="growth-media-picker-preview">
                    {asset.kind === "image" ? (
                      <img src={buildGrowthAssetFileUrl(asset.id)} alt={asset.alt} loading="lazy" />
                    ) : (
                      <video
                        src={buildGrowthAssetFileUrl(asset.id)}
                        aria-label={t("growth.assetsVideoPreview", { title: asset.title })}
                        controls
                        preload="metadata"
                      />
                    )}
                  </div>
                  <div className="growth-media-picker-asset-body">
                    <div className="growth-media-picker-selected-head">
                      <strong>{asset.title}</strong>
                      {selected ? <span>{t("growth.contentMediaLibrarySelected")}</span> : null}
                    </div>
                    <label htmlFor={altId}>
                      {t("growth.contentMediaAltLabel")}
                      <input
                        id={altId}
                        required
                        maxLength={2000}
                        value={fields.alt}
                        disabled={selected || disabled || busy !== ""}
                        onChange={(event) => updateAssetField(asset, "alt", event.target.value)}
                      />
                    </label>
                    <label htmlFor={captionId}>
                      {t("growth.contentMediaCaptionLabel")}
                      <input
                        id={captionId}
                        maxLength={2000}
                        value={fields.caption}
                        disabled={selected || disabled || busy !== ""}
                        onChange={(event) => updateAssetField(asset, "caption", event.target.value)}
                      />
                    </label>
                    <button className="btn" type="button" disabled={selected || disabled || busy !== ""} onClick={() => attach(asset)}>
                      {busy === `attach-${asset.id}`
                        ? t("growth.contentMediaAttaching")
                        : t(selected ? "growth.contentMediaLibrarySelected" : "growth.contentMediaAttach")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
      {operationError ? <p className="growth-media-picker-error" role="alert">{operationError}</p> : null}
    </div>
  );
}
