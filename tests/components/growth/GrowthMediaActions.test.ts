import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthMediaActions } from "../../../src/components/growth/GrowthMediaActions";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthContentMedia } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  clipboardItem: vi.fn(),
  clipboardWrite: vi.fn(),
  fetchGrowthAssetFile: vi.fn(),
  rasterizeGrowthImageToPng: vi.fn(),
  sanitizeGrowthPngFilename: vi.fn(() => "safe-growth-image.png"),
}));

vi.mock("../../../src/api/growth", () => ({
  fetchGrowthAssetFile: mocks.fetchGrowthAssetFile,
}));
vi.mock("../../../src/utils/growth/rasterize", () => ({
  rasterizeGrowthImageToPng: mocks.rasterizeGrowthImageToPng,
  sanitizeGrowthPngFilename: mocks.sanitizeGrowthPngFilename,
}));

function imageMedia(overrides: Partial<GrowthContentMedia> = {}): GrowthContentMedia {
  return {
    assetId: "asset-generated",
    kind: "image",
    alt: "Release image",
    ...overrides,
  };
}

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let container: HTMLDivElement;
let root: Root;
let png: Blob;
let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalRevokeObjectUrl: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  png = new Blob(["png output"], { type: "image/png" });
  mocks.rasterizeGrowthImageToPng.mockResolvedValue(png);
  mocks.clipboardWrite.mockResolvedValue(undefined);

  class MockClipboardItem {
    constructor(readonly items: Record<string, Blob>) {
      mocks.clipboardItem(items);
    }
  }
  vi.stubGlobal("ClipboardItem", MockClipboardItem);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: mocks.clipboardWrite, writeText: vi.fn() },
  });

  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  createObjectUrl = vi.fn(() => "blob:growth-download");
  revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  anchorClick.mockRestore();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

async function renderActions(media: GrowthContentMedia = imageMedia(), filename = "Release / launch.svg") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(GrowthMediaActions, { media, filename }),
    ));
  });
}

describe("GrowthMediaActions", () => {
  it("fetches a generated SVG asset and copies the rasterized PNG with the exact clipboard MIME", async () => {
    const svg = new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"></svg>',
    ], { type: "image/svg+xml" });
    mocks.fetchGrowthAssetFile.mockResolvedValue(svg);
    await renderActions();

    await act(async () => {
      button("Copy image").click();
      await flush();
    });

    expect(mocks.fetchGrowthAssetFile).toHaveBeenCalledWith("asset-generated", expect.any(AbortSignal));
    expect(mocks.rasterizeGrowthImageToPng).toHaveBeenCalledWith(svg, { background: "transparent" });
    expect(mocks.clipboardItem).toHaveBeenCalledWith({ "image/png": png });
    expect(mocks.clipboardWrite).toHaveBeenCalledWith([expect.any(ClipboardItem)]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Image copied as PNG.");
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("downloads an uploaded raster as a sanitized PNG and revokes its object URL", async () => {
    const upload = new Blob(["uploaded image"], { type: "image/webp" });
    mocks.fetchGrowthAssetFile.mockResolvedValue(upload);
    await renderActions(imageMedia({ assetId: "asset-upload" }), "Résumé / launch.webp");

    await act(async () => {
      button("Download image").click();
      await flush();
    });

    expect(mocks.fetchGrowthAssetFile).toHaveBeenCalledWith("asset-upload", expect.any(AbortSignal));
    expect(mocks.rasterizeGrowthImageToPng).toHaveBeenCalledWith(upload, { background: "transparent" });
    expect(mocks.sanitizeGrowthPngFilename).toHaveBeenCalledWith("Résumé / launch.webp");
    expect(createObjectUrl).toHaveBeenCalledWith(png);
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:growth-download");
    expect(document.body.querySelector('a[download="safe-growth-image.png"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("PNG downloaded.");
  });

  it("downloads immediately with a fallback notice when ClipboardItem is unsupported", async () => {
    mocks.fetchGrowthAssetFile.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    vi.stubGlobal("ClipboardItem", undefined);
    await renderActions();

    await act(async () => {
      button("Copy image").click();
      await flush();
    });

    expect(mocks.clipboardWrite).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:growth-download");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("PNG download was started instead");
  });

  it("downloads the same PNG when an image clipboard write rejects", async () => {
    mocks.fetchGrowthAssetFile.mockResolvedValue(new Blob(["image"], { type: "image/jpeg" }));
    mocks.clipboardWrite.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    await renderActions();

    await act(async () => {
      button("Copy image").click();
      await flush();
    });

    expect(mocks.clipboardWrite).toHaveBeenCalledOnce();
    expect(createObjectUrl).toHaveBeenCalledWith(png);
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("PNG download was started instead");
  });

  it("offers the external source after a legacy CORS failure without making a social request", async () => {
    const mediaUrl = "https://cdn.example/release.png";
    const mediaFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", mediaFetch);
    await renderActions(imageMedia({ assetId: undefined, url: mediaUrl }));

    await act(async () => {
      button("Copy image").click();
      await flush();
    });

    expect(mediaFetch).toHaveBeenCalledWith(mediaUrl, expect.objectContaining({
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    }));
    expect(mediaFetch.mock.calls.every(([url, init]) => (
      url === mediaUrl && (!init?.method || init.method === "GET")
    ))).toBe(true);
    expect(mocks.fetchGrowthAssetFile).not.toHaveBeenCalled();
    expect(mocks.rasterizeGrowthImageToPng).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLAnchorElement>('a[target="_blank"]')?.href).toBe(mediaUrl);
    expect(container.textContent).toContain("Use Download image or open the source image");
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("disables duplicate media actions while one image is being prepared", async () => {
    let resolveRaster: ((blob: Blob) => void) | undefined;
    mocks.fetchGrowthAssetFile.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    mocks.rasterizeGrowthImageToPng.mockImplementationOnce(() => new Promise<Blob>((resolve) => {
      resolveRaster = resolve;
    }));
    await renderActions();

    await act(async () => {
      button("Copy image").click();
      await flush();
    });
    expect(button("Preparing image…").disabled).toBe(true);
    expect(button("Download image").disabled).toBe(true);
    button("Download image").click();
    expect(mocks.fetchGrowthAssetFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRaster?.(png);
      await flush();
    });
    expect(container.textContent).toContain("Image copied as PNG");
  });

  it("shows an error when an explicit PNG download cannot rasterize the image", async () => {
    mocks.fetchGrowthAssetFile.mockResolvedValue(new Blob(["broken"], { type: "image/png" }));
    mocks.rasterizeGrowthImageToPng.mockRejectedValueOnce(new Error("Canvas unavailable"));
    await renderActions();

    await act(async () => {
      button("Download image").click();
      await flush();
    });

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Could not prepare this image: Canvas unavailable");
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("renders no image actions or media requests for videos", async () => {
    await renderActions({ assetId: "asset-video", kind: "video", alt: "Demo video" });

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(mocks.fetchGrowthAssetFile).not.toHaveBeenCalled();
    expect(mocks.rasterizeGrowthImageToPng).not.toHaveBeenCalled();
  });
});
