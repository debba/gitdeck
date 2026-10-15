import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryPicker } from "../../../src/components/common/RepositoryPicker";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GhRepo } from "../../../src/types/github";

const repos: GhRepo[] = [
  {
    nameWithOwner: "acme/rocket",
    name: "rocket",
    owner: { login: "acme", avatarUrl: "" },
    description: "A fast repository",
    stargazerCount: 10,
    forkCount: 2,
    primaryLanguage: { name: "TypeScript" },
    updatedAt: "2026-09-04T00:00:00.000Z",
    pushedAt: "2026-09-04T00:00:00.000Z",
    visibility: "PUBLIC",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    url: "https://github.com/acme/rocket",
  },
  {
    nameWithOwner: "acme/orbit",
    name: "orbit",
    owner: { login: "acme", avatarUrl: "" },
    description: null,
    stargazerCount: 5,
    forkCount: 1,
    primaryLanguage: null,
    updatedAt: "2026-09-04T00:00:00.000Z",
    pushedAt: "2026-09-04T00:00:00.000Z",
    visibility: "PUBLIC",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    url: "https://github.com/acme/orbit",
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("RepositoryPicker", () => {
  it("keeps list options in the combobox arrow-key flow and closes only the open list on Escape", async () => {
    const escaped = vi.fn();
    window.addEventListener("keydown", escaped);

    await act(async () => {
      root.render(createElement(
        I18nProvider,
        null,
        createElement(RepositoryPicker, {
          repos,
          value: "",
          placeholder: "Choose",
          onChange: vi.fn(),
        }),
      ));
    });

    const input = container.querySelector<HTMLInputElement>("input[role=combobox]")!;
    await act(async () => input.focus());

    const options = [...container.querySelectorAll<HTMLButtonElement>("[role=option]")];
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.tabIndex === -1)).toBe(true);

    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("[role=listbox]")).toBeNull();
    expect(escaped).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);

    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(container.querySelector("[role=option].active")?.textContent).toContain("acme/rocket");

    window.removeEventListener("keydown", escaped);
  });
});
