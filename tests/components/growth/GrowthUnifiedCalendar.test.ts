import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthUnifiedCalendar } from "../../../src/components/growth/calendar/GrowthUnifiedCalendar";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type {
  GrowthContentItem,
  GrowthUnifiedCalendar as GrowthUnifiedCalendarModel,
  GrowthUnifiedCalendarRepository,
} from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthCalendarExportUrl: vi.fn(() => "/api/growth/calendar.ics?visible=1"),
  buildGrowthAssetFileUrl: vi.fn((id: string) => `/api/growth/assets/${id}/file`),
  fetchGrowthAssetFile: vi.fn(),
  fetchGrowthAssets: vi.fn(),
  fetchGrowthUnifiedCalendar: vi.fn(),
  generateMultipleGrowthContentPlans: vi.fn(),
  markGrowthContentPublished: vi.fn(),
  patchGrowthContentItem: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthCalendarExportUrl: mocks.buildGrowthCalendarExportUrl,
  buildGrowthAssetFileUrl: mocks.buildGrowthAssetFileUrl,
  fetchGrowthAssetFile: mocks.fetchGrowthAssetFile,
  fetchGrowthAssets: mocks.fetchGrowthAssets,
  fetchGrowthUnifiedCalendar: mocks.fetchGrowthUnifiedCalendar,
  generateMultipleGrowthContentPlans: mocks.generateMultipleGrowthContentPlans,
  markGrowthContentPublished: mocks.markGrowthContentPublished,
  patchGrowthContentItem: mocks.patchGrowthContentItem,
}));

function contentItem(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "rome-item",
    accountId: "account-a",
    repository: "acme/rome",
    planId: "plan-1",
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release angle",
    title: "Rome release",
    summary: "Read more",
    body: "Release body",
    threadPosts: [],
    media: [],
    sources: [],
    status: "draft",
    scheduledFor: "2026-10-14T22:30:00.000Z",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function repository(
  name: string,
  overrides: Partial<GrowthUnifiedCalendarRepository> = {},
): GrowthUnifiedCalendarRepository {
  return {
    repository: name,
    color: "#BE123C",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 9 }],
    pillarLabels: [{ id: "product", label: "Product news" }],
    contentItems: [],
    ...overrides,
  };
}

function calendar(): GrowthUnifiedCalendarModel {
  return {
    repositories: [
      repository("acme/rome", { contentItems: [contentItem()] }),
      repository("acme/tokyo", {
        color: "#047857",
        timezone: "Asia/Tokyo",
        postingWindows: [{ weekday: 2, hour: 16 }],
        pillarLabels: [{ id: "product", label: "Product value" }],
        contentItems: [contentItem({
          id: "tokyo-item",
          repository: "acme/tokyo",
          channel: "linkedin",
          format: "linkedin-post",
          title: "Tokyo launch",
          status: "ready",
          scheduledFor: "2026-10-14T15:30:00.000Z",
        })],
      }),
    ],
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
  document.body.classList.add("mode-growth");
  document.documentElement.dataset.theme = "dark";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.fetchGrowthAssets.mockResolvedValue([]);
  mocks.fetchGrowthUnifiedCalendar.mockResolvedValue(calendar());
  mocks.generateMultipleGrowthContentPlans.mockResolvedValue({
    ok: true,
    plans: [
      { plan: { repository: "acme/rome" }, contentItems: [], aiEnabled: false, usedFallback: true, weightsAdjusted: false },
      { plan: { repository: "acme/tokyo" }, contentItems: [], aiEnabled: false, usedFallback: true, weightsAdjusted: true },
    ],
    deconflictedItemCount: 1,
    remainingCollisionCount: 0,
  });
  mocks.patchGrowthContentItem.mockImplementation(async (id: string, updates: Partial<GrowthContentItem>) => {
    const original = calendar().repositories.flatMap((entry) => entry.contentItems).find((item) => item.id === id)!;
    return { ...original, ...updates };
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.classList.remove("mode-growth");
  delete document.documentElement.dataset.theme;
});

async function renderCalendar(
  accountId = "account-a",
  entry = "/growth/calendar?view=month&date=2026-10-15",
) {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [entry], key: entry },
        createElement(LocationProbe),
        createElement(GrowthUnifiedCalendar, { accountId, enabled: true }),
      ),
    ));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function checkboxFor(repositoryName: string): HTMLInputElement {
  const label = [...container.querySelectorAll(".growth-multi-plan-repositories label")]
    .find((entry) => entry.textContent === repositoryName);
  return label!.querySelector("input")!;
}

function selectFor(label: string): HTMLSelectElement {
  const field = [...container.querySelectorAll("label")]
    .find((entry) => entry.querySelector("span")?.textContent === label);
  return field!.querySelector("select")!;
}

async function selectValue(label: string, value: string) {
  const select = selectFor(label);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("GrowthUnifiedCalendar", () => {
  it("loads only the rendered month range and renders repository-local dates, times, colours, and stable choices", async () => {
    await renderCalendar();

    expect(mocks.fetchGrowthUnifiedCalendar).toHaveBeenCalledWith({
      scheduledFrom: "2026-09-27T10:00:00.000Z",
      scheduledTo: "2026-11-09T11:59:59.999Z",
    }, expect.any(AbortSignal));
    expect(mocks.buildGrowthCalendarExportUrl).toHaveBeenCalledWith({
      from: "2026-09-27T10:00:00.000Z",
      to: "2026-11-09T11:59:59.999Z",
    });
    expect(container.querySelectorAll(".growth-calendar-day")).toHaveLength(42);

    const localDay = container.querySelector('[data-calendar-date="2026-10-15"]')!;
    expect(localDay.textContent).toContain("Rome release");
    expect(localDay.textContent).toContain("Tokyo launch");
    expect(localDay.textContent).toContain("acme/rome");
    expect(localDay.textContent).toContain("acme/tokyo");
    const itemButtons = localDay.querySelectorAll<HTMLButtonElement>(".growth-calendar-item");
    expect([...itemButtons].map((button) => button.textContent)).toEqual([
      expect.stringContaining("00:30"),
      expect.stringContaining("00:30"),
    ]);
    expect(itemButtons[0].style.getPropertyValue("--growth-calendar-color")).toBe("#047857");
    expect(itemButtons[1].style.getPropertyValue("--growth-calendar-color")).toBe("#BE123C");
    expect([...itemButtons].every((button) => button.tabIndex === 0)).toBe(true);

    expect([...selectFor("Pillar").options].map((option) => option.value)).toEqual([
      "",
      "acme/rome::product",
      "acme/tokyo::product",
    ]);
    expect(container.querySelector(".growth-calendar-scroll .growth-calendar-grid")).not.toBeNull();
    const exportLink = [...container.querySelectorAll<HTMLAnchorElement>("a")]
      .find((link) => link.textContent === "Export calendar");
    expect(exportLink?.href).toContain("/api/growth/calendar.ics?visible=1");
  });

  it("restores combined URL filters, keeps choices stable, and clears every filter", async () => {
    await renderCalendar(
      "account-a",
      "/growth/calendar?view=month&date=2026-10-15&repository=acme%2Frome&channel=x&pillar=acme%2Frome%3A%3Aproduct&status=draft",
    );

    expect(selectFor("Repository").value).toBe("acme/rome");
    expect(selectFor("Channel").value).toBe("x");
    expect(selectFor("Pillar").value).toBe("acme/rome::product");
    expect(selectFor("Status").value).toBe("draft");
    expect(container.textContent).toContain("Rome release");
    expect(container.textContent).not.toContain("Tokyo launch");
    expect(selectFor("Repository").options).toHaveLength(3);
    expect(selectFor("Pillar").options).toHaveLength(3);

    const clear = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Clear filters")!;
    await act(async () => clear.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent)
      .toBe("/growth/calendar?view=month&date=2026-10-15");
    expect(container.textContent).toContain("Rome release");
    expect(container.textContent).toContain("Tokyo launch");

    await selectValue("Channel", "linkedin");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toContain("channel=linkedin");
    expect(container.textContent).toContain("Tokyo launch");
    expect(container.textContent).not.toContain("Rome release");
  });

  it("renders a URL-backed week and preserves status for keyboard and pointer moves in each profile timezone", async () => {
    await renderCalendar("account-a", "/growth/calendar?view=week&date=2026-10-15&repository=acme%2Frome");

    expect(container.querySelectorAll(".growth-calendar-week-day")).toHaveLength(7);
    const source = [...container.querySelectorAll<HTMLButtonElement>(".growth-calendar-item")]
      .find((button) => button.textContent?.includes("Rome release"))!;
    await act(async () => {
      source.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.patchGrowthContentItem).toHaveBeenLastCalledWith("rome-item", {
      scheduledFor: "2026-10-15T22:30:00.000Z",
      status: "draft",
    });
    expect(container.querySelector('[data-calendar-date="2026-10-16"]')?.textContent).toContain("Rome release");

    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const moved = container.querySelector<HTMLButtonElement>('[data-calendar-date="2026-10-16"] .growth-calendar-item')!;
    const target = container.querySelector<HTMLElement>('[data-calendar-date="2026-10-17"]')!;
    await act(async () => {
      const dragStart = new Event("dragstart", { bubbles: true });
      Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
      moved.dispatchEvent(dragStart);
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      target.dispatchEvent(drop);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.patchGrowthContentItem).toHaveBeenLastCalledWith("rome-item", {
      scheduledFor: "2026-10-16T22:30:00.000Z",
      status: "draft",
    });
    expect(target.textContent).toContain("Rome release");
  });

  it("generates coordinated plans in stable order, reports planning states, and refreshes the visible range", async () => {
    await renderCalendar();
    const rome = checkboxFor("acme/rome");
    const tokyo = checkboxFor("acme/tokyo");
    await act(async () => {
      rome.focus();
      rome.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      rome.click();
      tokyo.click();
    });
    const start = container.querySelector<HTMLInputElement>('.growth-multi-plan input[type="date"]')!;
    await act(async () => {
      setValue(start, "2026-11-02");
    });
    const generate = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Generate coordinated plans")!;
    await act(async () => {
      generate.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.generateMultipleGrowthContentPlans).toHaveBeenCalledWith({
      repositories: ["acme/rome", "acme/tokyo"],
      periodStart: "2026-11-02",
      periodEnd: "2026-11-08",
    }, expect.any(AbortSignal));
    expect(container.textContent).toContain("Created coordinated plans for 2 repositories.");
    expect(container.textContent).toContain("deterministic angles");
    expect(container.textContent).toContain("adjusted at least one plan's pillar mix");
    expect(container.textContent).toContain("Moved 1 content items");
    expect(mocks.fetchGrowthUnifiedCalendar).toHaveBeenCalledTimes(2);
    expect(generate.disabled).toBe(false);
  });

  it("validates selection, disables duplicate submissions, and reports partial or failed generation", async () => {
    let resolveGeneration: ((value: Record<string, unknown>) => void) | undefined;
    mocks.generateMultipleGrowthContentPlans.mockImplementationOnce(() => new Promise((resolve) => {
      resolveGeneration = resolve;
    }));
    await renderCalendar();
    const generate = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Generate coordinated plans")!;
    await act(async () => generate.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Select two through ten repositories");

    await act(async () => {
      checkboxFor("acme/rome").click();
      checkboxFor("acme/tokyo").click();
      generate.click();
      generate.click();
      await Promise.resolve();
    });
    expect(mocks.generateMultipleGrowthContentPlans).toHaveBeenCalledTimes(1);
    expect(generate.disabled).toBe(true);
    expect(generate.textContent).toContain("2 repositories");
    await act(async () => {
      resolveGeneration?.({
        ok: true,
        plans: [
          { usedFallback: false, weightsAdjusted: false },
          { usedFallback: false, weightsAdjusted: false },
        ],
        deconflictedItemCount: 3,
        remainingCollisionCount: 2,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("2 same-pillar date collisions remain");

    mocks.generateMultipleGrowthContentPlans.mockRejectedValueOnce(new Error("provider offline"));
    await act(async () => {
      generate.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("provider offline");
  });

  it("opens the shared content drawer from every item and closes it with Escape", async () => {
    await renderCalendar();
    const item = [...container.querySelectorAll<HTMLButtonElement>(".growth-calendar-item")]
      .find((button) => button.textContent?.includes("Rome release"))!;

    await act(async () => item.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Rome release");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("aborts stale account loads and never renders their results", async () => {
    let resolveStale: ((calendar: GrowthUnifiedCalendarModel) => void) | undefined;
    const stale = new Promise<GrowthUnifiedCalendarModel>((resolve) => {
      resolveStale = resolve;
    });
    const nextCalendar: GrowthUnifiedCalendarModel = {
      repositories: [repository("next/repo", {
        timezone: "UTC",
        contentItems: [contentItem({
          id: "next-item",
          accountId: "account-b",
          repository: "next/repo",
          title: "Next account launch",
          scheduledFor: "2026-10-15T10:00:00.000Z",
        })],
      })],
    };
    mocks.fetchGrowthUnifiedCalendar
      .mockImplementationOnce(() => stale)
      .mockResolvedValueOnce(nextCalendar);

    await renderCalendar();
    const staleSignal = mocks.fetchGrowthUnifiedCalendar.mock.calls[0][1] as AbortSignal;
    await renderCalendar("account-b");
    expect(staleSignal.aborted).toBe(true);
    expect(container.textContent).toContain("Next account launch");

    await act(async () => {
      resolveStale?.(calendar());
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Rome release");
  });

  it("aborts an in-flight coordinated plan when the active account changes", async () => {
    mocks.generateMultipleGrowthContentPlans.mockImplementationOnce(() => new Promise(() => {}));
    await renderCalendar();
    await act(async () => {
      checkboxFor("acme/rome").click();
      checkboxFor("acme/tokyo").click();
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Generate coordinated plans")!
        .click();
      await Promise.resolve();
    });
    const generationSignal = mocks.generateMultipleGrowthContentPlans.mock.calls[0][1] as AbortSignal;

    await renderCalendar("account-b");
    expect(generationSignal.aborted).toBe(true);
    expect(container.textContent).not.toContain("Created coordinated plans");
  });

  it("renders localized failures, filtered empty states, and responsive controls in dark and light themes", async () => {
    mocks.fetchGrowthUnifiedCalendar.mockRejectedValueOnce(new Error("calendar unavailable"));
    await renderCalendar();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("calendar unavailable");

    mocks.fetchGrowthUnifiedCalendar.mockResolvedValueOnce(calendar());
    await renderCalendar("account-b", "/growth/calendar?view=week&date=2026-10-15&status=published");
    expect(container.textContent).toContain("No content matches these filters");

    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      for (const width of [1440, 1024, 390]) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.dispatchEvent(new Event("resize"));
        expect(container.querySelector(".growth-unified-calendar-filters")).not.toBeNull();
        expect(container.querySelector(".growth-multi-plan-repositories")).not.toBeNull();
        expect(container.querySelector(".growth-calendar-scroll")).not.toBeNull();
      }
    }
  });
});
