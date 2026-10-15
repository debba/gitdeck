import { useEffect, useRef, useState } from "react";
import { fetchGrowthAssetFile } from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import type { GrowthContentMedia } from "../../types/growth";
import {
  rasterizeGrowthImageToPng,
  sanitizeGrowthPngFilename,
} from "../../utils/growth/rasterize";

interface GrowthMediaActionsProps {
  media: GrowthContentMedia;
  filename?: string;
}

type MediaAction = "copy" | "download";
type MediaOutcome = "idle" | "copied" | "downloaded" | "fallback" | "error";

function legacyMediaUrl(media: GrowthContentMedia): string | null {
  if (media.assetId || !media.url) return null;
  try {
    const parsed = new URL(media.url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

async function fetchMediaBlob(media: GrowthContentMedia, signal: AbortSignal): Promise<Blob> {
  if (media.assetId?.trim()) return fetchGrowthAssetFile(media.assetId.trim(), signal);

  const sourceUrl = legacyMediaUrl(media);
  if (!sourceUrl) throw new Error("Image source is unavailable");
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
  return response.blob();
}

function downloadPng(blob: Blob, filename: string): void {
  if (
    typeof URL.createObjectURL !== "function"
    || typeof URL.revokeObjectURL !== "function"
  ) {
    throw new Error("Browser downloads are unavailable");
  }

  let objectUrl = "";
  let link: HTMLAnchorElement | null = null;
  try {
    objectUrl = URL.createObjectURL(blob);
    link = document.createElement("a");
    link.href = objectUrl;
    link.download = sanitizeGrowthPngFilename(filename);
    link.hidden = true;
    document.body.append(link);
    link.click();
  } finally {
    link?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : "Unknown image error";
}

export function GrowthMediaActions({ media, filename }: GrowthMediaActionsProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<MediaAction | null>(null);
  const [outcome, setOutcome] = useState<MediaOutcome>("idle");
  const [detail, setDetail] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const sourceUrl = legacyMediaUrl(media);
  const downloadName = filename?.trim() || media.alt;

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(null);
    setOutcome("idle");
    setDetail("");
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [media.assetId, media.kind, media.url]);

  if (media.kind !== "image") return null;

  async function preparePng(signal: AbortSignal): Promise<Blob> {
    const source = await fetchMediaBlob(media, signal);
    return rasterizeGrowthImageToPng(source, { background: "transparent" });
  }

  async function run(action: MediaAction) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(action);
    setOutcome("idle");
    setDetail("");

    let png: Blob;
    try {
      png = await preparePng(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDetail(errorMessage(cause));
        setOutcome(action === "copy" ? "fallback" : "error");
      }
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(null);
      }
      return;
    }

    if (controller.signal.aborted) return;
    try {
      if (action === "copy") {
        const clipboard = navigator.clipboard;
        if (typeof ClipboardItem !== "function" || typeof clipboard?.write !== "function") {
          downloadPng(png, downloadName);
          setOutcome("fallback");
        } else {
          try {
            await clipboard.write([new ClipboardItem({ "image/png": png })]);
            if (!controller.signal.aborted) setOutcome("copied");
          } catch {
            if (!controller.signal.aborted) {
              downloadPng(png, downloadName);
              setOutcome("fallback");
            }
          }
        }
      } else {
        downloadPng(png, downloadName);
        setOutcome("downloaded");
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDetail(errorMessage(cause));
        setOutcome("error");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(null);
      }
    }
  }

  return (
    <div className="growth-media-actions">
      <div className="growth-media-action-buttons">
        <button
          className="btn ghost"
          type="button"
          disabled={busy !== null}
          aria-label={t("growth.mediaCopyImageLabel", { name: media.alt })}
          onClick={() => void run("copy")}
        >
          {busy === "copy" ? t("growth.mediaPreparingImage") : t("growth.mediaCopyImage")}
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy !== null}
          aria-label={t("growth.mediaDownloadImageLabel", { name: media.alt })}
          onClick={() => void run("download")}
        >
          {busy === "download" ? t("growth.mediaPreparingImage") : t("growth.mediaDownloadImage")}
        </button>
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer">{t("growth.mediaOpenSource")}</a>
        ) : null}
      </div>
      {outcome === "copied" ? <p className="growth-media-action-message success" role="status">{t("growth.mediaCopiedImage")}</p> : null}
      {outcome === "downloaded" ? <p className="growth-media-action-message success" role="status">{t("growth.mediaDownloadedImage")}</p> : null}
      {outcome === "fallback" ? (
        <p className="growth-media-action-message fallback" role="status">
          {detail
            ? t("growth.mediaPrepareFallback", { message: detail })
            : t("growth.mediaClipboardFallback")}
        </p>
      ) : null}
      {outcome === "error" ? <p className="growth-media-action-message error" role="alert">{t("growth.mediaError", { message: detail })}</p> : null}
    </div>
  );
}
