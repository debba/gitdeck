import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGoals, type GoalsState } from "../../src/hooks/useGoals";
import type { RepositoryGoal } from "../../src/types/goals";

const api = vi.hoisted(() => ({
  fetchGoals: vi.fn(),
}));

vi.mock("../../src/api/github", () => ({
  fetchGoals: api.fetchGoals,
}));

interface HarnessProps {
  accountId: string;
  repository?: string;
}

let latest: GoalsState;
let root: Root;
let container: HTMLDivElement;

function goal(id: string, repository: string): RepositoryGoal {
  return {
    id,
    accountId: "account-a",
    repository,
    metric: "stars",
    targetValue: 100,
    currentValue: 50,
    deadline: "2026-12-31",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    suggestions: [],
    suggestionsGeneratedAt: null,
    aiEnabled: true,
  };
}

function Harness({ accountId, repository }: HarnessProps) {
  latest = useGoals({ accountId, enabled: true, repository });
  return null;
}

async function render(props: HarnessProps) {
  await act(async () => {
    root.render(createElement(Harness, props));
    await Promise.resolve();
  });
}

beforeEach(() => {
  api.fetchGoals.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("useGoals", () => {
  it("loads every goal when no repository scope is provided", async () => {
    api.fetchGoals.mockResolvedValueOnce({
      ok: true,
      goals: [goal("one", "owner/one"), goal("two", "owner/two")],
    });

    await render({ accountId: "account-a" });

    expect(latest.goals.map((entry) => entry.id)).toEqual(["one", "two"]);
    expect(latest.loading).toBe(false);
  });

  it("loads only goals for the selected repository and supports refresh", async () => {
    api.fetchGoals
      .mockResolvedValueOnce({ ok: true, goals: [goal("one", "owner/one"), goal("two", "owner/two")] })
      .mockResolvedValueOnce({ ok: true, goals: [goal("three", "owner/one")] });

    await render({ accountId: "account-a", repository: "owner/one" });

    expect(latest.goals.map((entry) => entry.id)).toEqual(["one"]);
    expect(latest.loading).toBe(false);
    expect(api.fetchGoals).toHaveBeenCalledWith(expect.any(AbortSignal));

    await act(async () => latest.refresh());
    expect(latest.goals.map((entry) => entry.id)).toEqual(["three"]);
  });

  it("aborts and ignores a stale request when the active account changes", async () => {
    let oldSignal: AbortSignal | undefined;
    let resolveOld!: (value: { ok: true; goals: RepositoryGoal[] }) => void;
    api.fetchGoals
      .mockImplementationOnce((signal?: AbortSignal) => {
        oldSignal = signal;
        return new Promise((resolve) => { resolveOld = resolve; });
      })
      .mockResolvedValueOnce({ ok: true, goals: [goal("new", "owner/one")] });

    await render({ accountId: "account-a", repository: "owner/one" });
    await render({ accountId: "account-b", repository: "owner/one" });

    expect(oldSignal?.aborted).toBe(true);
    expect(latest.goals.map((entry) => entry.id)).toEqual(["new"]);

    await act(async () => resolveOld({ ok: true, goals: [goal("old", "owner/one")] }));
    expect(latest.goals.map((entry) => entry.id)).toEqual(["new"]);
  });
});
