import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  buildGrowthAssetFileUrl,
  draftGrowthContentItem,
  markGrowthContentPublished,
} from "../../../api/growth";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import type { GrowthContentItem, GrowthContentMedia } from "../../../types/growth";
import { formatXThreadForCopy } from "../../../utils/goals";
import { GrowthMediaActions } from "../GrowthMediaActions";
import {
  GROWTH_QUEUE_SECTIONS,
  groupGrowthQueueItems,
  type GrowthCalendarWeekGrid,
  type GrowthQueueSection,
} from "../../../utils/growth/calendar";

interface GrowthQueueProps {
  items: readonly GrowthContentItem[];
  week: GrowthCalendarWeekGrid;
  timezone: string;
  pillarLabels: ReadonlyMap<string, string>;
  loading: boolean;
  error: string;
  onOpenItem: (item: GrowthContentItem) => void;
  onUpdateItem: (item: GrowthContentItem) => void;
}

const sectionKeys: Record<GrowthQueueSection, TranslationKey> = {
  needsDraft: "growth.queueSectionNeedsDraft",
  draft: "growth.queueSectionDraft",
  ready: "growth.queueSectionReady",
  scheduled: "growth.queueSectionScheduled",
  published: "growth.queueSectionPublished",
};

function queueItemTitle(item: GrowthContentItem): string {
  return item.title || item.angle || item.format;
}

function mediaPreviewUrl(media: GrowthContentMedia): string | undefined {
  return media.assetId ? buildGrowthAssetFileUrl(media.assetId) : media.url;
}

function QueueCopyButton({ label, text }: { label: string; text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await navigator.clipboard?.writeText(text);
    setCopied(true);
  }

  return (
    <button className="btn ghost" type="button" disabled={!text.trim()} onClick={() => void copy()}>
      {copied ? t("common.copied") : label}
    </button>
  );
}

interface GrowthQueueItemProps {
  item: GrowthContentItem;
  timezone: string;
  pillarLabel: string;
  onOpen: (item: GrowthContentItem) => void;
  onUpdate: (item: GrowthContentItem) => void;
}

function GrowthQueueItem({ item, timezone, pillarLabel, onOpen, onUpdate }: GrowthQueueItemProps) {
  const { language, t } = useI18n();
  const [publishedUrl, setPublishedUrl] = useState(item.publishedUrl ?? "");
  const [publishing, setPublishing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [publishError, setPublishError] = useState("");
  const title = queueItemTitle(item);
  const scheduledLabel = new Intl.DateTimeFormat(language, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(item.scheduledFor!));

  useEffect(() => {
    setPublishedUrl(item.publishedUrl ?? "");
    setDraftError("");
    setPublishError("");
  }, [item.publishedUrl, item.status]);

  async function draftAndOpen() {
    setDrafting(true);
    setDraftError("");
    try {
      const result = await draftGrowthContentItem(item.id);
      onUpdate(result.contentItem);
      onOpen(result.contentItem);
    } catch (cause) {
      setDraftError(t("growth.queueDraftError", { message: (cause as Error).message }));
    } finally {
      setDrafting(false);
    }
  }

  async function markPublished(event: FormEvent) {
    event.preventDefault();
    setPublishing(true);
    setPublishError("");
    try {
      onUpdate(await markGrowthContentPublished(item.id, publishedUrl.trim() || null));
    } catch (cause) {
      setPublishError((cause as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <article className={`growth-queue-item status-${item.status}`}>
      <header className="growth-queue-item-head">
        <div>
          <time dateTime={item.scheduledFor!}>{scheduledLabel}</time>
          <h3>{title}</h3>
        </div>
        <div className="growth-queue-badges">
          <span>{t(`growth.channel.${item.channel}` as TranslationKey)}</span>
          {pillarLabel ? <span>{pillarLabel}</span> : null}
          <span className={item.media.length ? "media-complete" : "media-missing"}>
            {t(item.media.length ? "growth.queueMediaComplete" : "growth.queueMediaMissing")}
          </span>
        </div>
      </header>

      <p className="growth-queue-copy-preview">{item.body || t("growth.contentBodyEmpty")}</p>
      <div className="growth-queue-copy-actions">
        <QueueCopyButton label={t("growth.queueCopyText")} text={item.body} />
        {item.format === "x-thread" && item.threadPosts.length ? (
          <QueueCopyButton
            label={t("growth.queueCopyThread")}
            text={formatXThreadForCopy({ content: item.body, threadPosts: item.threadPosts })}
          />
        ) : null}
        <button
          className="btn"
          type="button"
          disabled={drafting}
          onClick={() => item.status === "idea" ? void draftAndOpen() : onOpen(item)}
        >
          {drafting ? t("growth.queueDrafting") : t(item.status === "idea" ? "growth.queueOpenDraft" : "growth.queueOpenDetails")}
        </button>
      </div>
      {draftError ? <p className="growth-queue-publish-error" role="alert">{draftError}</p> : null}

      {item.media.length ? (
        <div className="growth-queue-media" aria-label={t("growth.contentMediaTitle")}>
          {item.media.map((media, index) => {
            const previewUrl = mediaPreviewUrl(media);
            return (
              <figure key={`${media.assetId ?? media.url ?? "media"}-${index}`}>
                {previewUrl && media.kind === "image" ? <img src={previewUrl} alt={media.alt} loading="lazy" referrerPolicy="no-referrer" /> : null}
                {previewUrl && media.kind === "video" ? <video src={previewUrl} aria-label={media.alt} controls preload="metadata" /> : null}
                {!previewUrl ? <span aria-hidden="true">{media.kind === "image" ? "▧" : "▶"}</span> : null}
                <figcaption>{media.alt}</figcaption>
                <GrowthMediaActions media={media} filename={`${title}-${index + 1}`} />
                {media.kind === "video" && previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer">{t("growth.contentOpenMedia")}</a> : null}
              </figure>
            );
          })}
        </div>
      ) : null}

      {item.sources.length ? (
        <ul className="growth-queue-sources" aria-label={t("growth.contentSourcesTitle")}>
          {item.sources.map((source) => <li key={source}><a href={source} target="_blank" rel="noreferrer">{source}</a></li>)}
        </ul>
      ) : null}

      {item.status !== "published" ? (
        <form className="growth-queue-publish" onSubmit={(event) => void markPublished(event)}>
          <label htmlFor={`growth-queue-published-url-${item.id}`}>{t("growth.contentPublishedUrlLabel")}</label>
          <div>
            <input
              id={`growth-queue-published-url-${item.id}`}
              type="url"
              value={publishedUrl}
              placeholder="https://"
              onChange={(event) => setPublishedUrl(event.target.value)}
            />
            <button className="btn primary" type="submit" disabled={publishing}>
              {publishing ? t("growth.contentPublishing") : t("growth.contentMarkPublished")}
            </button>
          </div>
          {publishError ? <p className="growth-queue-publish-error" role="alert">{publishError}</p> : null}
        </form>
      ) : item.publishedUrl ? (
        <a className="growth-queue-published-link" href={item.publishedUrl} target="_blank" rel="noreferrer">{item.publishedUrl}</a>
      ) : null}
    </article>
  );
}

export function GrowthQueue({
  items,
  week,
  timezone,
  pillarLabels,
  loading,
  error,
  onOpenItem,
  onUpdateItem,
}: GrowthQueueProps) {
  const { t } = useI18n();
  const groups = useMemo(
    () => groupGrowthQueueItems(items, week, timezone),
    [items, timezone, week],
  );
  const itemCount = GROWTH_QUEUE_SECTIONS.reduce((count, section) => count + groups[section].length, 0);

  if (loading) return <div className="growth-queue-state" role="status">{t("growth.queueLoading")}</div>;
  if (error) return <div className="growth-queue-error" role="alert">{t("growth.queueError", { message: error })}</div>;
  if (itemCount === 0) {
    return (
      <div className="growth-queue-empty">
        <strong>{t("growth.queueEmptyTitle")}</strong>
        <p>{t("growth.queueEmptyDescription")}</p>
      </div>
    );
  }

  return (
    <div className="growth-queue">
      <p className="growth-queue-note">{t("growth.queuePublishingNote")}</p>
      {GROWTH_QUEUE_SECTIONS.map((section) => (
        <section className={`growth-queue-section section-${section}`} key={section}>
          <header><h2>{t(sectionKeys[section])}</h2><span>{groups[section].length}</span></header>
          {groups[section].length ? (
            <div className="growth-queue-list">
              {groups[section].map((item) => (
                <GrowthQueueItem
                  key={item.id}
                  item={item}
                  timezone={timezone}
                  pillarLabel={item.pillar ? pillarLabels.get(item.pillar) ?? item.pillar : ""}
                  onOpen={onOpenItem}
                  onUpdate={onUpdateItem}
                />
              ))}
            </div>
          ) : <p className="growth-queue-section-empty">{t("growth.queueSectionEmpty")}</p>}
        </section>
      ))}
    </div>
  );
}
