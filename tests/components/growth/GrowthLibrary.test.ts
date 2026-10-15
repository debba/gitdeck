import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthLibrary } from "../../../src/components/growth/GrowthLibrary";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthProfile } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthAssetFileUrl: vi.fn((id: string) => `/api/growth/assets/${id}/file`),
  fetchGrowthAssetImportCandidates: vi.fn(),
  fetchGrowthAssets: vi.fn(),
  importGrowthAsset: vi.fn(),
  fetchGrowthProfile: vi.fn(),
  updateGrowthProfile: vi.fn(),
  uploadGrowthAsset: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthAssetFileUrl: mocks.buildGrowthAssetFileUrl,
  fetchGrowthAssetImportCandidates: mocks.fetchGrowthAssetImportCandidates,
  fetchGrowthAssets: mocks.fetchGrowthAssets,
  importGrowthAsset: mocks.importGrowthAsset,
  fetchGrowthProfile: mocks.fetchGrowthProfile,
  updateGrowthProfile: mocks.updateGrowthProfile,
  uploadGrowthAsset: mocks.uploadGrowthAsset,
}));
vi.mock("../../../src/components/common/RepositoryContentSources", () => ({
  RepositoryContentSources: ({ repository }: { repository: string }) => createElement("button", null, `Sources for ${repository}`),
}));

function growthProfile(overrides: Partial<GrowthProfile> = {}): GrowthProfile {
  return {
    accountId: "account-a",
    repository: "acme/rocket",
    language: "en",
    voice: "Practical",
    audience: "Open-source maintainers",
    channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "product", label: "Product", weight: 100, description: "Outcomes" }],
    hashtags: ["#opensource"],
    avoid: "Hype",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 10 }],
    color: "#2563EB",
    updatedAt: "2026-09-04T08:00:00.000Z",
    ...overrides,
  };
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function inputFor(label: string): HTMLInputElement {
  const field = [...document.querySelectorAll("label")].find((entry) => entry.textContent?.startsWith(label));
  const input = field?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`Input not found: ${label}`);
  return input;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.fetchGrowthAssetImportCandidates.mockResolvedValue([]);
  mocks.fetchGrowthAssets.mockResolvedValue([]);
  mocks.fetchGrowthProfile.mockResolvedValue(growthProfile());
  mocks.updateGrowthProfile.mockImplementation(async (_repository, input) => growthProfile({
    ...input,
    updatedAt: "2026-09-04T09:00:00.000Z",
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderLibrary() {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(GrowthLibrary, {
        accountId: "account-a",
        enabled: true,
        repository: "acme/rocket",
        repos: [],
      }),
    ));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GrowthLibrary", () => {
  it("loads every profile section and hosts the repository source library", async () => {
    await renderLibrary();

    expect(mocks.fetchGrowthProfile).toHaveBeenCalledWith("acme/rocket", expect.any(AbortSignal));
    expect(container.textContent).toContain("Voice, sources, and editorial foundations");
    expect(container.textContent).toContain("Repository assets");
    expect(container.textContent).toContain("Channels");
    expect(container.textContent).toContain("Cadence");
    expect(container.textContent).toContain("Content pillars");
    expect(container.textContent).toContain("Posting windows");
    expect(container.textContent).toContain("Sources for acme/rocket");
    expect(inputFor("Language").value).toBe("en");
    expect(inputFor("IANA timezone").value).toBe("Europe/Rome");
  });

  it("normalizes and round-trips edited profile values", async () => {
    await renderLibrary();
    await act(async () => {
      setValue(inputFor("Voice"), "  Direct and grounded  ");
      setValue(inputFor("Hashtags"), " #OpenSource, #opensource, #GitDeck ");
      container.querySelector(".growth-library-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.updateGrowthProfile).toHaveBeenCalledWith("acme/rocket", expect.objectContaining({
      voice: "Direct and grounded",
      hashtags: ["#OpenSource", "#GitDeck"],
      timezone: "Europe/Rome",
      postingWindows: [{ weekday: 1, hour: 10 }],
    }));
    expect(container.textContent).toContain("Profile saved.");
    expect(inputFor("Voice").value).toBe("Direct and grounded");
  });

  it("reports invalid profile values before sending them to the server", async () => {
    await renderLibrary();
    await act(async () => {
      setValue(inputFor("IANA timezone"), "Mars/Olympus");
      container.querySelector(".growth-library-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.updateGrowthProfile).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("valid IANA timezone");
  });
});
