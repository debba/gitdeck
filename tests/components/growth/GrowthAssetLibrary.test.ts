import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthAssetLibrary } from "../../../src/components/growth/GrowthAssetLibrary";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthAssetMetadata } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthAssetFileUrl: vi.fn((id: string) => `/api/growth/assets/${id}/file`),
  createGrowthCard: vi.fn(),
  fetchGrowthAssetImportCandidates: vi.fn(),
  fetchGrowthAssets: vi.fn(),
  importGrowthAsset: vi.fn(),
  uploadGrowthAsset: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthAssetFileUrl: mocks.buildGrowthAssetFileUrl,
  createGrowthCard: mocks.createGrowthCard,
  fetchGrowthAssetImportCandidates: mocks.fetchGrowthAssetImportCandidates,
  fetchGrowthAssets: mocks.fetchGrowthAssets,
  importGrowthAsset: mocks.importGrowthAsset,
  uploadGrowthAsset: mocks.uploadGrowthAsset,
}));

function asset(overrides: Partial<GrowthAssetMetadata> = {}): GrowthAssetMetadata {
  return {
    id: "asset-image",
    accountId: "account-a",
    repository: "acme/rocket",
    kind: "image",
    origin: "upload",
    url: null,
    title: "Release dashboard",
    alt: "A dashboard showing the latest release",
    width: 1200,
    height: 630,
    cardTemplate: null,
    cardData: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let container: HTMLDivElement;
let root: Root;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalRevokeObjectUrl: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.fetchGrowthAssetImportCandidates.mockResolvedValue([]);
  mocks.fetchGrowthAssets.mockResolvedValue([]);
  mocks.importGrowthAsset.mockResolvedValue({ asset: asset({ origin: "readme" }), duplicate: false });
  mocks.uploadGrowthAsset.mockResolvedValue(asset());
  mocks.createGrowthCard.mockResolvedValue(asset({
    id: "generated-card",
    origin: "generated",
    title: "Release card",
    alt: "A release summary card",
    width: 1200,
    height: 675,
    cardTemplate: "release",
    cardData: { version: "v2.4.0", highlights: ["Faster plans"] },
  }));

  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-asset") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.stubGlobal("Image", class {
    naturalWidth = 1200;
    naturalHeight = 630;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

async function renderLibrary(accountId = "account-a", repository = "acme/rocket") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(GrowthAssetLibrary, {
        accountId,
        enabled: true,
        repository,
      }),
    ));
    await flush();
  });
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!element) throw new Error(`Missing field ${id}`);
  return element;
}

async function fillUpload(file: File, title = "Release dashboard", alt = "A dashboard showing the latest release") {
  await act(async () => {
    selectFile(field("growth-asset-file") as HTMLInputElement, file);
    setValue(field("growth-asset-title"), title);
    setValue(field("growth-asset-alt"), alt);
  });
}

async function submitUpload() {
  await act(async () => {
    container.querySelector(".growth-asset-upload")?.dispatchEvent(new Event("submit", {
      bubbles: true,
      cancelable: true,
    }));
    await flush();
  });
}

describe("GrowthAssetLibrary", () => {
  it("renders localized loading, empty, and request-error states", async () => {
    let resolveAssets: ((assets: GrowthAssetMetadata[]) => void) | undefined;
    mocks.fetchGrowthAssets.mockImplementationOnce(() => new Promise<GrowthAssetMetadata[]>((resolve) => {
      resolveAssets = resolve;
    }));

    await renderLibrary();
    expect(container.textContent).toContain("Loading repository assets");

    await act(async () => {
      resolveAssets?.([]);
      await flush();
    });
    expect(container.textContent).toContain("No assets yet");

    mocks.fetchGrowthAssets.mockRejectedValueOnce(new Error("library unavailable"));
    await renderLibrary("account-b");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("library unavailable");
  });

  it("reloads for account and repository changes and ignores aborted stale lists", async () => {
    let resolveOld: ((assets: GrowthAssetMetadata[]) => void) | undefined;
    mocks.fetchGrowthAssets
      .mockImplementationOnce(() => new Promise<GrowthAssetMetadata[]>((resolve) => {
        resolveOld = resolve;
      }))
      .mockResolvedValueOnce([asset({ id: "account-b", accountId: "account-b", title: "Account B asset" })])
      .mockResolvedValueOnce([asset({ id: "comet", accountId: "account-b", repository: "acme/comet", title: "Comet asset" })]);

    await renderLibrary("account-a", "acme/rocket");
    const staleSignal = mocks.fetchGrowthAssets.mock.calls[0][1] as AbortSignal;

    await renderLibrary("account-b", "acme/rocket");
    expect(staleSignal.aborted).toBe(true);
    expect(container.textContent).toContain("Account B asset");

    await renderLibrary("account-b", "acme/comet");
    expect(mocks.fetchGrowthAssets.mock.calls.map((call) => call[0])).toEqual([
      "acme/rocket",
      "acme/rocket",
      "acme/comet",
    ]);
    expect(container.textContent).toContain("Comet asset");

    await act(async () => {
      resolveOld?.([asset({ id: "stale", title: "Stale account asset" })]);
      await flush();
    });
    expect(container.textContent).not.toContain("Stale account asset");
  });

  it("validates required metadata, supported types, and the file size before upload", async () => {
    await renderLibrary();
    await fillUpload(new File(["<svg />"], "card.svg", { type: "image/svg+xml" }));
    await submitUpload();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("PNG, JPEG, WebP, GIF, MP4, or WebM");
    expect(mocks.uploadGrowthAsset).not.toHaveBeenCalled();

    const oversized = new File(["x"], "large.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 25 * 1024 * 1024 + 1 });
    await fillUpload(oversized);
    await submitUpload();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("25 MiB limit");

    await fillUpload(new File(["png"], "release.png", { type: "image/png" }), "Release", " ");
    await submitUpload();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("useful alt text");
    expect(mocks.uploadGrowthAsset).not.toHaveBeenCalled();
  });

  it("renders upload request errors without resetting the form", async () => {
    mocks.uploadGrowthAsset.mockRejectedValueOnce(new Error("upload unavailable"));
    await renderLibrary();
    await fillUpload(new File(["video"], "demo.webm", { type: "video/webm" }), "Demo video", "A demo walkthrough");
    await submitUpload();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("upload unavailable");
    expect((field("growth-asset-title") as HTMLInputElement).value).toBe("Demo video");
    expect((field("growth-asset-alt") as HTMLTextAreaElement).value).toBe("A demo walkthrough");
    expect(mocks.fetchGrowthAssets).toHaveBeenCalledTimes(1);
  });

  it("uploads with browser image dimensions, reports progress, resets, and refreshes the list", async () => {
    let resolveUpload: ((asset: GrowthAssetMetadata) => void) | undefined;
    const saved = asset();
    mocks.uploadGrowthAsset.mockImplementationOnce(() => new Promise<GrowthAssetMetadata>((resolve) => {
      resolveUpload = resolve;
    }));
    mocks.fetchGrowthAssets.mockResolvedValueOnce([]).mockResolvedValueOnce([saved]);
    await renderLibrary();
    await fillUpload(new File(["png bytes"], "release.png", { type: "image/png" }));

    await act(async () => {
      container.querySelector(".growth-asset-upload")?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
      await flush();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Uploading the asset");
    expect(mocks.uploadGrowthAsset).toHaveBeenCalledWith({
      repository: "acme/rocket",
      file: expect.any(File),
      filename: "release.png",
      title: "Release dashboard",
      alt: "A dashboard showing the latest release",
      width: 1200,
      height: 630,
    }, expect.any(AbortSignal));

    await act(async () => {
      resolveUpload?.(saved);
      await flush();
    });
    expect(mocks.fetchGrowthAssets).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Asset uploaded.");
    expect(container.textContent).toContain("Release dashboard");
    expect((field("growth-asset-title") as HTMLInputElement).value).toBe("");
    expect((field("growth-asset-alt") as HTMLTextAreaElement).value).toBe("");
  });

  it("validates template-specific card fields and exposes each creator through labeled controls", async () => {
    await renderLibrary();
    await act(async () => {
      container.querySelector(".growth-card-creator")?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
      await flush();
    });
    expect(container.textContent).toContain("Complete the card fields");
    expect(mocks.createGrowthCard).not.toHaveBeenCalled();

    const template = container.querySelector<HTMLSelectElement>("#growth-card-template");
    if (!template) throw new Error("Missing card template field");
    const expectedFields = [
      ["release", "growth-card-version"],
      ["milestone", "growth-card-milestone-value"],
      ["stats", "growth-card-stats"],
      ["quote", "growth-card-quote"],
      ["whats-new", "growth-card-whats-new"],
    ];
    for (const [value, id] of expectedFields) {
      await act(async () => selectValue(template, value));
      expect(field(id).closest("label")?.textContent?.trim()).not.toBe("");
    }
  });

  it("creates a generated card, shows its authenticated preview, and refreshes the asset list", async () => {
    const generated = asset({
      id: "generated-card",
      origin: "generated",
      title: "Release card",
      alt: "A release summary card",
      width: 1200,
      height: 675,
      cardTemplate: "release",
      cardData: { version: "v2.4.0", highlights: ["Faster plans", "Safe previews"] },
    });
    let resolveCard: ((value: GrowthAssetMetadata) => void) | undefined;
    mocks.createGrowthCard.mockImplementationOnce(() => new Promise<GrowthAssetMetadata>((resolve) => {
      resolveCard = resolve;
    }));
    mocks.fetchGrowthAssets.mockResolvedValueOnce([]).mockResolvedValueOnce([generated]);
    await renderLibrary();
    await act(async () => {
      setValue(field("growth-card-title"), "Release card");
      setValue(field("growth-card-alt"), "A release summary card");
      setValue(field("growth-card-version"), "v2.4.0");
      setValue(field("growth-card-highlights"), "Faster plans\nSafe previews");
      container.querySelector(".growth-card-creator")?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
      await flush();
    });
    expect(container.textContent).toContain("Creating card");
    expect(mocks.createGrowthCard).toHaveBeenCalledWith({
      repository: "acme/rocket",
      template: "release",
      title: "Release card",
      alt: "A release summary card",
      data: { version: "v2.4.0", highlights: ["Faster plans", "Safe previews"] },
    }, expect.any(AbortSignal));

    await act(async () => {
      resolveCard?.(generated);
      await flush();
    });
    expect(mocks.fetchGrowthAssets).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Card created and added");
    expect(container.querySelector<HTMLImageElement>(".growth-card-created img")?.src)
      .toContain("/api/growth/assets/generated-card/file");
    expect(container.textContent).toContain("1200 × 675 px");
  });

  it("localizes card request errors and aborts stale creation on account changes", async () => {
    mocks.createGrowthCard.mockRejectedValueOnce(new Error("renderer unavailable"));
    await renderLibrary();
    await act(async () => {
      setValue(field("growth-card-title"), "Release card");
      setValue(field("growth-card-alt"), "Release card description");
      setValue(field("growth-card-version"), "v1");
      setValue(field("growth-card-highlights"), "Shipped");
      container.querySelector(".growth-card-creator")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(container.textContent).toContain("Could not create the card: renderer unavailable");

    let resolveCard: ((value: GrowthAssetMetadata) => void) | undefined;
    mocks.createGrowthCard.mockImplementationOnce((_input, signal: AbortSignal) => new Promise((resolve) => {
      resolveCard = resolve;
      expect(signal.aborted).toBe(false);
    }));
    await act(async () => {
      container.querySelector(".growth-card-creator")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    const staleSignal = mocks.createGrowthCard.mock.calls[1][1] as AbortSignal;
    await renderLibrary("account-b");
    expect(staleSignal.aborted).toBe(true);
    await act(async () => {
      resolveCard?.(asset({ id: "stale-card", title: "Stale card" }));
      await flush();
    });
    expect(container.textContent).not.toContain("Stale card");
  });

  it("aborts an active upload when the account changes", async () => {
    let resolveUpload: ((asset: GrowthAssetMetadata) => void) | undefined;
    mocks.uploadGrowthAsset.mockImplementationOnce((_input, signal: AbortSignal) => new Promise<GrowthAssetMetadata>((resolve) => {
      resolveUpload = resolve;
      expect(signal.aborted).toBe(false);
    }));
    await renderLibrary();
    await fillUpload(new File(["video"], "demo.mp4", { type: "video/mp4" }));
    await submitUpload();
    const uploadSignal = mocks.uploadGrowthAsset.mock.calls[0][1] as AbortSignal;

    await renderLibrary("account-b");
    expect(uploadSignal.aborted).toBe(true);
    await act(async () => {
      resolveUpload?.(asset({ id: "stale-upload", title: "Stale upload" }));
      await flush();
    });
    expect(container.textContent).not.toContain("Stale upload");
  });

  it("discovers candidates, requires editable alt text, imports, and reports duplicates through private previews", async () => {
    mocks.fetchGrowthAssetImportCandidates.mockResolvedValueOnce([{
      origin: "readme",
      source: "acme/rocket README",
      url: "https://cdn.example/release.png",
      title: "Release image",
      alt: "Release image",
    }]);
    const imported = asset({ id: "imported", origin: "readme", url: "https://cdn.example/release.png" });
    mocks.importGrowthAsset
      .mockResolvedValueOnce({ asset: imported, duplicate: false })
      .mockResolvedValueOnce({ asset: imported, duplicate: true });
    await renderLibrary();

    expect(container.textContent).toContain("acme/rocket README");
    const importAlt = field("growth-asset-import-alt-0");
    await act(async () => setValue(importAlt, " "));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".growth-asset-import-card .btn")?.click();
      await flush();
    });
    expect(container.textContent).toContain("useful alt text");
    expect(mocks.importGrowthAsset).not.toHaveBeenCalled();

    await act(async () => setValue(importAlt, "Release dashboard from the README"));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".growth-asset-import-card .btn")?.click();
      await flush();
    });
    expect(mocks.importGrowthAsset).toHaveBeenCalledWith(expect.objectContaining({
      repository: "acme/rocket",
      origin: "readme",
      url: "https://cdn.example/release.png",
      alt: "Release dashboard from the README",
    }), expect.any(AbortSignal));
    expect(container.textContent).toContain("private media proxy");
    expect(container.querySelector<HTMLImageElement>(".growth-asset-import-preview img")?.src)
      .toContain("/api/growth/assets/imported/file");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".growth-asset-import-card .btn")?.click();
      await flush();
    });
    expect(container.textContent).toContain("already in the repository library");
  });

  it("shows candidate errors and aborts stale discovery and import requests", async () => {
    let resolveDiscovery: ((value: never[]) => void) | undefined;
    let resolveImport: ((value: { asset: GrowthAssetMetadata; duplicate: boolean }) => void) | undefined;
    mocks.fetchGrowthAssetImportCandidates
      .mockImplementationOnce((_repository, signal: AbortSignal) => new Promise<never[]>((resolve) => {
        resolveDiscovery = resolve;
        expect(signal.aborted).toBe(false);
      }))
      .mockResolvedValueOnce([{
        origin: "website",
        source: "https://project.example",
        url: "https://cdn.example/demo.webm",
        title: "Demo",
        alt: "Demo",
      }]);
    await renderLibrary("account-a", "acme/rocket");
    const staleDiscoverySignal = mocks.fetchGrowthAssetImportCandidates.mock.calls[0][1] as AbortSignal;
    await renderLibrary("account-b", "acme/comet");
    expect(staleDiscoverySignal.aborted).toBe(true);

    mocks.importGrowthAsset.mockImplementationOnce((_input, signal: AbortSignal) => new Promise((resolve) => {
      resolveImport = resolve;
    }));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".growth-asset-import-card .btn")?.click();
      await flush();
    });
    const staleImportSignal = mocks.importGrowthAsset.mock.calls[0][1] as AbortSignal;
    await renderLibrary("account-c", "acme/other");
    expect(staleImportSignal.aborted).toBe(true);
    await act(async () => {
      resolveDiscovery?.([]);
      resolveImport?.({ asset: asset({ title: "Stale import" }), duplicate: false });
      await flush();
    });
    expect(container.textContent).not.toContain("Stale import");

    mocks.fetchGrowthAssetImportCandidates.mockRejectedValueOnce(new Error("sources unavailable"));
    await renderLibrary("account-d", "acme/failure");
    expect(container.textContent).toContain("sources unavailable");
  });

  it.each([1440, 390])("keeps accessible controls and authenticated previews at %ipx", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    mocks.fetchGrowthAssets.mockResolvedValueOnce([
      asset(),
      asset({
        id: "asset-video",
        kind: "video",
        title: "Release walkthrough",
        alt: "A walkthrough of the release flow",
        width: 1920,
        height: 1080,
      }),
    ]);
    await renderLibrary();

    const fileInput = field("growth-asset-file") as HTMLInputElement;
    expect(document.querySelector('label[for="growth-asset-file"]')).not.toBeNull();
    expect(document.querySelector('label[for="growth-asset-title"]')).not.toBeNull();
    expect(document.querySelector('label[for="growth-asset-alt"]')).not.toBeNull();
    expect(fileInput.required).toBe(true);
    expect(fileInput.accept).toContain("image/png");
    expect(fileInput.accept).toContain("video/webm");

    const image = container.querySelector<HTMLImageElement>("img");
    const video = container.querySelector<HTMLVideoElement>("video");
    expect(image?.src).toContain("/api/growth/assets/asset-image/file");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(video?.src).toContain("/api/growth/assets/asset-video/file");
    expect(video?.preload).toBe("metadata");
    expect(video?.getAttribute("aria-label")).toContain("Release walkthrough");
    expect(container.textContent).toContain("1200 × 630 px");
    expect(container.textContent).toContain("A walkthrough of the release flow");
    expect(container.querySelectorAll(".growth-asset-card")).toHaveLength(2);
  });
});
