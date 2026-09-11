import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthMediaPicker } from "../../../src/components/growth/GrowthMediaPicker";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthAssetMetadata, GrowthContentMedia } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthAssetFileUrl: vi.fn((id: string) => `/api/growth/assets/${id}/file`),
  fetchGrowthAssets: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthAssetFileUrl: mocks.buildGrowthAssetFileUrl,
  fetchGrowthAssets: mocks.fetchGrowthAssets,
}));

function asset(overrides: Partial<GrowthAssetMetadata> = {}): GrowthAssetMetadata {
  return {
    id: "asset-1",
    accountId: "account-a",
    repository: "acme/repo",
    kind: "image",
    origin: "upload",
    url: null,
    title: "Release card",
    alt: "Release dashboard",
    width: 1200,
    height: 630,
    cardTemplate: null,
    cardData: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let container: HTMLDivElement;
let root: Root;
let onChange: (media: GrowthContentMedia[]) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onChange = vi.fn(async () => undefined);
  mocks.fetchGrowthAssets.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPicker(options: {
  accountId?: string;
  repository?: string;
  media?: GrowthContentMedia[];
  status?: "draft" | "ready";
} = {}) {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(GrowthMediaPicker, {
        accountId: options.accountId ?? "account-a",
        repository: options.repository ?? "acme/repo",
        media: options.media ?? [],
        status: options.status ?? "draft",
        onChange,
      }),
    ));
    await flush();
  });
}

describe("GrowthMediaPicker", () => {
  it("renders localized loading, empty, error, selected, and no-media states", async () => {
    let resolveAssets: ((value: GrowthAssetMetadata[]) => void) | undefined;
    mocks.fetchGrowthAssets.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAssets = resolve;
    }));
    await renderPicker();
    expect(container.textContent).toContain("Loading repository media");
    expect(container.textContent).toContain("No media selected yet");

    await act(async () => {
      resolveAssets?.([]);
      await flush();
    });
    expect(container.textContent).toContain("library has no assets");

    mocks.fetchGrowthAssets.mockRejectedValueOnce(new Error("library unavailable"));
    await renderPicker({ accountId: "account-b" });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("library unavailable");

    mocks.fetchGrowthAssets.mockResolvedValueOnce([asset()]);
    await renderPicker({
      accountId: "account-c",
      media: [{ assetId: "asset-1", kind: "image", alt: "Selected release" }],
    });
    expect(container.textContent).toContain("Selected release");
    expect(container.textContent).toContain("Selected");
    expect(button("Selected").disabled).toBe(true);
  });

  it("attaches edited metadata, deduplicates selected assets, and uses private previews", async () => {
    mocks.fetchGrowthAssets.mockResolvedValueOnce([
      asset(),
      asset({ id: "video-1", kind: "video", title: "Demo video", alt: "Demo walkthrough" }),
    ]);
    await renderPicker({ media: [{ assetId: "asset-1", kind: "image", alt: "Already selected" }] });

    expect(container.querySelector<HTMLImageElement>('img[alt="Release dashboard"]')?.src)
      .toContain("/api/growth/assets/asset-1/file");
    expect(container.querySelector<HTMLVideoElement>("video")?.src)
      .toContain("/api/growth/assets/video-1/file");
    expect([...container.querySelectorAll("button")].filter((entry) => entry.textContent === "Selected")).toHaveLength(1);

    const videoAlt = container.querySelector<HTMLInputElement>("#growth-content-asset-alt-1");
    const videoCaption = container.querySelector<HTMLInputElement>("#growth-content-asset-caption-1");
    if (!videoAlt || !videoCaption) throw new Error("Missing asset metadata fields");
    await act(async () => {
      setValue(videoAlt, "  Updated demo alt  ");
      setValue(videoCaption, "  Watch the workflow  ");
      button("Attach media").click();
      await flush();
    });

    expect(onChange).toHaveBeenCalledWith([
      { assetId: "asset-1", kind: "image", alt: "Already selected" },
      { assetId: "video-1", kind: "video", alt: "Updated demo alt", caption: "Watch the workflow" },
    ]);
  });

  it("persists edits and removal without optimistic changes, and protects final ready media", async () => {
    const legacy: GrowthContentMedia = {
      kind: "image",
      url: "https://example.com/legacy.png",
      alt: "Legacy media",
    };
    onChange = vi.fn(async () => {
      throw new Error("server rejected media");
    });
    await renderPicker({ media: [legacy] });
    const alt = container.querySelector<HTMLInputElement>("#growth-content-media-alt-0");
    if (!alt) throw new Error("Missing selected alt field");
    await act(async () => {
      setValue(alt, "Edited legacy alt");
      button("Save media details").click();
      await flush();
    });
    expect(onChange).toHaveBeenCalledWith([{ ...legacy, alt: "Edited legacy alt" }]);
    expect(container.textContent).toContain("server rejected media");
    expect(container.textContent).toContain("Legacy media");

    await act(async () => {
      button("Remove media").click();
      await flush();
    });
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(container.textContent).toContain("Legacy media");

    onChange = vi.fn(async () => undefined);
    await renderPicker({ media: [legacy], status: "ready" });
    expect(button("Remove media").disabled).toBe(true);
    expect(button("Remove media").title).toContain("must keep at least one media");
  });

  it.each([1440, 390])("keeps labeled media controls keyboard reachable at %ipx", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    mocks.fetchGrowthAssets.mockResolvedValueOnce([asset()]);
    await renderPicker({ media: [{ kind: "image", url: "https://example.com/legacy.png", alt: "Legacy" }] });

    for (const id of [
      "growth-content-media-alt-0",
      "growth-content-media-caption-0",
      "growth-content-asset-alt-0",
      "growth-content-asset-caption-0",
    ]) {
      expect(container.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
    for (const label of ["Save media details", "Remove media", "Attach media"]) {
      expect(button(label).getAttribute("type")).toBe("button");
    }
  });

  it("aborts stale asset loads when account or repository identity changes and on close", async () => {
    let resolveFirst: ((value: GrowthAssetMetadata[]) => void) | undefined;
    mocks.fetchGrowthAssets
      .mockImplementationOnce((_repository, signal: AbortSignal) => new Promise((resolve) => {
        resolveFirst = resolve;
        expect(signal.aborted).toBe(false);
      }))
      .mockResolvedValueOnce([asset({ id: "account-b", accountId: "account-b", title: "Account B asset" })])
      .mockResolvedValueOnce([asset({ id: "other-repo", accountId: "account-b", repository: "acme/other", title: "Other asset" })]);

    await renderPicker();
    const firstSignal = mocks.fetchGrowthAssets.mock.calls[0][1] as AbortSignal;
    await renderPicker({ accountId: "account-b" });
    expect(firstSignal.aborted).toBe(true);
    expect(container.textContent).toContain("Account B asset");

    const secondSignal = mocks.fetchGrowthAssets.mock.calls[1][1] as AbortSignal;
    await renderPicker({ accountId: "account-b", repository: "acme/other" });
    expect(secondSignal.aborted).toBe(true);
    expect(container.textContent).toContain("Other asset");

    await act(async () => root.unmount());
    const finalSignal = mocks.fetchGrowthAssets.mock.calls[2][1] as AbortSignal;
    expect(finalSignal.aborted).toBe(true);
    await act(async () => {
      resolveFirst?.([asset({ title: "Stale asset" })]);
      await flush();
    });
    root = createRoot(container);
  });
});
