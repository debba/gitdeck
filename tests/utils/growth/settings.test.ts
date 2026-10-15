import { describe, expect, it } from "vitest";
import {
  createDefaultGrowthSettings,
  GrowthSettingsValidationError,
  normalizeGrowthSettings,
} from "../../../src/utils/growth/settings";
import {
  DEFAULT_GROWTH_CADENCE,
  DEFAULT_GROWTH_PILLARS,
} from "../../../src/utils/growth/profileDefaults";

function validSettings() {
  return {
    timezone: " Europe/Rome ",
    cadence: {
      x: 3,
      linkedin: 1,
      mastodon: 3,
      bluesky: 0,
      discussion: 0,
      blog: 0,
    },
    pillars: [
      { id: "Product-Value", label: " Product value ", weight: 70, description: " Outcomes " },
      { id: "community", label: " Community ", weight: 30, description: "" },
    ],
  };
}

describe("Growth settings utilities", () => {
  it("creates complete defensive copies of the built-in defaults", () => {
    const first = createDefaultGrowthSettings();
    const second = createDefaultGrowthSettings();

    expect(first).toEqual({
      timezone: "UTC",
      cadence: DEFAULT_GROWTH_CADENCE,
      pillars: DEFAULT_GROWTH_PILLARS,
    });
    expect(first.cadence).not.toBe(second.cadence);
    expect(first.pillars).not.toBe(second.pillars);
    expect(first.pillars[0]).not.toBe(second.pillars[0]);

    first.cadence.x = 0;
    first.pillars[0].label = "Changed";
    expect(second.cadence.x).toBe(3);
    expect(second.pillars[0].label).toBe("Product value");
  });

  it("normalizes an exact complete document using profile constraints", () => {
    expect(normalizeGrowthSettings(validSettings())).toEqual({
      timezone: "Europe/Rome",
      cadence: validSettings().cadence,
      pillars: [
        { id: "product-value", label: "Product value", weight: 70, description: "Outcomes" },
        { id: "community", label: "Community", weight: 30, description: "" },
      ],
    });
  });

  it("accepts inclusive cadence and pillar weight boundaries", () => {
    expect(normalizeGrowthSettings({
      ...validSettings(),
      cadence: { ...validSettings().cadence, x: 14, linkedin: 0 },
      pillars: [
        { id: "zero", label: "Zero", weight: 0, description: "" },
        { id: "full", label: "Full", weight: 100, description: "" },
      ],
    })).toMatchObject({
      cadence: { x: 14, linkedin: 0 },
      pillars: [{ weight: 0 }, { weight: 100 }],
    });
  });

  it.each([
    [null, "complete document"],
    [[], "complete document"],
    [{ cadence: validSettings().cadence, pillars: validSettings().pillars }, "complete document"],
    [{ ...validSettings(), unknown: true }, "complete document"],
    [{ ...validSettings(), timezone: "" }, "must not be empty"],
    [{ ...validSettings(), timezone: "Mars/Olympus" }, "IANA timezone"],
    [{ ...validSettings(), cadence: { ...validSettings().cadence, blog: undefined } }, "integer"],
    [{ ...validSettings(), cadence: { ...validSettings().cadence, x: -1 } }, "0 through 14"],
    [{ ...validSettings(), cadence: { ...validSettings().cadence, x: 15 } }, "0 through 14"],
    [{ ...validSettings(), cadence: { ...validSettings().cadence, x: 1.5 } }, "integer"],
    [{ ...validSettings(), cadence: { ...validSettings().cadence, other: 1 } }, "supported channel"],
    [{ ...validSettings(), pillars: [] }, "at least one pillar"],
    [{ ...validSettings(), pillars: [{ id: "", label: "One", weight: 100, description: "" }] }, "must not be empty"],
    [{ ...validSettings(), pillars: [{ id: "not a slug", label: "One", weight: 100, description: "" }] }, "slugs"],
    [{ ...validSettings(), pillars: [
      { id: "same", label: "One", weight: 50, description: "" },
      { id: "SAME", label: "Two", weight: 50, description: "" },
    ] }, "unique"],
    [{ ...validSettings(), pillars: [{ id: "one", label: "One", weight: -1, description: "" }] }, "0 through 100"],
    [{ ...validSettings(), pillars: [{ id: "one", label: "One", weight: 101, description: "" }] }, "0 through 100"],
    [{ ...validSettings(), pillars: [{ id: "one", label: "One", weight: 1.5, description: "" }] }, "integer"],
    [{ ...validSettings(), pillars: [{ id: "one", label: "One", weight: 0, description: "" }] }, "positive weight"],
    [{ ...validSettings(), pillars: [{ id: "one", label: " ", weight: 100, description: "" }] }, "must not be empty"],
    [{ ...validSettings(), pillars: [{ id: "one", label: "One", weight: 100, description: 42 }] }, "must be a string"],
    [{ ...validSettings(), pillars: [{ id: "one", label: "One", weight: 100, description: "", extra: true }] }, "invalid"],
  ])("rejects invalid settings documents", (input, message) => {
    expect(() => normalizeGrowthSettings(input)).toThrow(GrowthSettingsValidationError);
    expect(() => normalizeGrowthSettings(input)).toThrow(message);
  });
});
