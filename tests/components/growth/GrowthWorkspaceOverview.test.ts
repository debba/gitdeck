import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthWorkspaceOverview } from "../../../src/components/growth/GrowthWorkspaceOverview";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GhRepo } from "../../../src/types/github";
import type { RepositoryGoal } from "../../../src/types/goals";

const hooks = vi.hoisted(() => ({
  useGoals: vi.fn(),
}));

vi.mock("../../../src/hooks/useGoals", () => ({
  useGoals: hooks.useGoals,
}));

const repository: GhRepo = {
  nameWithOwner: "acme/rocket",
  name: "rocket",
  owner: { login: "acme", avatarUrl: "https://example.com/acme.png" },
  description: "A fast repository",
  stargazerCount: 1250,
  forkCount: 42,
  primaryLanguage: { name: "TypeScript" },
  updatedAt: "2026-09-04T00:00:00.000Z",
  pushedAt: "2026-09-04T00:00:00.000Z",
  visibility: "PUBLIC",
  isPrivate: false,
  isArchived: false,
  isFork: false,
  url: "https://github.com/acme/rocket",
};

function goal(): RepositoryGoal {
  return {
    id: "goal-1",
    accountId: "account-a",
    repository: repository.nameWithOwner,
    metric: "stars",
    targetValue: 100,
    currentValue: 50,
    deadline: "2099-12-31",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    suggestions: [],
    suggestionsGeneratedAt: null,
    aiEnabled: true,
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderOverview() {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ["/growth/r/acme/rocket"] },
        createElement(GrowthWorkspaceOverview, {
          accountId: "account-a",
          enabled: true,
          repository: repository.nameWithOwner,
          repos: [repository],
        }),
      ),
    ));
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  hooks.useGoals.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("GrowthWorkspaceOverview", () => {
  it("renders repository identity and the empty mission and activity states", async () => {
    hooks.useGoals.mockReturnValue({ goals: [], loading: false, error: "", refresh: vi.fn() });

    await renderOverview();

    expect(container.textContent).toContain("acme/rocket");
    expect(container.textContent).toContain("A fast repository");
    expect(container.textContent).toContain("No missions exist for this repository yet.");
    expect([...container.querySelectorAll(".growth-overview-counters dd")].map((node) => node.textContent))
      .toEqual(Array(10).fill("0"));
    expect(container.textContent).toContain("No content is scheduled for the next 7 days.");
  });

  it("renders calculated progress when the repository has a mission", async () => {
    hooks.useGoals.mockReturnValue({ goals: [goal()], loading: false, error: "", refresh: vi.fn() });

    await renderOverview();

    expect(container.textContent).toContain("0 of 1 completed");
    expect(container.textContent).toContain("50%");
    expect(container.textContent).toContain("50 / 100");
    expect(container.textContent).not.toContain("No missions exist for this repository yet.");
  });
});
