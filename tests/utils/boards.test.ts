import { describe, expect, it } from "vitest";
import { hasBoards, openBoardNames } from "../../src/utils/boards";
import type { GhIssue } from "../../src/types/github";

function issue(boards?: string[]): GhIssue {
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

describe("board utilities", () => {
  it("names open boards by owner and title", () => {
    const names = openBoardNames([
      { project: { title: "Roadmap", closed: false, owner: { login: "acme" } } },
      { project: { title: "Triage", closed: false, owner: { login: "alice" } } },
    ]);

    expect(names).toEqual(["acme/Roadmap", "alice/Triage"]);
  });

  it("skips closed, hidden and duplicate boards", () => {
    const names = openBoardNames([
      { project: { title: "Roadmap", closed: false, owner: { login: "acme" } } },
      { project: { title: "Roadmap", closed: false, owner: { login: "acme" } } },
      { project: { title: "Archive", closed: true, owner: { login: "acme" } } },
      { project: null },
      null,
    ]);

    expect(names).toEqual(["acme/Roadmap"]);
  });

  it("falls back to the title when the owner is unknown", () => {
    expect(openBoardNames([{ project: { title: "Roadmap", closed: false, owner: null } }])).toEqual(["Roadmap"]);
  });

  it("returns no boards when project items are missing", () => {
    expect(openBoardNames(undefined)).toEqual([]);
    expect(openBoardNames(null)).toEqual([]);
  });

  it("detects whether any issue sits on a board", () => {
    expect(hasBoards([issue(), issue(["acme/Roadmap"])])).toBe(true);
    expect(hasBoards([issue(), issue([])])).toBe(false);
    expect(hasBoards([])).toBe(false);
  });
});
