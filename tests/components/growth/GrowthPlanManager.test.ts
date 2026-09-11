import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthPlanManager } from "../../../src/components/growth/calendar/GrowthPlanManager";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthContentPlan } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  fetchGrowthContentPlans: vi.fn(),
  generateGrowthContentPlan: vi.fn(),
  regenerateGrowthContentPlan: vi.fn(),
  archiveGrowthContentPlan: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  fetchGrowthContentPlans: mocks.fetchGrowthContentPlans,
  generateGrowthContentPlan: mocks.generateGrowthContentPlan,
  regenerateGrowthContentPlan: mocks.regenerateGrowthContentPlan,
  archiveGrowthContentPlan: mocks.archiveGrowthContentPlan,
}));

function plan(overrides: Partial<GrowthContentPlan> = {}): GrowthContentPlan {
  return {
    id: "plan-1",
    accountId: "account-a",
    repository: "acme/rocket",
    periodStart: "2026-09-14",
    periodEnd: "2026-09-20",
    cadence: { x: 1, linkedin: 0, mastodon: 0, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product", weight: 100, description: "" }],
    status: "active",
    generatedAt: "2026-09-04T08:00:00.000Z",
    createdAt: "2026-09-04T08:00:00.000Z",
    ...overrides,
  };
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

let container: HTMLDivElement;
let root: Root;
let onContentItemsChange: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T12:00:00.000Z"));
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onContentItemsChange = vi.fn();
  mocks.fetchGrowthContentPlans.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function renderManager() {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(GrowthPlanManager, {
        accountId: "account-a",
        enabled: true,
        repository: "acme/rocket",
        onContentItemsChange,
      }),
    ));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const match = [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

describe("GrowthPlanManager", () => {
  it("renders localized loading and empty states", async () => {
    let resolvePlans: ((plans: GrowthContentPlan[]) => void) | undefined;
    mocks.fetchGrowthContentPlans.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePlans = resolve;
    }));

    await renderManager();
    expect(container.textContent).toContain("Loading editorial plans");

    await act(async () => {
      resolvePlans?.([]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("No editorial plans yet");
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-09-14");
    expect(container.querySelectorAll("select option")).toHaveLength(4);
  });

  it("validates complete weeks and reports deterministic fallback after creation", async () => {
    const created = plan({ periodEnd: "2026-10-11" });
    mocks.fetchGrowthContentPlans
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created]);
    mocks.generateGrowthContentPlan.mockResolvedValue({
      ok: true,
      plan: created,
      contentItems: [],
      aiEnabled: false,
      usedFallback: true,
      weightsAdjusted: true,
    });
    await renderManager();

    const start = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    const duration = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      setValue(start, "2026-09-15");
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.generateGrowthContentPlan).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("valid Monday");

    await act(async () => {
      setValue(start, "2026-09-14");
      setValue(duration, "4");
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.generateGrowthContentPlan).toHaveBeenCalledWith({
      repository: "acme/rocket",
      periodStart: "2026-09-14",
      periodEnd: "2026-10-11",
    }, expect.any(AbortSignal));
    expect(container.textContent).toContain("deterministic fallback");
    expect(container.textContent).toContain("Recent seven-day results gently adjusted");
    expect(container.textContent).toContain("Active");
    expect(onContentItemsChange).toHaveBeenCalledTimes(1);
  });

  it("confirms regeneration and archive, refreshes content, and renders request errors", async () => {
    const source = plan();
    const archivedSource = plan({ status: "archived" });
    const replacement = plan({ id: "plan-2", generatedAt: "2026-09-05T08:00:00.000Z" });
    mocks.fetchGrowthContentPlans
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([replacement, archivedSource])
      .mockResolvedValueOnce([plan({ ...replacement, status: "archived" }), archivedSource]);
    mocks.regenerateGrowthContentPlan.mockResolvedValue({
      ok: true,
      sourcePlan: archivedSource,
      affectedContentItems: [],
      plan: replacement,
      contentItems: [],
      aiEnabled: true,
      usedFallback: false,
      weightsAdjusted: false,
    });
    mocks.archiveGrowthContentPlan.mockResolvedValue({
      ok: true,
      plan: { ...replacement, status: "archived" },
      contentItems: [],
    });
    await renderManager();

    await act(async () => button("Regenerate", container).click());
    const regenerateDialog = document.querySelector('[role="alertdialog"]')!;
    expect(regenerateDialog.textContent).toContain("Only ideas and drafts");
    await act(async () => {
      button("Regenerate", regenerateDialog).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.regenerateGrowthContentPlan).toHaveBeenCalledWith("plan-1", expect.any(AbortSignal));

    await act(async () => button("Archive", container).click());
    const archiveDialog = document.querySelector('[role="alertdialog"]')!;
    expect(archiveDialog.textContent).toContain("Ready, scheduled, published");
    await act(async () => {
      button("Archive", archiveDialog).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.archiveGrowthContentPlan).toHaveBeenCalledWith("plan-2", expect.any(AbortSignal));
    expect(onContentItemsChange).toHaveBeenCalledTimes(2);

    mocks.fetchGrowthContentPlans.mockResolvedValueOnce([source]);
    mocks.regenerateGrowthContentPlan.mockRejectedValueOnce(new Error("provider unavailable"));
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderManager();
    await act(async () => button("Regenerate", container).click());
    await act(async () => {
      button("Regenerate", document.querySelector('[role="alertdialog"]')!).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("provider unavailable");
  });
});
