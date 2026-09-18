import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthHome } from "../../../src/components/growth/GrowthHome";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GhRepo } from "../../../src/types/github";
import type { GrowthContentItem, GrowthWorkspaceSummary } from "../../../src/types/growth";
import type { RepositoryGoal } from "../../../src/types/goals";
import { growthProfileColor } from "../../../src/utils/growth/profileDefaults";

const mocks = vi.hoisted(() => ({
  fetchGrowthWorkspaces: vi.fn(),
  useGoals: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  fetchGrowthWorkspaces: mocks.fetchGrowthWorkspaces,
}));
vi.mock("../../../src/hooks/useGoals", () => ({ useGoals: mocks.useGoals }));

function repo(nameWithOwner: string): GhRepo {
  const [owner, name] = nameWithOwner.split("/");
  return {
    nameWithOwner,
    name,
    owner: { login: owner },
    description: `${name} description`,
    stargazerCount: 10,
    forkCount: 2,
    primaryLanguage: null,
    updatedAt: "2026-09-04T00:00:00.000Z",
    pushedAt: "2026-09-04T00:00:00.000Z",
    visibility: "PUBLIC",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    url: `https://github.com/${nameWithOwner}`,
  };
}

function goal(repository: string): RepositoryGoal {
  return {
    id: `goal:${repository}`,
    accountId: "account-a",
    repository,
    metric: "stars",
    targetValue: 10,
    currentValue: 2,
    deadline: "2026-12-31",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    suggestions: [],
    suggestionsGeneratedAt: null,
    aiEnabled: false,
  };
}

function workspace(repository: string): GrowthWorkspaceSummary {
  return {
    repository,
    color: "#BE123C",
    interventionsByStatus: { proposed: 3, accepted: 2, dismissed: 0, done: 0 },
    contentItemsByStatus: { idea: 0, draft: 4, ready: 1, scheduled: 1, published: 0, skipped: 0 },
    nextSevenDays: [{} as GrowthContentItem, {} as GrowthContentItem],
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
  document.body.classList.add("mode-growth");
  root = createRoot(container);
  mocks.useGoals.mockReturnValue({ goals: [], loading: false, error: "", refresh: vi.fn() });
  mocks.fetchGrowthWorkspaces.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.classList.remove("mode-growth");
  delete document.documentElement.dataset.theme;
});

async function renderHome(accountId = "account-a", repos: GhRepo[] = []) {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ["/growth"] },
        createElement(GrowthHome, {
          accountId,
          enabled: true,
          repos,
          repositoriesLoading: false,
          onSelectRepository: vi.fn(),
        }),
      ),
    ));
    await flush();
  });
}

describe("GrowthHome", () => {
  it("shows account totals, full workspace activity, colours, fallback identity, and global links", async () => {
    const profileOnly = repo("acme/profile-only");
    const starter = repo("acme/starter");
    const fallbackRepository = "legacy/missing";
    mocks.useGoals.mockReturnValue({
      goals: [goal(fallbackRepository)],
      loading: false,
      error: "",
      refresh: vi.fn(),
    });
    mocks.fetchGrowthWorkspaces.mockResolvedValue([workspace(profileOnly.nameWithOwner)]);

    await renderHome("account-a", [profileOnly, starter]);

    expect(mocks.fetchGrowthWorkspaces).toHaveBeenCalledWith(expect.any(AbortSignal));
    const stats = Object.fromEntries([...container.querySelectorAll(".growth-home-stats > div")].map((entry) => [
      entry.querySelector("dt")?.textContent,
      entry.querySelector("dd")?.textContent,
    ]));
    expect(stats).toMatchObject({
      "Workspaces": "2",
      "Proposed interventions": "3",
      "Accepted interventions": "2",
      "Draft content": "4",
      "Ready content": "1",
      "Next 7 days": "2",
    });

    const cards = [...container.querySelectorAll<HTMLElement>(".growth-home-card")];
    const profileCard = cards.find((card) => card.textContent?.includes("acme/profile-only"));
    const fallbackCard = cards.find((card) => card.textContent?.includes(fallbackRepository));
    expect(profileCard?.style.getPropertyValue("--workspace-color")).toBe("#BE123C");
    expect(fallbackCard?.style.getPropertyValue("--workspace-color")).toBe(growthProfileColor(fallbackRepository));
    expect(fallbackCard?.textContent).toContain("No description");
    expect(container.textContent).toContain("profile-only description");

    const shortcutLinks = [...container.querySelectorAll<HTMLAnchorElement>(".growth-home-shortcuts a")];
    expect(shortcutLinks.map((link) => new URL(link.href).pathname)).toEqual([
      "/growth/calendar",
      "/growth/review",
      "/growth/settings",
    ]);
    for (const link of shortcutLinks) {
      link.focus();
      expect(document.activeElement).toBe(link);
    }
    await act(async () => {
      container.querySelector<HTMLInputElement>(".growth-home-start input")?.focus();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("acme/starter");
  });

  it("renders deterministic empty totals and the starter state in dark and light themes", async () => {
    const available = repo("acme/available");
    for (const theme of ["dark", "light"] as const) {
      document.documentElement.dataset.theme = theme;
      await renderHome("account-a", [available]);
      expect(container.textContent).toContain("No Growth workspaces yet");
      expect([...container.querySelectorAll(".growth-home-stats dd")].map((entry) => entry.textContent))
        .toEqual(Array(8).fill("0"));
      expect(container.querySelector<HTMLAnchorElement>('a[href="#growth-start-repository"]')).not.toBeNull();
    }
  });

  it("aborts and ignores a stale workspace load when the active account changes", async () => {
    let resolveFirst: ((value: GrowthWorkspaceSummary[]) => void) | undefined;
    mocks.fetchGrowthWorkspaces
      .mockImplementationOnce((_signal: AbortSignal) => new Promise<GrowthWorkspaceSummary[]>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce([workspace("acme/current")]);

    await renderHome("account-a");
    const firstSignal = mocks.fetchGrowthWorkspaces.mock.calls[0][0] as AbortSignal;
    await renderHome("account-b");

    expect(firstSignal.aborted).toBe(true);
    expect(container.textContent).toContain("acme/current");
    await act(async () => {
      resolveFirst?.([workspace("acme/stale")]);
      await flush();
    });
    expect(container.textContent).not.toContain("acme/stale");
  });
});
