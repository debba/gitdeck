import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthCalendar } from "../../../src/components/growth/calendar/GrowthCalendar";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthContentItem, GrowthProfile } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthAssetFileUrl: vi.fn((id: string) => `/api/growth/assets/${id}/file`),
  buildGrowthCalendarExportUrl: vi.fn(() => "/api/growth/calendar.ics?export=visible"),
  fetchGrowthAssetFile: vi.fn(),
  fetchGrowthContentPlans: vi.fn(),
  generateGrowthContentPlan: vi.fn(),
  regenerateGrowthContentPlan: vi.fn(),
  archiveGrowthContentPlan: vi.fn(),
  fetchGrowthProfile: vi.fn(),
  fetchGrowthContentItems: vi.fn(),
  patchGrowthContentItem: vi.fn(),
  draftGrowthContentItem: vi.fn(),
  markGrowthContentPublished: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthAssetFileUrl: mocks.buildGrowthAssetFileUrl,
  buildGrowthCalendarExportUrl: mocks.buildGrowthCalendarExportUrl,
  fetchGrowthAssetFile: mocks.fetchGrowthAssetFile,
  fetchGrowthContentPlans: mocks.fetchGrowthContentPlans,
  generateGrowthContentPlan: mocks.generateGrowthContentPlan,
  regenerateGrowthContentPlan: mocks.regenerateGrowthContentPlan,
  archiveGrowthContentPlan: mocks.archiveGrowthContentPlan,
  fetchGrowthProfile: mocks.fetchGrowthProfile,
  fetchGrowthContentItems: mocks.fetchGrowthContentItems,
  patchGrowthContentItem: mocks.patchGrowthContentItem,
  draftGrowthContentItem: mocks.draftGrowthContentItem,
  markGrowthContentPublished: mocks.markGrowthContentPublished,
}));
vi.mock("../../../src/components/growth/ContentItemDrawer", () => ({
  ContentItemDrawer: ({ item, onUpdate }: {
    item: GrowthContentItem;
    onUpdate: (item: GrowthContentItem) => void;
  }) => createElement("div", { role: "dialog" },
    createElement("span", null, item.title),
    createElement("button", {
      type: "button",
      onClick: () => onUpdate({ ...item, title: "Updated queue title", status: "draft" }),
    }, "Update queue item"),
  ),
}));

function profile(accountId = "account-a"): GrowthProfile {
  return {
    accountId,
    repository: "acme/rocket",
    language: "en",
    voice: "Practical",
    audience: "Maintainers",
    channels: { x: true, linkedin: true, mastodon: false, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 0, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product news", weight: 100, description: "Releases" }],
    hashtags: [],
    avoid: "",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 9 }],
    color: "#2563EB",
    updatedAt: "2026-09-04T08:00:00.000Z",
  };
}

function contentItem(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: "plan-1",
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release angle",
    title: "Release queue item",
    summary: "Read more",
    body: "Release body",
    threadPosts: ["First post", "Second post"],
    media: [{ kind: "image", url: "https://example.com/release.png", alt: "Release preview" }],
    sources: ["https://example.com/release"],
    status: "idea",
    scheduledFor: "2026-10-18T22:30:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location" }, `${location.pathname}${location.search}`);
}

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  mocks.writeText.mockResolvedValue(undefined);
  mocks.fetchGrowthContentPlans.mockResolvedValue([]);
  mocks.fetchGrowthProfile.mockResolvedValue(profile());
  mocks.fetchGrowthContentItems.mockResolvedValue([contentItem()]);
  mocks.patchGrowthContentItem.mockImplementation(async (id: string, updates: Partial<GrowthContentItem>) => ({
    ...contentItem({ id }),
    ...updates,
  }));
  mocks.draftGrowthContentItem.mockImplementation(async (id: string) => ({
    ok: true,
    contentItem: contentItem({ id, status: "draft" }),
    aiEnabled: false,
    usedFallback: true,
    cached: false,
    mediaRequired: false,
  }));
  mocks.markGrowthContentPublished.mockImplementation(async (id: string, url: string | null) => ({
    ...contentItem({ id }),
    status: "published",
    publishedAt: "2026-10-20T10:00:00.000Z",
    publishedUrl: url,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderQueue(accountId = "account-a") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ["/growth/r/acme/rocket/calendar?view=queue&date=2026-10-25"] },
        createElement(LocationProbe),
        createElement(GrowthCalendar, {
          accountId,
          enabled: true,
          repository: "acme/rocket",
        }),
      ),
    ));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GrowthQueue", () => {
  it("loads the profile-local Monday-through-Sunday range and groups dated work", async () => {
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([
      contentItem(),
      contentItem({ id: "draft", title: "Draft item", status: "draft", scheduledFor: "2026-10-20T08:00:00.000Z" }),
      contentItem({ id: "outside", title: "Outside item", status: "ready", scheduledFor: "2026-10-25T23:30:00.000Z" }),
      contentItem({ id: "skipped", title: "Skipped item", status: "skipped" }),
    ]);

    await renderQueue();

    expect(mocks.fetchGrowthContentItems).toHaveBeenCalledWith({
      repository: "acme/rocket",
      scheduledFrom: "2026-10-18T22:00:00.000Z",
      scheduledTo: "2026-10-25T22:59:59.999Z",
    }, expect.any(AbortSignal));
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Queue");
    expect(container.querySelector(".section-needsDraft")?.textContent).toContain("Release queue item");
    expect(container.querySelector(".section-draft")?.textContent).toContain("Draft item");
    expect(container.textContent).toContain("Product news");
    expect(container.textContent).toContain("Media attached");
    expect(container.textContent).toContain("Release preview");
    expect(container.textContent).toContain("Copy image");
    expect(container.textContent).toContain("Download image");
    expect(container.textContent).toContain("https://example.com/release");
    expect(container.textContent).not.toContain("Outside item");
    expect(container.textContent).not.toContain("Skipped item");

    const nextWeek = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((entry) => entry.textContent?.includes("Next week"))!;
    await act(async () => nextWeek.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent)
      .toContain("?view=queue&date=2026-11-01");
  });

  it("uses authenticated media previews and excludes videos from image actions", async () => {
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([contentItem({
      media: [
        { assetId: "asset-image", kind: "image", alt: "Private queue image" },
        { assetId: "asset-video", kind: "video", alt: "Private queue video" },
      ],
    })]);
    await renderQueue();

    expect(container.querySelector<HTMLImageElement>('img[alt="Private queue image"]')?.src)
      .toContain("/api/growth/assets/asset-image/file");
    expect(container.querySelector<HTMLVideoElement>("video")?.src)
      .toContain("/api/growth/assets/asset-video/file");
    expect(container.querySelector<HTMLVideoElement>("video")?.getAttribute("aria-label"))
      .toBe("Private queue video");
    expect([...container.querySelectorAll("button")].filter((entry) => entry.textContent === "Copy image"))
      .toHaveLength(1);
    expect([...container.querySelectorAll("button")].filter((entry) => entry.textContent === "Download image"))
      .toHaveLength(1);
  });

  it("copies body text and a formatted X thread inline", async () => {
    await renderQueue();

    await act(async () => {
      button("Copy text").click();
      await Promise.resolve();
    });
    expect(mocks.writeText).toHaveBeenCalledWith("Release body");

    await act(async () => {
      button("Copy X thread").click();
      await Promise.resolve();
    });
    expect(mocks.writeText).toHaveBeenCalledWith("First post\n\n---\n\nSecond post");
  });

  it("records a manual publication and moves the response into Published", async () => {
    const scheduled = contentItem({ status: "scheduled", title: "Scheduled release" });
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([scheduled]);
    mocks.markGrowthContentPublished.mockResolvedValueOnce({
      ...scheduled,
      status: "published",
      publishedAt: "2026-10-20T10:00:00.000Z",
      publishedUrl: "https://social.example/acme/rocket",
    });
    await renderQueue();

    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => setValue(input, "https://social.example/acme/rocket"));
    await act(async () => {
      button("Mark published").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.markGrowthContentPublished).toHaveBeenCalledWith(
      "content-1",
      "https://social.example/acme/rocket",
    );
    expect(container.querySelector(".section-published")?.textContent).toContain("Scheduled release");
    expect(container.querySelector(".section-scheduled")?.textContent).not.toContain("Scheduled release");
  });

  it("keeps an item in place and shows the mandatory-media failure inline", async () => {
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([contentItem({ media: [] })]);
    mocks.markGrowthContentPublished.mockRejectedValueOnce(new Error(
      "Content must have at least one media attachment before it can be ready, scheduled, or published.",
    ));
    await renderQueue();

    await act(async () => {
      button("Mark published").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("at least one media attachment");
    expect(container.querySelector(".section-needsDraft")?.textContent).toContain("Release queue item");
    expect(container.textContent).toContain("Media needed");
  });

  it("opens the shared drawer and applies drawer updates to the queue", async () => {
    await renderQueue();

    await act(async () => {
      button("Draft details").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.draftGrowthContentItem).toHaveBeenCalledWith("content-1");
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Release queue item");

    await act(async () => button("Update queue item").click());
    expect(container.querySelector(".section-draft")?.textContent).toContain("Updated queue title");
    expect(container.textContent).not.toContain("Release queue item");
  });

  it("renders localized loading, empty, and request-error states", async () => {
    let resolveProfile: ((value: GrowthProfile) => void) | undefined;
    mocks.fetchGrowthProfile.mockImplementationOnce(() => new Promise<GrowthProfile>((resolve) => {
      resolveProfile = resolve;
    }));
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([]);

    await renderQueue();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading this week's editorial queue");

    await act(async () => {
      resolveProfile?.(profile());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("This week's queue is clear");

    mocks.fetchGrowthProfile.mockRejectedValueOnce(new Error("profile unavailable"));
    await renderQueue("account-b");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("profile unavailable");
  });

  it("aborts stale queue requests when the active account changes", async () => {
    let resolveOld: ((items: GrowthContentItem[]) => void) | undefined;
    const staleRequest = new Promise<GrowthContentItem[]>((resolve) => {
      resolveOld = resolve;
    });
    mocks.fetchGrowthProfile
      .mockResolvedValueOnce(profile("account-a"))
      .mockResolvedValueOnce(profile("account-b"));
    mocks.fetchGrowthContentItems
      .mockImplementationOnce(() => staleRequest)
      .mockResolvedValueOnce([contentItem({ id: "new", accountId: "account-b", title: "New account queue" })]);

    await renderQueue("account-a");
    const staleSignal = mocks.fetchGrowthContentItems.mock.calls[0][1] as AbortSignal;

    await renderQueue("account-b");
    expect(staleSignal.aborted).toBe(true);
    expect(container.textContent).toContain("New account queue");

    await act(async () => {
      resolveOld?.([contentItem({ id: "old", title: "Stale account queue" })]);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Stale account queue");
  });
});
