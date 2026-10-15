import { describe, expect, it } from "vitest";
import { hasBoards, isProjectsAccessError, openBoards } from "../../src/utils/boards";
import type { GhBoard, GhIssue } from "../../src/types/github";

const roadmap: GhBoard = { id: "PVT_roadmap", number: 1, name: "acme/Roadmap" };

function issue(boards?: GhBoard[]): GhIssue {
  return {
    repository: { name: "app", nameWithOwner: "acme/app" },
    title: "Fix dark mode contrast",
    url: "https://github.com/acme/app/issues/1",
    number: 1,
    createdAt: "2026-04-20T10:00:00Z",
    updatedAt: "2026-04-22T10:00:00Z",
    labels: [],
    commentsCount: 0,
    boards,
  };
}

const project = { id: roadmap.id, number: roadmap.number, title: "Roadmap", closed: false, owner: { login: "acme" } };

describe("board utilities", () => {
  it("keeps a stable project ID separate from its display name", () => {
    expect(openBoards([{ project }])).toEqual([roadmap]);
    expect(openBoards([{ project: { ...project, title: "New roadmap" } }])).toEqual([{ ...roadmap, name: "acme/New roadmap" }]);
  });

  it("keeps distinct projects with the same owner and title", () => {
    expect(openBoards([{ project }, { project: { ...project, id: "PVT_other", number: 2 } }])).toHaveLength(2);
  });

  it("skips closed, hidden and duplicate project IDs", () => {
    expect(openBoards([{ project }, { project }, { project: { ...project, id: "PVT_closed", closed: true } }, { project: null }, null])).toEqual([roadmap]);
  });

  it("falls back to the title when the owner is unknown", () => {
    expect(openBoards([{ project: { ...project, owner: null } }])).toEqual([{ ...roadmap, name: "Roadmap" }]);
  });

  it("returns no boards when project items are missing", () => {
    expect(openBoards(undefined)).toEqual([]);
    expect(openBoards(null)).toEqual([]);
  });

  it("detects whether any issue sits on a board", () => {
    expect(hasBoards([issue(), issue([roadmap])])).toBe(true);
    expect(hasBoards([issue(), issue([])])).toBe(false);
    expect(hasBoards([])).toBe(false);
  });

  it.each([
    "Resource not accessible by personal access token",
    "Your token has not been granted the required scopes to execute this query.",
    "The field requires one of the following scopes: ['read:project']",
    "Resource not accessible by integration",
  ])("recognizes Projects access errors: %s", (message) => {
    expect(isProjectsAccessError(message)).toBe(true);
  });

  it.each(["HTTP 503 Service Unavailable", "rate limit exceeded", "fetch failed", "Unknown field 'projectItems'"])("preserves unrelated errors: %s", (message) => {
    expect(isProjectsAccessError(message)).toBe(false);
  });
});
