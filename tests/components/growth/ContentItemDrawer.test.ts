import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentItemDrawer } from "../../../src/components/growth/ContentItemDrawer";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthContentItem } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthAssetFileUrl: vi.fn((id: string) => `/api/growth/assets/${id}/file`),
  fetchGrowthAssetFile: vi.fn(),
  fetchGrowthAssets: vi.fn(),
  patchGrowthContentItem: vi.fn(),
  markGrowthContentPublished: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthAssetFileUrl: mocks.buildGrowthAssetFileUrl,
  fetchGrowthAssetFile: mocks.fetchGrowthAssetFile,
  fetchGrowthAssets: mocks.fetchGrowthAssets,
  patchGrowthContentItem: mocks.patchGrowthContentItem,
  markGrowthContentPublished: mocks.markGrowthContentPublished,
}));

function contentItem(): GrowthContentItem {
  return {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: null,
    interventionId: "intervention-1",
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "release",
    angle: "A verified release",
    title: "Release thread",
    summary: "A release story for contributors.",
    body: "**Release body**",
    threadPosts: ["First post", "Second post"],
    media: [{ kind: "image", url: "https://example.com/release.png", alt: "Release image" }],
    sources: ["https://example.com/release"],
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    publishedUrl: null,
    generatedAt: "2026-09-04T08:00:00.000Z",
    generationVersion: 4,
    evergreen: 0,
    createdAt: "2026-09-04T08:00:00.000Z",
    updatedAt: "2026-09-04T08:00:00.000Z",
  };
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

let container: HTMLDivElement;
let root: Root;
let item: GrowthContentItem;
let onClose: () => void;
let onUpdate: (item: GrowthContentItem) => void;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  item = contentItem();
  onClose = vi.fn<() => void>();
  onUpdate = vi.fn<(updated: GrowthContentItem) => void>();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  mocks.writeText.mockResolvedValue(undefined);
  mocks.fetchGrowthAssets.mockResolvedValue([]);
  mocks.patchGrowthContentItem.mockImplementation(async (_id: string, updates: Partial<GrowthContentItem>) => ({
    ...item,
    ...updates,
    updatedAt: "2026-09-04T09:00:00.000Z",
  }));
  mocks.markGrowthContentPublished.mockImplementation(async (_id: string, url: string | null) => ({
    ...item,
    status: "published",
    publishedAt: "2026-09-04T09:00:00.000Z",
    publishedUrl: url,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderDrawer() {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(ContentItemDrawer, { item, onClose, onUpdate }),
    ));
  });
}

describe("ContentItemDrawer", () => {
  it("renders content details, copies the thread, and persists inline edits", async () => {
    await renderDrawer();

    expect(document.activeElement).toBe(document.body.querySelector(".growth-content-drawer .modal-close"));
    expect(document.body.textContent).toContain("Release thread");
    expect(document.body.textContent).toContain("First post");
    expect(document.body.textContent).toContain("10/280");
    expect(document.body.textContent).toContain("Release image");
    expect(document.body.textContent).toContain("Copy image");
    expect(document.body.textContent).toContain("Download image");
    expect(document.body.textContent).toContain("https://example.com/release");

    await act(async () => {
      button("Copy thread").click();
      await Promise.resolve();
    });
    expect(mocks.writeText).toHaveBeenCalledWith("First post\n\n---\n\nSecond post");

    const title = document.body.querySelector<HTMLInputElement>('.growth-content-edit input');
    const body = document.body.querySelector<HTMLTextAreaElement>('.growth-content-edit > label textarea');
    expect(title).not.toBeNull();
    expect(body).not.toBeNull();
    await act(async () => {
      setValue(title!, "Updated release thread");
      setValue(body!, "Updated **body**");
      button("Save changes").click();
      await Promise.resolve();
    });

    expect(mocks.patchGrowthContentItem).toHaveBeenCalledWith("content-1", {
      title: "Updated release thread",
      body: "Updated **body**",
      threadPosts: ["First post", "Second post"],
    });
    expect(onUpdate).toHaveBeenCalled();
  });

  it("persists scheduling and publication and displays media invariant errors inline", async () => {
    await renderDrawer();
    const schedule = document.body.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    expect(schedule).not.toBeNull();

    await act(async () => {
      setValue(schedule!, "2026-09-08T10:30");
      button("Schedule").click();
      await Promise.resolve();
    });
    expect(mocks.patchGrowthContentItem).toHaveBeenCalledWith("content-1", {
      scheduledFor: new Date("2026-09-08T10:30").toISOString(),
    });

    const publishedUrl = document.body.querySelector<HTMLInputElement>('input[type="url"]');
    await act(async () => {
      setValue(publishedUrl!, "https://social.example/acme/1");
      button("Mark published").click();
      await Promise.resolve();
    });
    expect(mocks.markGrowthContentPublished).toHaveBeenCalledWith("content-1", "https://social.example/acme/1");

    mocks.patchGrowthContentItem.mockRejectedValueOnce(new Error(
      "Content must have at least one media attachment before it can be ready, scheduled, or published.",
    ));
    await act(async () => {
      button("Mark ready").click();
      await Promise.resolve();
    });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("at least one media attachment");
  });

  it("attaches repository media through the content patch and disables ready without media", async () => {
    item = { ...item, media: [] };
    mocks.fetchGrowthAssets.mockResolvedValueOnce([{
      id: "asset-library",
      accountId: "account-a",
      repository: "acme/rocket",
      kind: "image",
      origin: "upload",
      url: null,
      title: "Library card",
      alt: "Library release card",
      width: 1200,
      height: 630,
      cardTemplate: null,
      cardData: null,
      createdAt: "2026-09-04T10:00:00.000Z",
    }]);
    await renderDrawer();

    expect(button("Mark ready").disabled).toBe(true);
    await act(async () => {
      button("Attach media").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.patchGrowthContentItem).toHaveBeenCalledWith("content-1", {
      media: [{ assetId: "asset-library", kind: "image", alt: "Library release card" }],
    });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      media: [{ assetId: "asset-library", kind: "image", alt: "Library release card" }],
    }));
  });

  it("edits the evergreen setting and restores it when persistence fails", async () => {
    await renderDrawer();
    const evergreen = document.body.querySelector<HTMLInputElement>('.growth-content-evergreen input[type="checkbox"]');
    expect(evergreen).not.toBeNull();
    expect(evergreen?.checked).toBe(false);
    expect(document.body.textContent).toContain("surface for recycling after 60 days");

    await act(async () => {
      evergreen?.click();
      await Promise.resolve();
    });
    expect(mocks.patchGrowthContentItem).toHaveBeenCalledWith("content-1", { evergreen: 1 });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ evergreen: 1 }));
    expect(evergreen?.checked).toBe(true);

    mocks.patchGrowthContentItem.mockRejectedValueOnce(new Error("evergreen update failed"));
    await act(async () => {
      evergreen?.click();
      await Promise.resolve();
    });
    expect(evergreen?.checked).toBe(false);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("evergreen update failed");
  });

  it("uses authenticated asset previews and excludes videos from image actions", async () => {
    item = {
      ...item,
      media: [
        { assetId: "asset-image", kind: "image", alt: "Private image" },
        { assetId: "asset-video", kind: "video", alt: "Private video" },
      ],
    };
    await renderDrawer();

    expect(document.body.querySelector<HTMLImageElement>('img[alt="Private image"]')?.src)
      .toContain("/api/growth/assets/asset-image/file");
    expect(document.body.querySelector<HTMLVideoElement>("video")?.src)
      .toContain("/api/growth/assets/asset-video/file");
    expect(document.body.querySelector<HTMLVideoElement>("video")?.getAttribute("aria-label"))
      .toBe("Private video");
    expect([...document.body.querySelectorAll("button")].filter((entry) => entry.textContent === "Copy image"))
      .toHaveLength(1);
    expect([...document.body.querySelectorAll("button")].filter((entry) => entry.textContent === "Download image"))
      .toHaveLength(1);
  });

  it("closes on Escape", async () => {
    await renderDrawer();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
