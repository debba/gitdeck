import { describe, expect, it } from "vitest";
import {
  createDefaultGrowthProfile,
  DEFAULT_GROWTH_CADENCE,
  DEFAULT_GROWTH_CHANNELS,
  DEFAULT_GROWTH_PILLARS,
  growthProfileColor,
} from "../../../src/utils/growth/profileDefaults";

describe("Growth profile defaults", () => {
  it("provides complete independent profile defaults", () => {
    const first = createDefaultGrowthProfile("account-a", "owner/repo");
    const second = createDefaultGrowthProfile("account-b", "owner/repo");

    expect(first.channels).toEqual(DEFAULT_GROWTH_CHANNELS);
    expect(first.cadence).toEqual(DEFAULT_GROWTH_CADENCE);
    expect(first.pillars).toEqual(DEFAULT_GROWTH_PILLARS);
    expect(first.pillars).not.toBe(second.pillars);
    expect(first.channels).not.toBe(second.channels);
    expect(first.pillars.every(({ weight }) => weight === 20)).toBe(true);
    expect(first.updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("applies Growth settings without changing repository-specific defaults or sharing values", () => {
    const settings = {
      timezone: "Europe/Rome",
      cadence: { ...DEFAULT_GROWTH_CADENCE, x: 5, linkedin: 2 },
      pillars: [{ id: "launches", label: "Launches", weight: 100, description: "New work" }],
    };
    const profile = createDefaultGrowthProfile("account-a", "owner/repo", settings);

    expect(profile).toMatchObject({
      accountId: "account-a",
      repository: "owner/repo",
      timezone: "Europe/Rome",
      cadence: { x: 5, linkedin: 2 },
      pillars: settings.pillars,
      language: "en",
      voice: "",
      audience: "",
      hashtags: [],
      avoid: "",
      postingWindows: [],
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(profile.channels).toEqual(DEFAULT_GROWTH_CHANNELS);
    expect(profile.color).toBe(growthProfileColor("owner/repo"));
    expect(profile.cadence).not.toBe(settings.cadence);
    expect(profile.pillars).not.toBe(settings.pillars);
    expect(profile.pillars[0]).not.toBe(settings.pillars[0]);

    profile.cadence.x = 0;
    profile.pillars[0].label = "Changed";
    expect(settings.cadence.x).toBe(5);
    expect(settings.pillars[0].label).toBe("Launches");
  });

  it("assigns a stable palette color from repository identity", () => {
    const color = growthProfileColor("owner/repo");
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
    expect(growthProfileColor("owner/repo")).toBe(color);
    expect(createDefaultGrowthProfile("account-a", "owner/repo").color).toBe(color);
  });
});
