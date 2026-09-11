import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthInterventions } from "../../../src/components/growth/GrowthInterventions";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthContentItem, GrowthIntervention, GrowthInterventionStatus } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  fetchAiSettings: vi.fn(),
  fetchGrowthInterventions: vi.fn(),
  fetchGrowthContentItems: vi.fn(),
  fetchGrowthAssets: vi.fn(),
  createGrowthIntervention: vi.fn(),
  draftGrowthContentFromIntervention: vi.fn(),
  generateGrowthInterventions: vi.fn(),
  patchGrowthIntervention: vi.fn(),
  recycleGrowthIntervention: vi.fn(),
  scanGrowthOpportunities: vi.fn(),
  patchGrowthContentItem: vi.fn(),
  markGrowthContentPublished: vi.fn(),
  useGoals: vi.fn(),
}));

vi.mock("../../../src/api/github", () => ({ fetchAiSettings: mocks.fetchAiSettings }));
vi.mock("../../../src/api/growth", () => ({
  fetchGrowthInterventions: mocks.fetchGrowthInterventions,
  fetchGrowthContentItems: mocks.fetchGrowthContentItems,
  fetchGrowthAssets: mocks.fetchGrowthAssets,
  createGrowthIntervention: mocks.createGrowthIntervention,
  draftGrowthContentFromIntervention: mocks.draftGrowthContentFromIntervention,
  generateGrowthInterventions: mocks.generateGrowthInterventions,
  patchGrowthIntervention: mocks.patchGrowthIntervention,
  recycleGrowthIntervention: mocks.recycleGrowthIntervention,
  scanGrowthOpportunities: mocks.scanGrowthOpportunities,
  patchGrowthContentItem: mocks.patchGrowthContentItem,
  markGrowthContentPublished: mocks.markGrowthContentPublished,
}));
vi.mock("../../../src/hooks/useGoals", () => ({ useGoals: mocks.useGoals }));

function intervention(
  id: string,
  status: GrowthInterventionStatus,
  overrides: Partial<GrowthIntervention> = {},
): GrowthIntervention {
  return {
    id,
    accountId: "account-a",
    repository: "acme/rocket",
    goalId: status === "proposed" ? "goal-1" : null,
    category: "marketing",
    title: `${status} action`,
    action: `Complete the ${status} action.`,
    origin: "ai",
    ruleKey: null,
    dedupeKey: id,
    status,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const interventions = [
    intervention("proposed", "proposed"),
    intervention("accepted", "accepted"),
    intervention("done", "done"),
    intervention("dismissed", "dismissed"),
  ];
  mocks.fetchAiSettings.mockResolvedValue({ settings: { enabled: false } });
  mocks.fetchGrowthInterventions.mockResolvedValue(interventions);
  const contentItem = {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: null,
    interventionId: "proposed",
    goalIds: ["goal-1"],
    channel: "x",
    format: "x-thread",
    pillar: "",
    angle: "",
    title: "Launch thread",
    summary: "A launch campaign",
    body: "Launch body",
    threadPosts: ["First launch post", "Second launch post"],
    media: [{ kind: "image", url: "https://example.com/launch.png", alt: "Launch" }],
    sources: [],
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    publishedUrl: null,
    generatedAt: "2026-09-04T00:00:00.000Z",
    generationVersion: 4,
    evergreen: 0,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
  mocks.fetchGrowthContentItems.mockResolvedValue([contentItem]);
  mocks.fetchGrowthAssets.mockResolvedValue([]);
  mocks.draftGrowthContentFromIntervention.mockResolvedValue({ ok: true, contentItems: [contentItem], cached: true });
  mocks.generateGrowthInterventions.mockResolvedValue({ ok: true, interventions: [], aiEnabled: true });
  mocks.scanGrowthOpportunities.mockResolvedValue({
    ok: true,
    interventions: [],
    scannedAt: "2026-09-04T12:00:00.000Z",
  });
  mocks.useGoals.mockReturnValue({
    goals: [{ id: "goal-1", metric: "stars", currentValue: 50, targetValue: 100 }],
  });
  mocks.patchGrowthIntervention.mockImplementation(async (id: string, updates: { status: GrowthInterventionStatus }) => ({
    ...interventions.find((item) => item.id === id)!,
    status: updates.status,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.classList.remove("mode-growth");
  delete document.documentElement.dataset.theme;
});

async function renderPanel(accountId = "account-a", repository = "acme/rocket") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [`/growth/r/${repository}/interventions`] },
        createElement(GrowthInterventions, {
          accountId,
          enabled: true,
          repository,
        }),
      ),
    ));
    await flush();
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("GrowthInterventions", () => {
  it("renders status groups, linked goals and content while keeping dismissed actions collapsed", async () => {
    await renderPanel();

    expect(container.textContent).toContain("Growth interventions");
    expect(container.textContent).toContain("Mission: Stars 50 / 100");
    expect(container.textContent).toContain("Launch thread");
    expect(container.textContent).toContain("AI is not configured");
    expect(container.textContent).not.toContain("dismissed action");

    const dismissedToggle = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Dismissed"));
    await act(async () => dismissedToggle?.click());
    expect(container.textContent).toContain("dismissed action");
  });

  it("drafts content from an intervention and opens the returned item drawer", async () => {
    await renderPanel();
    const draft = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Draft from intervention");

    await act(async () => {
      draft?.click();
      await Promise.resolve();
    });

    expect(mocks.draftGrowthContentFromIntervention).toHaveBeenCalledWith("proposed");
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Launch thread");
  });

  it("shows drafting failures and the AI preferences handoff inline", async () => {
    mocks.draftGrowthContentFromIntervention.mockRejectedValueOnce(new Error("AI is not configured"));
    await renderPanel();
    const draft = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Draft from intervention");

    await act(async () => {
      draft?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("AI is not configured");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/preferences#preferences-ai"]')?.target).toBe("_blank");
  });

  it("creates a manual intervention in a dedicated modal", async () => {
    mocks.createGrowthIntervention.mockResolvedValueOnce(intervention("manual", "proposed", { origin: "manual" }));
    await renderPanel();

    expect(container.querySelector(".growth-interventions-manual input")).toBeNull();
    await act(async () => button("Add an intervention").click());

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    const title = dialog?.querySelector<HTMLInputElement>('input');
    const action = dialog?.querySelector<HTMLTextAreaElement>('textarea');
    expect(dialog?.textContent).toContain("Manual action");
    expect(title).toBe(document.activeElement);

    await act(async () => {
      if (title) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Improve onboarding");
        title.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (action) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(action, "Publish a guided setup flow.");
        action.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      const submit = [...dialog!.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === "Add to backlog");
      submit?.click();
      await flush();
    });

    expect(mocks.createGrowthIntervention).toHaveBeenCalledWith({
      repository: "acme/rocket",
      category: "product",
      title: "Improve onboarding",
      action: "Publish a guided setup flow.",
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("updates an intervention status through the account-scoped API", async () => {
    await renderPanel();
    const accept = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Accept");

    await act(async () => {
      accept?.click();
      await Promise.resolve();
    });

    expect(mocks.patchGrowthIntervention).toHaveBeenCalledWith("proposed", { status: "accepted" });
  });

  it("runs an explicit keyboard-accessible scan and explains all six opportunity kinds", async () => {
    const kinds = [
      ["release:v2", "Release follow-up"],
      ["star-milestone:100", "Star milestone"],
      ["good-first-issue:12", "Good first issue"],
      ["merged-pr:42", "Merged pull request"],
      ["goal-pace:goal-1", "Mission pace"],
      ["evergreen:content-1", "Evergreen recycling"],
    ] as const;
    const scanned = kinds.map(([ruleKey], index) => intervention(`rule-${index}`, "proposed", {
      goalId: null,
      origin: "rule",
      ruleKey,
      title: `Detected opportunity ${index + 1}`,
      dedupeKey: `rule-${index}`,
    }));
    let resolveScan: ((value: { ok: true; interventions: GrowthIntervention[]; scannedAt: string }) => void) | undefined;
    mocks.fetchGrowthInterventions.mockResolvedValue(scanned);
    mocks.scanGrowthOpportunities.mockImplementationOnce(() => new Promise((resolve) => {
      resolveScan = resolve;
    }));

    await renderPanel();
    expect(container.textContent).toContain("Scan on demand for release follow-ups");
    const scan = button("Scan opportunities");
    scan.focus();
    expect(document.activeElement).toBe(scan);

    await act(async () => {
      scan.click();
      scan.click();
      await flush();
    });
    expect(mocks.scanGrowthOpportunities).toHaveBeenCalledTimes(1);
    expect(mocks.scanGrowthOpportunities).toHaveBeenCalledWith("acme/rocket", expect.any(AbortSignal));
    expect(button("Scanning…").disabled).toBe(true);
    expect(container.textContent).toContain("Checking the latest available repository signals");

    await act(async () => {
      resolveScan?.({ ok: true, interventions: scanned, scannedAt: "2026-09-04T12:00:00.000Z" });
      await flush();
    });

    expect(container.textContent).toContain("Created or refreshed 6 rule-based opportunities");
    expect(container.textContent).toContain("Signal types unavailable from GitHub are skipped safely");
    for (const [ruleKey, label] of kinds) {
      expect(container.textContent).toContain(label);
      expect(container.textContent).not.toContain(ruleKey);
    }
    expect(container.textContent).toContain("Opportunity scan");
  });

  it("recycles only eligible evergreen rule cards and reconciles busy, success, duplicate, and error states", async () => {
    const source: GrowthContentItem = {
      id: "evergreen-source",
      accountId: "account-a",
      repository: "acme/rocket",
      planId: null,
      interventionId: null,
      goalIds: ["goal-1"],
      channel: "linkedin",
      format: "linkedin-post",
      pillar: "education",
      angle: "Original angle",
      title: "Evergreen guide",
      summary: "Original summary",
      body: "Original copy",
      threadPosts: [],
      media: [{ kind: "image", url: "https://example.com/guide.png", alt: "Guide" }],
      sources: ["https://example.com/guide"],
      status: "published",
      scheduledFor: null,
      publishedAt: "2020-01-01T00:00:00.000Z",
      publishedUrl: "https://social.example/guide",
      generatedAt: null,
      generationVersion: 1,
      evergreen: 1,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const evergreenRule = intervention("evergreen-rule", "proposed", {
      goalId: null,
      origin: "rule",
      ruleKey: `evergreen:${source.id}`,
      title: "Recycle evergreen guide",
    });
    const ordinaryRule = intervention("release-rule", "proposed", {
      goalId: null,
      origin: "rule",
      ruleKey: "release:v2",
      title: "Release follow-up",
    });
    const recycled: GrowthContentItem = {
      ...source,
      id: "recycled-idea",
      interventionId: evergreenRule.id,
      title: "",
      body: "",
      media: [],
      status: "idea",
      publishedAt: null,
      publishedUrl: null,
      evergreen: 0,
    };
    mocks.fetchGrowthInterventions.mockResolvedValue([evergreenRule, ordinaryRule]);
    mocks.fetchGrowthContentItems.mockResolvedValue([source]);
    let resolveRecycle: ((value: { ok: true; contentItem: GrowthContentItem; duplicate: boolean }) => void) | undefined;
    mocks.recycleGrowthIntervention.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRecycle = resolve;
    }));

    await renderPanel();
    expect([...container.querySelectorAll("button")].filter((entry) => entry.textContent === "Recycle to idea"))
      .toHaveLength(1);
    const recycle = button("Recycle to idea");
    recycle.focus();
    expect(document.activeElement).toBe(recycle);
    await act(async () => {
      recycle.click();
      await flush();
    });
    expect(button("Recycling…").disabled).toBe(true);
    expect(mocks.recycleGrowthIntervention).toHaveBeenCalledWith(evergreenRule.id);

    await act(async () => {
      resolveRecycle?.({ ok: true, contentItem: recycled, duplicate: false });
      await flush();
    });
    expect(container.textContent).toContain("A fresh idea was created");
    expect(container.textContent).toContain("Content items (1)");

    mocks.recycleGrowthIntervention.mockResolvedValueOnce({ ok: true, contentItem: recycled, duplicate: true });
    await act(async () => {
      button("Recycle to idea").click();
      await flush();
    });
    expect(container.textContent).toContain("already has a recycled idea");
    expect(container.querySelectorAll(".growth-intervention-content li")).toHaveLength(1);

    mocks.recycleGrowthIntervention.mockRejectedValueOnce(new Error("no longer eligible"));
    await act(async () => {
      button("Recycle to idea").click();
      await flush();
    });
    expect(container.querySelector(".growth-intervention-recycle-feedback.error")?.textContent)
      .toContain("no longer eligible");
  });

  it("renders no-op and request-error scan states without running automatically", async () => {
    mocks.fetchGrowthInterventions.mockResolvedValue([]);
    await renderPanel();
    expect(mocks.scanGrowthOpportunities).not.toHaveBeenCalled();

    await act(async () => {
      button("Scan opportunities").click();
      await flush();
    });
    expect(container.textContent).toContain("No current opportunities were detected");
    expect(container.textContent).toContain("repository signals currently available");

    mocks.scanGrowthOpportunities.mockRejectedValueOnce(new Error("signals unavailable"));
    await act(async () => {
      button("Scan opportunities").click();
      await flush();
    });
    expect(container.querySelector(".growth-opportunity-scan-error")?.textContent)
      .toContain("Could not scan opportunities: signals unavailable");
  });

  it("reconciles repeated scans without duplicates and preserves status alongside AI generation", async () => {
    const acceptedRule = intervention("rule-release", "accepted", {
      goalId: null,
      origin: "rule",
      ruleKey: "release:v2",
      title: "Share release v2",
      dedupeKey: "rule-release",
    });
    const backlog = [intervention("ai-action", "proposed"), acceptedRule];
    mocks.fetchGrowthInterventions.mockResolvedValue(backlog);
    mocks.scanGrowthOpportunities.mockResolvedValue({
      ok: true,
      interventions: [acceptedRule],
      scannedAt: "2026-09-04T12:00:00.000Z",
    });

    await renderPanel();
    for (let count = 0; count < 2; count += 1) {
      await act(async () => {
        button("Scan opportunities").click();
        await flush();
      });
    }

    expect(mocks.scanGrowthOpportunities).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".growth-intervention-card h3"))
      .toHaveLength(2);
    expect(container.querySelector(".status-accepted")?.textContent).toContain("Share release v2");
    expect(container.textContent).toContain("Generate interventions");
    expect(container.textContent).toContain("Add an intervention");

    await act(async () => {
      button("Generate interventions").click();
      await flush();
    });
    expect(mocks.generateGrowthInterventions).toHaveBeenCalledWith("acme/rocket", undefined);
  });

  it.each([
    ["account", "account-b", "acme/rocket"],
    ["repository", "account-a", "acme/comet"],
  ])("aborts an in-flight scan when the %s changes", async (_owner, nextAccountId, nextRepository) => {
    let resolveScan: ((value: { ok: true; interventions: GrowthIntervention[]; scannedAt: string }) => void) | undefined;
    mocks.scanGrowthOpportunities.mockImplementationOnce((_repository: string, _signal: AbortSignal) => new Promise((resolve) => {
      resolveScan = resolve;
    }));
    await renderPanel();

    await act(async () => {
      button("Scan opportunities").click();
      await flush();
    });
    const signal = mocks.scanGrowthOpportunities.mock.calls[0][1] as AbortSignal;
    await renderPanel(nextAccountId, nextRepository);
    expect(signal.aborted).toBe(true);

    await act(async () => {
      resolveScan?.({
        ok: true,
        interventions: [intervention("stale-rule", "proposed", {
          origin: "rule",
          ruleKey: "release:stale",
          title: "Stale opportunity",
        })],
        scannedAt: "2026-09-04T12:00:00.000Z",
      });
      await flush();
    });
    expect(container.textContent).not.toContain("Stale opportunity");
    expect(container.textContent).not.toContain("Created or refreshed");
  });

  it("aborts the post-scan backlog reload when request ownership changes", async () => {
    let resolveReload: ((value: GrowthIntervention[]) => void) | undefined;
    mocks.fetchGrowthInterventions
      .mockResolvedValueOnce([])
      .mockImplementationOnce((_filters, _signal: AbortSignal) => new Promise((resolve) => {
        resolveReload = resolve;
      }))
      .mockResolvedValue([]);
    await renderPanel();

    await act(async () => {
      button("Scan opportunities").click();
      await flush();
    });
    const reloadSignal = mocks.fetchGrowthInterventions.mock.calls[1][1] as AbortSignal;
    await renderPanel("account-b", "acme/comet");
    expect(reloadSignal.aborted).toBe(true);

    await act(async () => {
      resolveReload?.([intervention("stale-reload", "proposed", { title: "Stale reload" })]);
      await flush();
    });
    expect(container.textContent).not.toContain("Stale reload");
  });

  it.each(["dark", "light"])("keeps scan, AI, filters, and manual controls available at 390px in %s theme", async (theme) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    document.documentElement.dataset.theme = theme;
    document.body.classList.add("mode-growth");
    await renderPanel();

    const scan = button("Scan opportunities");
    expect(scan.type).toBe("button");
    expect(scan.closest(".growth-interventions-scan")).not.toBeNull();
    expect(button("Generate interventions")).not.toBeNull();
    expect(container.querySelectorAll(".growth-interventions-filters select")).toHaveLength(2);
    expect(container.querySelector(".growth-interventions-manual-launcher")).not.toBeNull();

    await act(async () => button("Add an intervention").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("input")).not.toBeNull();
    expect(dialog?.querySelector("textarea")).not.toBeNull();
  });
});
