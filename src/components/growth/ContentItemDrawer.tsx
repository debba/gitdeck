import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildGrowthAssetFileUrl,
  markGrowthContentPublished,
  patchGrowthContentItem,
} from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import {
  type GrowthContentItem,
  type GrowthContentItemStatus,
  type GrowthContentMedia,
} from "../../types/growth";
import { formatXThreadForCopy } from "../../utils/goals";
import { socialCharacterCount } from "../../utils/socialProposals";
import { CloseIcon } from "../common/Icons";
import { Markdown } from "../common/Markdown";
import { GrowthMediaActions } from "./GrowthMediaActions";
import { GrowthMediaPicker } from "./GrowthMediaPicker";

interface ContentItemDrawerProps {
  item: GrowthContentItem;
  onClose: () => void;
  onUpdate: (item: GrowthContentItem) => void;
}

const EDITABLE_STATUSES: GrowthContentItemStatus[] = ["idea", "draft", "ready", "skipped"];

function mediaPreviewUrl(media: GrowthContentMedia): string | undefined {
  return media.assetId ? buildGrowthAssetFileUrl(media.assetId) : media.url;
}

function toLocalDateTime(isoDate: string | null): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CopyButton({ label, text }: { label: string; text: string }) {
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
    <button className="btn ghost" type="button" onClick={() => void copy()}>
      {copied ? t("common.copied") : label}
    </button>
  );
}

export function ContentItemDrawer({ item, onClose, onUpdate }: ContentItemDrawerProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [threadPosts, setThreadPosts] = useState(item.threadPosts);
  const [scheduledFor, setScheduledFor] = useState(toLocalDateTime(item.scheduledFor));
  const [publishedUrl, setPublishedUrl] = useState(item.publishedUrl ?? "");
  const [evergreen, setEvergreen] = useState(item.evergreen === 1);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setTitle(item.title);
    setBody(item.body);
    setThreadPosts(item.threadPosts);
    setScheduledFor(toLocalDateTime(item.scheduledFor));
    setPublishedUrl(item.publishedUrl ?? "");
    setEvergreen(item.evergreen === 1);
    setError("");
  }, [item]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  async function persist(action: string, operation: () => Promise<GrowthContentItem>) {
    setBusy(action);
    setError("");
    try {
      onUpdate(await operation());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  function saveEdits() {
    void persist("save", () => patchGrowthContentItem(item.id, { title, body, threadPosts }));
  }

  async function saveMedia(media: GrowthContentMedia[]): Promise<void> {
    setBusy("media");
    setError("");
    try {
      onUpdate(await patchGrowthContentItem(item.id, { media }));
    } finally {
      setBusy("");
    }
  }

  function changeStatus(status: GrowthContentItemStatus) {
    void persist(`status-${status}`, () => patchGrowthContentItem(item.id, { status }));
  }

  function saveSchedule() {
    if (!scheduledFor) return;
    const parsed = new Date(scheduledFor);
    if (Number.isNaN(parsed.getTime())) {
      setError(t("growth.contentInvalidSchedule"));
      return;
    }
    void persist("schedule", () => patchGrowthContentItem(item.id, { scheduledFor: parsed.toISOString() }));
  }

  function clearSchedule() {
    void persist("schedule", () => patchGrowthContentItem(item.id, { scheduledFor: null }));
  }

  function markPublished() {
    void persist("publish", () => markGrowthContentPublished(item.id, publishedUrl.trim() || null));
  }

  async function changeEvergreen(checked: boolean) {
    setEvergreen(checked);
    setBusy("evergreen");
    setError("");
    try {
      const updated = await patchGrowthContentItem(item.id, { evergreen: checked ? 1 : 0 });
      setEvergreen(updated.evergreen === 1);
      onUpdate(updated);
    } catch (cause) {
      setEvergreen(item.evergreen === 1);
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  function updateThreadPost(index: number, value: string) {
    setThreadPosts((current) => current.map((post, postIndex) => postIndex === index ? value : post));
  }

  return createPortal(
    <div className="growth-content-drawer-root">
      <button className="growth-content-drawer-backdrop" type="button" aria-label={t("common.close")} onClick={onClose} />
      <aside className="growth-content-drawer" role="dialog" aria-modal="true" aria-labelledby="growth-content-drawer-title">
        <header className="growth-content-drawer-head">
          <div>
            <span>{t("growth.contentDrawerEyebrow")}</span>
            <h2 id="growth-content-drawer-title">{item.title || t(`goals.proposalFormat.${item.format}` as TranslationKey)}</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" type="button" aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>

        <div className="growth-content-drawer-body">
          <div className="growth-content-badges">
            <span>{item.channel}</span>
            <span>{t(`goals.proposalFormat.${item.format}` as TranslationKey)}</span>
            {item.pillar ? <span>{item.pillar}</span> : null}
            <span>{t(`growth.status.${item.status}` as TranslationKey)}</span>
          </div>
          {item.scheduledFor ? <p className="growth-content-date">{t("growth.contentScheduledFor", { date: new Date(item.scheduledFor).toLocaleString() })}</p> : null}
          {item.publishedAt ? <p className="growth-content-date">{t("growth.contentPublishedAt", { date: new Date(item.publishedAt).toLocaleString() })}</p> : null}
          {error ? <div className="growth-content-error" role="alert">{error}</div> : null}

          <section className="growth-content-section">
            <div className="growth-content-section-head"><h3>{t("growth.contentCopyTitle")}</h3><CopyButton label={t("growth.contentCopyText")} text={body} /></div>
            <Markdown className="growth-content-markdown">{body || t("growth.contentBodyEmpty")}</Markdown>
            {item.format === "x-thread" && threadPosts.length ? (
              <div className="growth-content-copy-thread"><CopyButton label={t("goals.copyThread")} text={formatXThreadForCopy({ content: body, threadPosts })} /></div>
            ) : null}
          </section>

          {threadPosts.length ? (
            <section className="growth-content-section">
              <div className="growth-content-section-head"><h3>{t("growth.contentThreadPosts")}</h3></div>
              <div className="goal-x-thread growth-content-thread">
                {threadPosts.map((post, index) => (
                  <section className="goal-x-post" key={index}>
                    <div className="goal-x-post-rail" aria-hidden="true"><span className="goal-x-avatar">X</span>{index < threadPosts.length - 1 ? <i /> : null}</div>
                    <div className="goal-x-post-body">
                      <header><strong>{item.repository}</strong><span>{index + 1}/{threadPosts.length}</span><CopyButton label={t("goals.copyPost", { count: index + 1 })} text={post} /></header>
                      <div className="goal-x-post-content">{post}</div>
                      <small className={socialCharacterCount(post) > 280 ? "over-limit" : ""}>{socialCharacterCount(post)}/280</small>
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ) : null}

          <section className="growth-content-section growth-content-edit">
            <h3>{t("growth.contentEditTitle")}</h3>
            <label>{t("growth.contentTitleLabel")}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>{t("growth.contentBodyLabel")}<textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)} /></label>
            {item.format === "x-thread" ? (
              <div className="growth-content-thread-edit">
                <strong>{t("growth.contentThreadPosts")}</strong>
                {threadPosts.map((post, index) => (
                  <label key={index}>
                    {t("growth.contentThreadPost", { count: index + 1 })}
                    <textarea rows={4} value={post} onChange={(event) => updateThreadPost(index, event.target.value)} />
                    <small className={socialCharacterCount(post) > 280 ? "over-limit" : ""}>{socialCharacterCount(post)}/280</small>
                    <button className="btn ghost" type="button" onClick={() => setThreadPosts((current) => current.filter((_, postIndex) => postIndex !== index))}>{t("growth.contentRemovePost")}</button>
                  </label>
                ))}
                <button className="btn ghost" type="button" onClick={() => setThreadPosts((current) => [...current, ""])}>{t("growth.contentAddPost")}</button>
              </div>
            ) : null}
            <button className="btn primary" type="button" disabled={busy !== ""} onClick={saveEdits}>{busy === "save" ? t("growth.contentSaving") : t("growth.contentSave")}</button>
          </section>

          <section className="growth-content-section">
            <h3>{t("growth.contentMediaTitle")}</h3>
            {item.media.length ? <div className="growth-content-media-list">{item.media.map((media, index) => {
              const previewUrl = mediaPreviewUrl(media);
              return (
                <article key={`${media.assetId ?? media.url ?? index}`}>
                  {previewUrl && media.kind === "image" ? <img src={previewUrl} alt={media.alt} loading="lazy" referrerPolicy="no-referrer" /> : null}
                  {previewUrl && media.kind === "video" ? <video src={previewUrl} aria-label={media.alt} controls preload="metadata" /> : null}
                  <div>
                    <strong>{media.alt}</strong>
                    <span>{media.kind}</span>
                    {media.caption ? <p>{media.caption}</p> : null}
                    <GrowthMediaActions media={media} filename={`${item.title || item.repository}-${index + 1}`} />
                    {media.kind === "video" && previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer">{t("growth.contentOpenMedia")}</a> : null}
                  </div>
                </article>
              );
            })}</div> : <p className="growth-content-empty-note">{t("growth.contentMediaEmpty")}</p>}
            <GrowthMediaPicker
              accountId={item.accountId}
              repository={item.repository}
              media={item.media}
              status={item.status}
              disabled={busy !== ""}
              onChange={saveMedia}
            />
          </section>

          <section className="growth-content-section">
            <h3>{t("growth.contentSourcesTitle")}</h3>
            {item.sources.length ? <ul className="growth-content-sources">{item.sources.map((source) => <li key={source}><a href={source} target="_blank" rel="noreferrer">{source}</a></li>)}</ul> : <p className="growth-content-empty-note">{t("growth.contentSourcesEmpty")}</p>}
          </section>

          <section className="growth-content-section growth-content-workflow">
            <label className="growth-content-evergreen">
              <input
                type="checkbox"
                checked={evergreen}
                disabled={busy !== ""}
                onChange={(event) => void changeEvergreen(event.target.checked)}
              />
              <span>
                <strong>{t("growth.contentEvergreenLabel")}</strong>
                <small>{busy === "evergreen" ? t("growth.contentEvergreenSaving") : t("growth.contentEvergreenDescription")}</small>
              </span>
            </label>
            <h3>{t("growth.contentStatusTitle")}</h3>
            <div className="growth-content-status-actions">
              {EDITABLE_STATUSES.filter((status) => status !== item.status).map((status) => (
                <button
                  className="btn ghost"
                  type="button"
                  key={status}
                  disabled={busy !== "" || (status === "ready" && item.media.length === 0)}
                  onClick={() => changeStatus(status)}
                >
                  {t(`growth.contentSetStatus.${status}` as TranslationKey)}
                </button>
              ))}
            </div>
            <label>{t("growth.contentScheduleLabel")}<input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label>
            <div className="growth-content-row">
              <button className="btn" type="button" disabled={busy !== "" || !scheduledFor} onClick={saveSchedule}>{t("growth.contentSchedule")}</button>
              {item.scheduledFor ? <button className="btn ghost" type="button" disabled={busy !== ""} onClick={clearSchedule}>{t("growth.contentClearSchedule")}</button> : null}
            </div>
            <label>{t("growth.contentPublishedUrlLabel")}<input type="url" value={publishedUrl} placeholder="https://" onChange={(event) => setPublishedUrl(event.target.value)} /></label>
            <button className="btn primary" type="button" disabled={busy !== ""} onClick={markPublished}>{busy === "publish" ? t("growth.contentPublishing") : t("growth.contentMarkPublished")}</button>
            <p className="growth-content-media-rule">{t("growth.contentMediaRule")}</p>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
