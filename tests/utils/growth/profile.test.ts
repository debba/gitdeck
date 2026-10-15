import { describe, expect, it } from "vitest";
import {
  createGrowthPillarId,
  GrowthProfileValidationError,
  normalizeGrowthProfileInput,
} from "../../../src/utils/growth/profile";

function validProfile() {
  return {
    language: " en ",
    voice: " Direct ",
    audience: " Maintainers ",
    channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
    cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
    pillars: [{ id: "Product-Value", label: " Product value ", weight: 100, description: " Outcomes " }],
    hashtags: [" #OpenSource ", "#opensource", ""],
    avoid: " Hype ",
    timezone: "Europe/Rome",
    postingWindows: [{ weekday: 1, hour: 10 }],
    color: "#2563eb",
  };
}

describe("Growth profile utilities", () => {
  it("creates a unique stable slug for a new pillar", () => {
    expect(createGrowthPillarId([
      { id: "pillar-2", label: "One", weight: 50, description: "" },
      { id: "pillar-3", label: "Two", weight: 50, description: "" },
    ])).toBe("pillar-4");
  });

  describe("normalizeGrowthProfileInput", () => {
    it("normalizes a complete profile and deduplicates hashtags", () => {
      expect(normalizeGrowthProfileInput(validProfile())).toEqual({
        language: "en",
        voice: "Direct",
        audience: "Maintainers",
        channels: { x: true, linkedin: true, mastodon: true, bluesky: false, discussion: false, blog: false },
        cadence: { x: 3, linkedin: 1, mastodon: 3, bluesky: 0, discussion: 0, blog: 0 },
        pillars: [{ id: "product-value", label: "Product value", weight: 100, description: "Outcomes" }],
        hashtags: ["#OpenSource"],
        avoid: "Hype",
        timezone: "Europe/Rome",
        postingWindows: [{ weekday: 1, hour: 10 }],
        color: "#2563EB",
      });
    });

    it.each([
      [{ ...validProfile(), unknown: true }, "complete document"],
      [{ ...validProfile(), timezone: "Mars/Olympus" }, "IANA timezone"],
      [{ ...validProfile(), cadence: { ...validProfile().cadence, x: 15 } }, "0 through 14"],
      [{ ...validProfile(), channels: { ...validProfile().channels, unknown: true } }, "supported channel"],
      [{ ...validProfile(), postingWindows: [{ weekday: 0, hour: 10 }] }, "1 through 7"],
      [{ ...validProfile(), pillars: [{ id: "same", label: "One", weight: 101, description: "" }] }, "0 through 100"],
      [{ ...validProfile(), pillars: [{ id: "same", label: "One", weight: 0, description: "" }] }, "positive weight"],
      [{ ...validProfile(), color: "blue" }, "#RRGGBB"],
    ])("rejects invalid profile documents", (input, message) => {
      expect(() => normalizeGrowthProfileInput(input)).toThrow(GrowthProfileValidationError);
      expect(() => normalizeGrowthProfileInput(input)).toThrow(message);
    });
  });
});
