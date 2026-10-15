import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  buildGrowthAssetFileUrl,
  createGrowthCard,
  fetchGrowthAssetImportCandidates,
  fetchGrowthAssets,
  importGrowthAsset,
  uploadGrowthAsset,
} from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import {
  GROWTH_ASSET_MIME_TYPES,
  GROWTH_CARD_TEMPLATES,
  type GrowthAssetImportCandidate,
  type GrowthAssetKind,
  type GrowthAssetMetadata,
  type GrowthAssetOrigin,
  type GrowthCardTemplate,
} from "../../types/growth";
import {
  validateGrowthAssetUpload,
  type GrowthAssetUploadValidationIssue,
} from "../../utils/growth/assets";
import {
  createGrowthCardInputFromForm,
  EMPTY_GROWTH_CARD_FORM,
  type GrowthCardFormFields,
} from "../../utils/growth/cardForm";

interface GrowthAssetLibraryProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
}

interface ImageDimensions {
  width?: number;
  height?: number;
}

interface ImportCandidateFields {
  title: string;
  alt: string;
}

const validationKeys: Record<GrowthAssetUploadValidationIssue, TranslationKey> = {
  "missing-file": "growth.assetsValidationMissingFile",
  "missing-title": "growth.assetsValidationMissingTitle",
  "missing-alt": "growth.assetsValidationMissingAlt",
  "unsupported-type": "growth.assetsValidationUnsupportedType",
  "empty-file": "growth.assetsValidationEmptyFile",
  "file-too-large": "growth.assetsValidationTooLarge",
};
const kindKeys: Record<GrowthAssetKind, TranslationKey> = {
  image: "growth.assetsKindImage",
  video: "growth.assetsKindVideo",
};
const originKeys: Record<GrowthAssetOrigin, TranslationKey> = {
  upload: "growth.assetsOriginUpload",
  readme: "growth.assetsOriginReadme",
  website: "growth.assetsOriginWebsite",
  generated: "growth.assetsOriginGenerated",
};
const cardTemplateKeys: Record<GrowthCardTemplate, TranslationKey> = {
  release: "growth.cardsTemplateRelease",
  milestone: "growth.cardsTemplateMilestone",
  stats: "growth.cardsTemplateStats",
  quote: "growth.cardsTemplateQuote",
  "whats-new": "growth.cardsTemplateWhatsNew",
};

async function readImageDimensions(file: File, signal: AbortSignal): Promise<ImageDimensions> {
  if (!file.type.startsWith("image/") || typeof Image === "undefined" || !URL.createObjectURL) return {};

  return new Promise((resolve) => {
    const image = new Image();
    let objectUrl = "";
    let settled = false;
    const finish = (dimensions: ImageDimensions) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (objectUrl && URL.revokeObjectURL) URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };
    const abort = () => finish({});
    image.onload = () => finish({
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
    });
    image.onerror = () => finish({});
    signal.addEventListener("abort", abort, { once: true });
    try {
      objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
    } catch {
      finish({});
    }
  });
}

export function GrowthAssetLibrary({ accountId, enabled, repository }: GrowthAssetLibraryProps) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<GrowthAssetMetadata[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [alt, setAlt] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [uploaded, setUploaded] = useState(false);
  const [cardTemplate, setCardTemplate] = useState<GrowthCardTemplate>("release");
  const [cardFields, setCardFields] = useState<GrowthCardFormFields>(EMPTY_GROWTH_CARD_FORM);
  const [cardCreating, setCardCreating] = useState(false);
  const [cardError, setCardError] = useState("");
  const [cardCreated, setCardCreated] = useState<GrowthAssetMetadata | null>(null);
  const [importCandidates, setImportCandidates] = useState<GrowthAssetImportCandidate[]>([]);
  const [importFields, setImportFields] = useState<Record<string, ImportCandidateFields>>({});
  const [importedAssets, setImportedAssets] = useState<Record<string, GrowthAssetMetadata>>({});
  const [importMessages, setImportMessages] = useState<Record<string, string>>({});
  const [importErrors, setImportErrors] = useState<Record<string, string>>({});
  const [importBusy, setImportBusy] = useState<Record<string, boolean>>({});
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const cardControllerRef = useRef<AbortController | null>(null);
  const candidateControllerRef = useRef<AbortController | null>(null);
  const importControllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    cardControllerRef.current?.abort();
    cardControllerRef.current = null;
    candidateControllerRef.current?.abort();
    candidateControllerRef.current = null;
    importControllersRef.current.forEach((controller) => controller.abort());
    importControllersRef.current.clear();
    setAssets([]);
    setFile(null);
    setTitle("");
    setAlt("");
    setLoadError("");
    setUploadError("");
    setValidationError("");
    setUploaded(false);
    setUploading(false);
    setCardTemplate("release");
    setCardFields(EMPTY_GROWTH_CARD_FORM);
    setCardCreating(false);
    setCardError("");
    setCardCreated(null);
    setImportCandidates([]);
    setImportFields({});
    setImportedAssets({});
    setImportMessages({});
    setImportErrors({});
    setImportBusy({});
    setCandidateError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!enabled || !accountId || !repository) {
      setLoading(false);
      setCandidateLoading(false);
      return;
    }

    const controller = new AbortController();
    const candidateController = new AbortController();
    candidateControllerRef.current = candidateController;
    setLoading(true);
    setCandidateLoading(true);
    void fetchGrowthAssets(repository, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAssets(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setLoadError(t("growth.assetsLoadError", { message: (cause as Error).message }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void fetchGrowthAssetImportCandidates(repository, candidateController.signal)
      .then((result) => {
        if (candidateController.signal.aborted) return;
        setImportCandidates(result);
        setImportFields(Object.fromEntries(result.map((candidate) => [
          candidate.url,
          { title: candidate.title, alt: candidate.alt },
        ])));
      })
      .catch((cause: unknown) => {
        if (!candidateController.signal.aborted && (cause as Error).name !== "AbortError") {
          setCandidateError(t("growth.assetsImportLoadError", { message: (cause as Error).message }));
        }
      })
      .finally(() => {
        if (!candidateController.signal.aborted) setCandidateLoading(false);
      });

    return () => {
      controller.abort();
      candidateController.abort();
      uploadControllerRef.current?.abort();
      cardControllerRef.current?.abort();
      importControllersRef.current.forEach((activeController) => activeController.abort());
    };
  }, [accountId, enabled, repository, t]);

  async function refreshImportCandidates() {
    candidateControllerRef.current?.abort();
    const controller = new AbortController();
    candidateControllerRef.current = controller;
    setCandidateLoading(true);
    setCandidateError("");
    try {
      const result = await fetchGrowthAssetImportCandidates(repository, controller.signal);
      if (controller.signal.aborted) return;
      setImportCandidates(result);
      setImportFields(Object.fromEntries(result.map((candidate) => [
        candidate.url,
        importFields[candidate.url] ?? { title: candidate.title, alt: candidate.alt },
      ])));
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setCandidateError(t("growth.assetsImportLoadError", { message: (cause as Error).message }));
      }
    } finally {
      if (candidateControllerRef.current === controller) {
        candidateControllerRef.current = null;
        setCandidateLoading(false);
      }
    }
  }

  async function saveImportCandidate(candidate: GrowthAssetImportCandidate) {
    const fields = importFields[candidate.url] ?? { title: candidate.title, alt: candidate.alt };
    if (!fields.title.trim() || !fields.alt.trim()) {
      setImportErrors((current) => ({ ...current, [candidate.url]: t("growth.assetsImportMetadataRequired") }));
      return;
    }
    importControllersRef.current.get(candidate.url)?.abort();
    const controller = new AbortController();
    importControllersRef.current.set(candidate.url, controller);
    setImportBusy((current) => ({ ...current, [candidate.url]: true }));
    setImportErrors((current) => ({ ...current, [candidate.url]: "" }));
    setImportMessages((current) => ({ ...current, [candidate.url]: "" }));
    try {
      const result = await importGrowthAsset({
        repository,
        origin: candidate.origin,
        url: candidate.url,
        title: fields.title.trim(),
        alt: fields.alt.trim(),
      }, controller.signal);
      if (controller.signal.aborted) return;
      setAssets((current) => [result.asset, ...current.filter((asset) => asset.id !== result.asset.id)]);
      setImportedAssets((current) => ({ ...current, [candidate.url]: result.asset }));
      setImportMessages((current) => ({
        ...current,
        [candidate.url]: t(result.duplicate ? "growth.assetsImportDuplicate" : "growth.assetsImported"),
      }));
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setImportErrors((current) => ({
          ...current,
          [candidate.url]: t("growth.assetsImportError", { message: (cause as Error).message }),
        }));
      }
    } finally {
      if (importControllersRef.current.get(candidate.url) === controller) {
        importControllersRef.current.delete(candidate.url);
        setImportBusy((current) => ({ ...current, [candidate.url]: false }));
      }
    }
  }

  function updateCardField<Field extends keyof GrowthCardFormFields>(field: Field, value: GrowthCardFormFields[Field]) {
    setCardFields((current) => ({ ...current, [field]: value }));
    setCardError("");
    setCardCreated(null);
  }

  async function submitCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCardError("");
    setCardCreated(null);
    const input = createGrowthCardInputFromForm(repository, cardTemplate, cardFields);
    if (!input) {
      setCardError(t("growth.cardsValidation"));
      return;
    }

    cardControllerRef.current?.abort();
    const controller = new AbortController();
    cardControllerRef.current = controller;
    setCardCreating(true);
    try {
      const saved = await createGrowthCard(input, controller.signal);
      if (controller.signal.aborted) return;
      setAssets((current) => [saved, ...current.filter((asset) => asset.id !== saved.id)]);
      setCardCreated(saved);
      try {
        const refreshed = await fetchGrowthAssets(repository, controller.signal);
        if (!controller.signal.aborted) setAssets(refreshed);
      } catch (cause) {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setCardError(t("growth.cardsRefreshError", { message: (cause as Error).message }));
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setCardError(t("growth.cardsCreateError", { message: (cause as Error).message }));
      }
    } finally {
      if (cardControllerRef.current === controller) {
        cardControllerRef.current = null;
        setCardCreating(false);
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError("");
    setUploadError("");
    setLoadError("");
    setUploaded(false);
    const issue = validateGrowthAssetUpload({ file, title, alt });
    if (issue) {
      setValidationError(t(validationKeys[issue]));
      return;
    }

    const selectedFile = file as File;
    const controller = new AbortController();
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = controller;
    setUploading(true);
    try {
      const dimensions = await readImageDimensions(selectedFile, controller.signal);
      if (controller.signal.aborted) return;
      const saved = await uploadGrowthAsset({
        repository,
        file: selectedFile,
        filename: selectedFile.name,
        title: title.trim(),
        alt: alt.trim(),
        ...dimensions,
      }, controller.signal);
      if (controller.signal.aborted) return;

      setAssets((current) => [saved, ...current.filter((asset) => asset.id !== saved.id)]);
      setFile(null);
      setTitle("");
      setAlt("");
      setUploaded(true);
      if (fileInputRef.current) fileInputRef.current.value = "";

      try {
        const refreshed = await fetchGrowthAssets(repository, controller.signal);
        if (!controller.signal.aborted) setAssets(refreshed);
      } catch (cause) {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setLoadError(t("growth.assetsRefreshError", { message: (cause as Error).message }));
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setUploadError(t("growth.assetsUploadError", { message: (cause as Error).message }));
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        setUploading(false);
      }
    }
  }

  return (
    <section className="growth-library-card growth-asset-library" aria-labelledby="growth-assets-title">
      <div className="growth-library-section-heading growth-asset-library-heading">
        <div>
          <span>{t("growth.assetsEyebrow")}</span>
          <h2 id="growth-assets-title">{t("growth.assetsTitle")}</h2>
          <p>{t("growth.assetsDescription")}</p>
        </div>
      </div>

      <form className="growth-asset-upload" aria-busy={uploading} onSubmit={(event) => void submit(event)}>
        <div className="growth-asset-upload-heading">
          <h3>{t("growth.assetsUploadTitle")}</h3>
          <p>{t("growth.assetsUploadHint")}</p>
        </div>
        <label htmlFor="growth-asset-file">
          {t("growth.assetsFile")}
          <input
            ref={fileInputRef}
            id="growth-asset-file"
            type="file"
            required
            accept={GROWTH_ASSET_MIME_TYPES.join(",")}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setValidationError("");
              setUploadError("");
              setUploaded(false);
            }}
          />
        </label>
        <label htmlFor="growth-asset-title">
          {t("growth.assetsTitleLabel")}
          <input
            id="growth-asset-title"
            value={title}
            required
            maxLength={500}
            onChange={(event) => {
              setTitle(event.target.value);
              setValidationError("");
              setUploaded(false);
            }}
          />
        </label>
        <label className="growth-asset-alt-field" htmlFor="growth-asset-alt">
          {t("growth.assetsAltLabel")}
          <textarea
            id="growth-asset-alt"
            value={alt}
            required
            maxLength={2000}
            rows={2}
            onChange={(event) => {
              setAlt(event.target.value);
              setValidationError("");
              setUploaded(false);
            }}
          />
          <small>{t("growth.assetsAltHint")}</small>
        </label>
        <button className="btn primary" type="submit" disabled={uploading}>
          {uploading ? t("growth.assetsUploading") : t("growth.assetsUpload")}
        </button>
      </form>

      <form className="growth-card-creator" aria-busy={cardCreating} onSubmit={(event) => void submitCard(event)}>
        <div className="growth-card-creator-heading">
          <h3>{t("growth.cardsTitle")}</h3>
          <p>{t("growth.cardsDescription")}</p>
        </div>
        <div className="growth-card-creator-fields">
          <label htmlFor="growth-card-template">
            {t("growth.cardsTemplate")}
            <select
              id="growth-card-template"
              value={cardTemplate}
              onChange={(event) => {
                setCardTemplate(event.target.value as GrowthCardTemplate);
                setCardError("");
                setCardCreated(null);
              }}
            >
              {GROWTH_CARD_TEMPLATES.map((template) => (
                <option key={template} value={template}>{t(cardTemplateKeys[template])}</option>
              ))}
            </select>
          </label>
          <label htmlFor="growth-card-title">
            {t("growth.assetsTitleLabel")}
            <input
              id="growth-card-title"
              required
              maxLength={500}
              value={cardFields.title}
              onChange={(event) => updateCardField("title", event.target.value)}
            />
          </label>
          <label className="growth-card-wide-field" htmlFor="growth-card-alt">
            {t("growth.assetsAltLabel")}
            <textarea
              id="growth-card-alt"
              required
              maxLength={2000}
              rows={2}
              value={cardFields.alt}
              onChange={(event) => updateCardField("alt", event.target.value)}
            />
          </label>

          {cardTemplate === "release" ? (
            <>
              <label htmlFor="growth-card-version">
                {t("growth.cardsVersion")}
                <input
                  id="growth-card-version"
                  required
                  maxLength={80}
                  value={cardFields.version}
                  onChange={(event) => updateCardField("version", event.target.value)}
                />
              </label>
              <label className="growth-card-wide-field" htmlFor="growth-card-highlights">
                {t("growth.cardsHighlights")}
                <textarea
                  id="growth-card-highlights"
                  required
                  maxLength={483}
                  rows={4}
                  value={cardFields.highlights}
                  onChange={(event) => updateCardField("highlights", event.target.value)}
                />
                <small>{t("growth.cardsHighlightsHint")}</small>
              </label>
            </>
          ) : null}

          {cardTemplate === "milestone" ? (
            <>
              <label htmlFor="growth-card-milestone-value">
                {t("growth.cardsMilestoneValue")}
                <input
                  id="growth-card-milestone-value"
                  required
                  type="number"
                  min={0}
                  max={999999999}
                  step={1}
                  value={cardFields.milestoneValue}
                  onChange={(event) => updateCardField("milestoneValue", event.target.value)}
                />
              </label>
              <label htmlFor="growth-card-milestone-label">
                {t("growth.cardsMilestoneLabel")}
                <input
                  id="growth-card-milestone-label"
                  required
                  maxLength={80}
                  value={cardFields.milestoneLabel}
                  onChange={(event) => updateCardField("milestoneLabel", event.target.value)}
                />
              </label>
              <label className="growth-card-wide-field" htmlFor="growth-card-milestone-detail">
                {t("growth.cardsMilestoneDetail")}
                <textarea
                  id="growth-card-milestone-detail"
                  required
                  maxLength={160}
                  rows={2}
                  value={cardFields.milestoneDetail}
                  onChange={(event) => updateCardField("milestoneDetail", event.target.value)}
                />
              </label>
            </>
          ) : null}

          {cardTemplate === "stats" ? (
            <label className="growth-card-wide-field" htmlFor="growth-card-stats">
              {t("growth.cardsStats")}
              <textarea
                id="growth-card-stats"
                required
                maxLength={260}
                rows={4}
                value={cardFields.stats}
                onChange={(event) => updateCardField("stats", event.target.value)}
              />
              <small>{t("growth.cardsStatsHint")}</small>
            </label>
          ) : null}

          {cardTemplate === "quote" ? (
            <>
              <label className="growth-card-wide-field" htmlFor="growth-card-quote">
                {t("growth.cardsQuote")}
                <textarea
                  id="growth-card-quote"
                  required
                  maxLength={280}
                  rows={4}
                  value={cardFields.quote}
                  onChange={(event) => updateCardField("quote", event.target.value)}
                />
              </label>
              <label htmlFor="growth-card-attribution">
                {t("growth.cardsAttribution")}
                <input
                  id="growth-card-attribution"
                  required
                  maxLength={100}
                  value={cardFields.attribution}
                  onChange={(event) => updateCardField("attribution", event.target.value)}
                />
              </label>
            </>
          ) : null}

          {cardTemplate === "whats-new" ? (
            <label className="growth-card-wide-field" htmlFor="growth-card-whats-new">
              {t("growth.cardsWhatsNewItems")}
              <textarea
                id="growth-card-whats-new"
                required
                maxLength={604}
                rows={5}
                value={cardFields.whatsNewItems}
                onChange={(event) => updateCardField("whatsNewItems", event.target.value)}
              />
              <small>{t("growth.cardsWhatsNewHint")}</small>
            </label>
          ) : null}
        </div>
        <button className="btn primary" type="submit" disabled={cardCreating}>
          {cardCreating ? t("growth.cardsCreating") : t("growth.cardsCreate")}
        </button>
        {cardError ? <p className="growth-asset-error" role="alert">{cardError}</p> : null}
        {cardCreated ? (
          <div className="growth-card-created" role="status">
            <p>{t("growth.cardsCreated")}</p>
            <img src={buildGrowthAssetFileUrl(cardCreated.id)} alt={cardCreated.alt} />
          </div>
        ) : null}
      </form>

      <section className="growth-asset-import" aria-labelledby="growth-assets-import-title">
        <div className="growth-asset-import-heading">
          <div>
            <h3 id="growth-assets-import-title">{t("growth.assetsImportTitle")}</h3>
            <p>{t("growth.assetsImportDescription")}</p>
          </div>
          <button
            className="btn ghost"
            type="button"
            disabled={candidateLoading}
            onClick={() => void refreshImportCandidates()}
          >
            {candidateLoading ? t("growth.assetsImportDiscovering") : t("growth.assetsImportRefresh")}
          </button>
        </div>
        {candidateLoading ? <p className="growth-asset-state" role="status">{t("growth.assetsImportLoading")}</p> : null}
        {candidateError ? <p className="growth-asset-error" role="alert">{candidateError}</p> : null}
        {!candidateLoading && !candidateError && importCandidates.length === 0 ? (
          <div className="growth-asset-state growth-asset-empty">
            <h3>{t("growth.assetsImportEmptyTitle")}</h3>
            <p>{t("growth.assetsImportEmptyDescription")}</p>
          </div>
        ) : null}
        {importCandidates.length ? (
          <div className="growth-asset-import-list">
            {importCandidates.map((candidate, index) => {
              const fields = importFields[candidate.url] ?? { title: candidate.title, alt: candidate.alt };
              const importedAsset = importedAssets[candidate.url];
              const titleId = `growth-asset-import-title-${index}`;
              const altId = `growth-asset-import-alt-${index}`;
              return (
                <article
                  className={`growth-asset-import-card${importedAsset ? " is-imported" : ""}`}
                  key={candidate.url}
                  aria-busy={Boolean(importBusy[candidate.url])}
                >
                  {importedAsset ? (
                    <div className="growth-asset-import-preview">
                      {importedAsset.kind === "image" ? (
                        <img src={buildGrowthAssetFileUrl(importedAsset.id)} alt={importedAsset.alt} loading="lazy" />
                      ) : (
                        <video
                          src={buildGrowthAssetFileUrl(importedAsset.id)}
                          aria-label={t("growth.assetsVideoPreview", { title: importedAsset.title })}
                          controls
                          preload="metadata"
                        />
                      )}
                    </div>
                  ) : null}
                  <div className="growth-asset-import-card-body">
                    <div className="growth-asset-badges">
                      <span>{t(originKeys[candidate.origin])}</span>
                      <span>{t("growth.assetsImportSource")}: {candidate.source}</span>
                    </div>
                    <code title={candidate.url}>{candidate.url}</code>
                    <label htmlFor={titleId}>
                      {t("growth.assetsTitleLabel")}
                      <input
                        id={titleId}
                        required
                        maxLength={500}
                        value={fields.title}
                        onChange={(event) => setImportFields((current) => ({
                          ...current,
                          [candidate.url]: { ...fields, title: event.target.value },
                        }))}
                      />
                    </label>
                    <label htmlFor={altId}>
                      {t("growth.assetsAltLabel")}
                      <textarea
                        id={altId}
                        required
                        maxLength={2000}
                        rows={2}
                        value={fields.alt}
                        onChange={(event) => setImportFields((current) => ({
                          ...current,
                          [candidate.url]: { ...fields, alt: event.target.value },
                        }))}
                      />
                    </label>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={Boolean(importBusy[candidate.url])}
                      onClick={() => void saveImportCandidate(candidate)}
                    >
                      {importBusy[candidate.url] ? t("growth.assetsImporting") : t("growth.assetsImport")}
                    </button>
                    {importErrors[candidate.url] ? <p className="growth-asset-error" role="alert">{importErrors[candidate.url]}</p> : null}
                    {importMessages[candidate.url] ? <p className="growth-asset-success" role="status">{importMessages[candidate.url]}</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      {validationError ? <p className="growth-asset-error" role="alert">{validationError}</p> : null}
      {uploadError ? <p className="growth-asset-error" role="alert">{uploadError}</p> : null}
      {loadError ? <p className="growth-asset-error" role="alert">{loadError}</p> : null}
      {uploading ? <p className="growth-asset-progress" role="status">{t("growth.assetsUploadProgress")}</p> : null}
      {uploaded ? <p className="growth-asset-success" role="status">{t("growth.assetsUploaded")}</p> : null}
      {loading ? <p className="growth-asset-state" role="status">{t("growth.assetsLoading")}</p> : null}
      {!loading && !loadError && assets.length === 0 ? (
        <div className="growth-asset-state growth-asset-empty">
          <h3>{t("growth.assetsEmptyTitle")}</h3>
          <p>{t("growth.assetsEmptyDescription")}</p>
        </div>
      ) : null}

      {assets.length ? (
        <div className="growth-asset-grid" aria-label={t("growth.assetsGridLabel")}>
          {assets.map((asset) => {
            const previewUrl = buildGrowthAssetFileUrl(asset.id);
            return (
              <article className="growth-asset-card" key={asset.id}>
                <div className="growth-asset-preview">
                  {asset.kind === "image" ? (
                    <img src={previewUrl} alt={asset.alt} loading="lazy" />
                  ) : (
                    <video
                      src={previewUrl}
                      aria-label={t("growth.assetsVideoPreview", { title: asset.title })}
                      controls
                      preload="metadata"
                    />
                  )}
                </div>
                <div className="growth-asset-card-body">
                  <div className="growth-asset-badges">
                    <span>{t(kindKeys[asset.kind])}</span>
                    <span>{t(originKeys[asset.origin])}</span>
                  </div>
                  <h3>{asset.title}</h3>
                  <dl>
                    <div>
                      <dt>{t("growth.assetsDimensions")}</dt>
                      <dd>{asset.width && asset.height
                        ? t("growth.assetsDimensionsValue", { width: asset.width, height: asset.height })
                        : t("growth.assetsDimensionsUnknown")}</dd>
                    </div>
                    <div>
                      <dt>{t("growth.assetsAltText")}</dt>
                      <dd>{asset.alt}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
