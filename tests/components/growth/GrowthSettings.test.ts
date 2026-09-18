import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthSettings } from "../../../src/components/growth/GrowthSettings";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthSettings as GrowthSettingsData } from "../../../src/types/growth";
import { createDefaultGrowthSettings } from "../../../src/utils/growth/settings";

const mocks = vi.hoisted(() => ({
  fetchGrowthSettings: vi.fn(),
  resetGrowthSettings: vi.fn(),
  updateGrowthSettings: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  fetchGrowthSettings: mocks.fetchGrowthSettings,
  resetGrowthSettings: mocks.resetGrowthSettings,
  updateGrowthSettings: mocks.updateGrowthSettings,
}));

function settings(overrides: Partial<GrowthSettingsData> = {}): GrowthSettingsData {
  return {
    timezone: "Europe/Rome",
    cadence: { x: 4, linkedin: 2, mastodon: 1, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [
      { id: "product", label: "Product", weight: 70, description: "Product outcomes" },
      { id: "community", label: "Community", weight: 30, description: "Participation" },
    ],
    ...overrides,
  };
}

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function inputFor(label: string, index = 0): HTMLInputElement {
  const fields = [...document.querySelectorAll("label")]
    .filter((entry) => entry.textContent?.startsWith(label));
  const input = fields[index]?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`Input not found: ${label} at ${index}`);
  return input;
}

function buttonFor(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent?.trim() === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
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
  mocks.fetchGrowthSettings.mockResolvedValue(settings());
  mocks.updateGrowthSettings.mockImplementation(async (input: GrowthSettingsData) => settings(input));
  mocks.resetGrowthSettings.mockResolvedValue(createDefaultGrowthSettings());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete document.documentElement.dataset.theme;
});

async function renderSettings(accountId = "account-a") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(GrowthSettings, { accountId, enabled: true }),
    ));
    await flush();
  });
}

describe("GrowthSettings", () => {
  it("shows loading and renders account-wide timezone, cadence, pillars, and the AI link", async () => {
    let resolveLoad: ((value: GrowthSettingsData) => void) | undefined;
    mocks.fetchGrowthSettings.mockImplementation(() => new Promise<GrowthSettingsData>((resolve) => {
      resolveLoad = resolve;
    }));

    await renderSettings();
    expect(container.textContent).toContain("Loading Growth settings");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      resolveLoad?.(settings());
      await flush();
    });

    expect(mocks.fetchGrowthSettings).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(container.textContent).toContain("Planning defaults");
    expect(container.textContent).toContain("Default cadence");
    expect(container.textContent).toContain("Default content pillars");
    expect(inputFor("IANA timezone").value).toBe("Europe/Rome");
    const aiLink = container.querySelector<HTMLAnchorElement>('a[href="/preferences#preferences-ai"]');
    expect(aiLink?.target).toBe("_blank");
    expect(aiLink?.rel).toContain("noopener");
  });

  it("supports keyboard-focused editing plus add and remove pillar controls", async () => {
    await renderSettings();
    const timezone = inputFor("IANA timezone");
    timezone.focus();
    expect(document.activeElement).toBe(timezone);

    await act(async () => {
      setValue(timezone, "America/New_York");
      buttonFor("Add pillar").click();
    });
    expect(container.querySelectorAll(".growth-library-pillar")).toHaveLength(3);
    expect(inputFor("ID", 2).value).toBe("pillar-3");

    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove pillar Community"]');
    remove?.focus();
    expect(document.activeElement).toBe(remove);
    await act(async () => remove?.click());
    expect(container.querySelectorAll(".growth-library-pillar")).toHaveLength(2);
    expect(inputFor("IANA timezone").value).toBe("America/New_York");
    expect([...container.querySelectorAll<HTMLInputElement>("input")].every((input) => input.tabIndex === 0)).toBe(true);
  });

  it.each([
    ["IANA timezone", "Mars/Olympus", "valid IANA timezone"],
    ["Weight", "101", "0 through 100"],
  ])("rejects invalid %s values before saving", async (label, value, message) => {
    await renderSettings();
    await act(async () => {
      setValue(inputFor(label), value);
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(mocks.updateGrowthSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it("normalizes saves, disables duplicate actions, and reports completion", async () => {
    let resolveSave: ((value: GrowthSettingsData) => void) | undefined;
    mocks.updateGrowthSettings.mockImplementation(() => new Promise<GrowthSettingsData>((resolve) => {
      resolveSave = resolve;
    }));
    await renderSettings();

    await act(async () => {
      setValue(inputFor("IANA timezone"), " America/New_York ");
      setValue(inputFor("Label"), " Product outcomes ");
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(mocks.updateGrowthSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: "America/New_York",
        pillars: expect.arrayContaining([expect.objectContaining({ label: "Product outcomes" })]),
      }),
      expect.any(AbortSignal),
    );
    expect(buttonFor("Saving…").disabled).toBe(true);
    expect(buttonFor("Reset defaults").disabled).toBe(true);

    await act(async () => {
      resolveSave?.(settings({ timezone: "America/New_York" }));
      await flush();
    });
    expect(container.textContent).toContain("Defaults saved.");
    expect(inputFor("IANA timezone").value).toBe("America/New_York");
  });

  it("requires reset confirmation and applies the server-returned built-in defaults", async () => {
    await renderSettings();
    await act(async () => buttonFor("Reset defaults").click());
    expect(mocks.resetGrowthSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Reset to built-in defaults?");
    expect(document.activeElement).toBe(buttonFor("Cancel"));

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(buttonFor("Reset defaults"));

    await act(async () => buttonFor("Reset defaults").click());
    await act(async () => {
      buttonFor("Confirm reset").click();
      await flush();
    });
    expect(mocks.resetGrowthSettings).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(inputFor("IANA timezone").value).toBe("UTC");
    expect(container.textContent).toContain("Built-in defaults restored.");
  });

  it("clears state and aborts stale reads and writes when the account changes", async () => {
    let resolveFirstLoad: ((value: GrowthSettingsData) => void) | undefined;
    let resolveSave: ((value: GrowthSettingsData) => void) | undefined;
    mocks.fetchGrowthSettings
      .mockImplementationOnce((_signal: AbortSignal) => new Promise<GrowthSettingsData>((resolve) => {
        resolveFirstLoad = resolve;
      }))
      .mockResolvedValueOnce(settings({ timezone: "Asia/Tokyo" }))
      .mockResolvedValueOnce(settings({ timezone: "America/Chicago" }));

    await renderSettings("account-a");
    const firstLoadSignal = mocks.fetchGrowthSettings.mock.calls[0][0] as AbortSignal;
    await renderSettings("account-b");
    expect(firstLoadSignal.aborted).toBe(true);
    expect(inputFor("IANA timezone").value).toBe("Asia/Tokyo");

    await act(async () => {
      resolveFirstLoad?.(settings({ timezone: "Europe/London" }));
      await flush();
    });
    expect(inputFor("IANA timezone").value).toBe("Asia/Tokyo");

    mocks.updateGrowthSettings.mockImplementationOnce((_input: GrowthSettingsData, _signal: AbortSignal) => (
      new Promise<GrowthSettingsData>((resolve) => { resolveSave = resolve; })
    ));
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    const saveSignal = mocks.updateGrowthSettings.mock.calls[0][1] as AbortSignal;
    await renderSettings("account-c");
    expect(saveSignal.aborted).toBe(true);
    expect(inputFor("IANA timezone").value).toBe("America/Chicago");

    await act(async () => {
      resolveSave?.(settings({ timezone: "Pacific/Auckland" }));
      await flush();
    });
    expect(inputFor("IANA timezone").value).toBe("America/Chicago");
  });

  it("renders request errors and keeps responsive, theme-independent structure", async () => {
    mocks.updateGrowthSettings.mockRejectedValue(new Error("settings unavailable"));
    await renderSettings();
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("settings unavailable");

    for (const theme of ["dark", "light"] as const) {
      document.documentElement.dataset.theme = theme;
      for (const width of [1440, 1024, 390]) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.dispatchEvent(new Event("resize"));
        expect(container.querySelector(".growth-settings.growth-library")).not.toBeNull();
        expect(container.querySelector(".growth-settings-fieldset")).not.toBeNull();
        expect(container.querySelector(".growth-settings-savebar")).not.toBeNull();
      }
    }
  });
});
