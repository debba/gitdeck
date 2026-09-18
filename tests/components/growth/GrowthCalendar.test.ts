import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthCalendar } from "../../../src/components/growth/calendar/GrowthCalendar";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthContentItem, GrowthProfile } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthCalendarExportUrl: vi.fn(() => "/api/growth/calendar.ics?export=visible"),
  fetchGrowthContentPlans: vi.fn(),
  generateGrowthContentPlan: vi.fn(),
  regenerateGrowthContentPlan: vi.fn(),
  archiveGrowthContentPlan: vi.fn(),
  fetchGrowthProfile: vi.fn(),
  fetchGrowthContentItems: vi.fn(),
  patchGrowthContentItem: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthCalendarExportUrl: mocks.buildGrowthCalendarExportUrl,
  fetchGrowthContentPlans: mocks.fetchGrowthContentPlans,
  generateGrowthContentPlan: mocks.generateGrowthContentPlan,
  regenerateGrowthContentPlan: mocks.regenerateGrowthContentPlan,
  archiveGrowthContentPlan: mocks.archiveGrowthContentPlan,
  fetchGrowthProfile: mocks.fetchGrowthProfile,
  fetchGrowthContentItems: mocks.fetchGrowthContentItems,
  patchGrowthContentItem: mocks.patchGrowthContentItem,
}));
vi.mock("../../../src/components/growth/ContentItemDrawer", () => ({
  ContentItemDrawer: ({ item, onUpdate }: {
    item: GrowthContentItem;
    onUpdate: (item: GrowthContentItem) => void;
  }) => createElement("div", { role: "dialog" },
    createElement("span", null, item.title),
    createElement("button", {
      type: "button",
      onClick: () => onUpdate({ ...item, title: "Updated calendar title" }),
    }, "Update item"),
  ),
}));

function profile(): GrowthProfile {
  return {
    accountId: "account-a",
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
    postingWindows: [{ weekday: 1, hour: 9 }, { weekday: 3, hour: 16 }],
    color: "#2563EB",
    updatedAt: "2026-09-04T08:00:00.000Z",
  };
}

function contentItem(id = "content-1", title = "October release"): GrowthContentItem {
  return {
    id,
    accountId: "account-a",
    repository: "acme/rocket",
    planId: "plan-1",
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release angle",
    title,
    summary: "Read more",
    body: "Release body",
    threadPosts: [],
    media: [],
    sources: [],
    status: "idea",
    scheduledFor: "2026-09-30T22:30:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location" }, `${location.pathname}${location.search}`);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.fetchGrowthContentPlans.mockResolvedValue([]);
  mocks.fetchGrowthProfile.mockResolvedValue(profile());
  mocks.fetchGrowthContentItems.mockResolvedValue([contentItem()]);
  mocks.patchGrowthContentItem.mockImplementation(async (id: string, updates: Partial<GrowthContentItem>) => ({
    ...contentItem(id),
    ...updates,
    updatedAt: "2026-09-04T09:00:00.000Z",
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderCalendar(accountId = "account-a", entry = "/growth/r/acme/rocket/calendar?view=month&date=2026-10-15") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [entry] },
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

describe("GrowthCalendar", () => {
  it("loads the visible month in the profile timezone and opens a focusable item drawer", async () => {
    await renderCalendar();

    expect(mocks.fetchGrowthProfile).toHaveBeenCalledWith("acme/rocket", expect.any(AbortSignal));
    expect(mocks.fetchGrowthContentItems).toHaveBeenCalledWith({
      repository: "acme/rocket",
      scheduledFrom: "2026-09-27T22:00:00.000Z",
      scheduledTo: "2026-11-08T22:59:59.999Z",
    }, expect.any(AbortSignal));
    expect(mocks.buildGrowthCalendarExportUrl).toHaveBeenCalledWith({
      repository: "acme/rocket",
      from: "2026-09-27T22:00:00.000Z",
      to: "2026-11-08T22:59:59.999Z",
    });
    const exportLink = [...container.querySelectorAll<HTMLAnchorElement>("a")]
      .find((link) => link.textContent === "Export calendar");
    expect(exportLink?.getAttribute("href")).toBe("/api/growth/calendar.ics?export=visible");
    expect(exportLink?.download).toBe("gitdeck-growth-calendar.ics");
    expect(container.querySelectorAll(".growth-calendar-day")).toHaveLength(42);

    const itemButton = [...container.querySelectorAll<HTMLButtonElement>(".growth-calendar-item")]
      .find((button) => button.textContent?.includes("October release"));
    expect(itemButton?.tagName).toBe("BUTTON");
    expect(itemButton?.textContent).toContain("00:30");
    expect(itemButton?.textContent).toContain("Product news");
    expect(itemButton?.closest(".growth-calendar-day")?.getAttribute("aria-label")).toContain("October 1, 2026");

    await act(async () => itemButton?.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("October release");

    const update = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Update item");
    await act(async () => update?.click());
    expect(container.textContent).toContain("Updated calendar title");
    expect(container.textContent).not.toContain("October release");
  });

  it("normalizes invalid month URLs and provides month navigation controls", async () => {
    await renderCalendar("account-a", "/growth/r/acme/rocket/calendar?date=2026-02-31");

    const location = container.querySelector('[data-testid="location"]')?.textContent ?? "";
    expect(location).toContain("?view=month&date=");
    expect(location).not.toContain("2026-02-31");

    const previous = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Previous"));
    await act(async () => previous?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toContain("view=month&date=");
  });

  it("loads a URL-addressable week with posting-hour guides and week navigation", async () => {
    const item = contentItem("week-item", "Weekly release");
    item.scheduledFor = "2026-10-14T08:30:00.000Z";
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([item]);

    await renderCalendar("account-a", "/growth/r/acme/rocket/calendar?view=week&date=2026-10-15");

    expect(mocks.fetchGrowthContentItems).toHaveBeenCalledWith({
      repository: "acme/rocket",
      scheduledFrom: "2026-10-11T22:00:00.000Z",
      scheduledTo: "2026-10-18T21:59:59.999Z",
    }, expect.any(AbortSignal));
    expect(container.querySelectorAll(".growth-calendar-week-day")).toHaveLength(7);
    expect(container.querySelector(".growth-calendar-week-hours")?.textContent).toContain("09:00");
    expect(container.querySelector(".growth-calendar-week-hours")?.textContent).toContain("16:00");
    expect(container.textContent).toContain("Weekly release");

    const next = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Next week"));
    await act(async () => next?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toContain("view=week&date=2026-10-22");

    const month = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Month");
    await act(async () => month?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toContain("view=month&date=2026-10-22");
  });

  it("preserves idea status during keyboard movement and keeps the moved item connected to the drawer", async () => {
    const item = contentItem("keyboard-item", "Keyboard release");
    item.scheduledFor = "2026-10-14T08:30:00.000Z";
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([item]);
    mocks.patchGrowthContentItem.mockImplementationOnce(async (_id: string, updates: Partial<GrowthContentItem>) => ({
      ...item,
      ...updates,
    }));
    await renderCalendar("account-a", "/growth/r/acme/rocket/calendar?view=week&date=2026-10-15");

    const itemButton = [...container.querySelectorAll<HTMLButtonElement>(".growth-calendar-item")]
      .find((button) => button.textContent?.includes("Keyboard release"))!;
    await act(async () => {
      itemButton.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.patchGrowthContentItem).toHaveBeenCalledWith("keyboard-item", {
      scheduledFor: "2026-10-15T08:30:00.000Z",
      status: "idea",
    });
    const targetDay = container.querySelector('[data-calendar-date="2026-10-15"]');
    expect(targetDay?.textContent).toContain("Keyboard release");

    const movedButton = targetDay?.querySelector<HTMLButtonElement>(".growth-calendar-item");
    await act(async () => movedButton?.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Keyboard release");
    const update = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Update item");
    await act(async () => update?.click());
    expect(targetDay?.textContent).toContain("Updated calendar title");
  });

  it("preserves draft status during pointer movement between visible day cells", async () => {
    const item = contentItem("pointer-item", "Pointer release");
    item.status = "draft";
    item.scheduledFor = "2026-10-14T08:30:00.000Z";
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([item]);
    mocks.patchGrowthContentItem.mockImplementationOnce(async (_id: string, updates: Partial<GrowthContentItem>) => ({
      ...item,
      ...updates,
    }));
    await renderCalendar("account-a", "/growth/r/acme/rocket/calendar?view=week&date=2026-10-15");

    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const source = container.querySelector<HTMLButtonElement>(".growth-calendar-item")!;
    const target = container.querySelector<HTMLElement>('[data-calendar-date="2026-10-16"]')!;
    await act(async () => {
      const dragStart = new Event("dragstart", { bubbles: true });
      Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
      source.dispatchEvent(dragStart);
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      target.dispatchEvent(drop);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.patchGrowthContentItem).toHaveBeenCalledWith("pointer-item", {
      scheduledFor: "2026-10-16T08:30:00.000Z",
      status: "draft",
    });
    expect(target.textContent).toContain("Pointer release");
  });

  it("rolls an optimistic movement back with an inline error and rejects keyboard movement outside the week", async () => {
    const item = contentItem("rollback-item", "Rollback release");
    item.scheduledFor = "2026-10-12T08:30:00.000Z";
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([item]);
    mocks.patchGrowthContentItem.mockRejectedValueOnce(new Error("save unavailable"));
    await renderCalendar("account-a", "/growth/r/acme/rocket/calendar?view=week&date=2026-10-15");

    const itemButton = container.querySelector<HTMLButtonElement>(".growth-calendar-item")!;
    await act(async () => {
      itemButton.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("save unavailable");
    expect(container.querySelector('[data-calendar-date="2026-10-12"]')?.textContent).toContain("Rollback release");
    expect(container.querySelector('[data-calendar-date="2026-10-13"]')?.textContent).not.toContain("Rollback release");

    mocks.patchGrowthContentItem.mockClear();
    const restored = container.querySelector<HTMLButtonElement>(".growth-calendar-item")!;
    await act(async () => {
      restored.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
    });
    expect(mocks.patchGrowthContentItem).not.toHaveBeenCalled();
  });

  it("renders localized empty and error states", async () => {
    mocks.fetchGrowthContentItems.mockResolvedValueOnce([]);
    await renderCalendar();
    expect(container.textContent).toContain("No content in these six weeks");

    mocks.fetchGrowthProfile.mockRejectedValueOnce(new Error("profile unavailable"));
    await renderCalendar("account-b");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("profile unavailable");
  });

  it("aborts stale calendar data when the active account changes", async () => {
    let resolveOld: ((items: GrowthContentItem[]) => void) | undefined;
    const staleRequest = new Promise<GrowthContentItem[]>((resolve) => {
      resolveOld = resolve;
    });
    mocks.fetchGrowthContentItems
      .mockImplementationOnce(() => staleRequest)
      .mockResolvedValueOnce([contentItem("content-new", "New account item")]);

    await renderCalendar();
    const staleSignal = mocks.fetchGrowthContentItems.mock.calls[0][1] as AbortSignal;

    await renderCalendar("account-b");
    expect(staleSignal.aborted).toBe(true);
    expect(container.textContent).toContain("New account item");

    await act(async () => {
      resolveOld?.([contentItem("content-old", "Stale account item")]);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Stale account item");
  });
});
