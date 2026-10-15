import { describe, expect, it } from "vitest";
import {
  createGrowthCardInputFromForm,
  EMPTY_GROWTH_CARD_FORM,
  type GrowthCardFormFields,
} from "../../../src/utils/growth/cardForm";

function fields(overrides: Partial<GrowthCardFormFields>): GrowthCardFormFields {
  return {
    ...EMPTY_GROWTH_CARD_FORM,
    title: " Card title ",
    alt: " Card description ",
    ...overrides,
  };
}

describe("Growth card form input", () => {
  it("builds each template's shared card request", () => {
    expect(createGrowthCardInputFromForm("acme/repo", "release", fields({
      version: " v1 ",
      highlights: " First \n\n Second ",
    }))).toEqual({
      repository: "acme/repo",
      template: "release",
      title: "Card title",
      alt: "Card description",
      data: { version: "v1", highlights: ["First", "Second"] },
    });
    expect(createGrowthCardInputFromForm("acme/repo", "milestone", fields({
      milestoneValue: "10000",
      milestoneLabel: " Stars ",
      milestoneDetail: " Community powered ",
    }))?.data).toEqual({ value: 10000, label: "Stars", detail: "Community powered" });
    expect(createGrowthCardInputFromForm("acme/repo", "stats", fields({
      stats: "Stars: 5120\nAverage response: 2.5",
    }))?.data).toEqual({
      stats: [{ label: "Stars", value: 5120 }, { label: "Average response", value: 2.5 }],
    });
    expect(createGrowthCardInputFromForm("acme/repo", "quote", fields({
      quote: " Useful ",
      attribution: " Alex ",
    }))?.data).toEqual({ quote: "Useful", attribution: "Alex" });
    expect(createGrowthCardInputFromForm("acme/repo", "whats-new", fields({
      whatsNewItems: "Calendar\nMedia library",
    }))?.data).toEqual({ items: ["Calendar", "Media library"] });
  });

  it("rejects missing common fields and malformed template values", () => {
    expect(createGrowthCardInputFromForm("acme/repo", "release", fields({ title: "", version: "v1", highlights: "One" })))
      .toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "release", fields({ version: "", highlights: "One" })))
      .toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "milestone", fields({
      milestoneValue: "1.5",
      milestoneLabel: "Stars",
      milestoneDetail: "Growing",
    }))).toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "stats", fields({ stats: "Stars many" }))).toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "quote", fields({ quote: "Quote" }))).toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "whats-new", fields({ whatsNewItems: "" }))).toBeNull();
  });

  it("enforces form-level array and numeric bounds", () => {
    expect(createGrowthCardInputFromForm("acme/repo", "release", fields({
      version: "v1",
      highlights: "One\nTwo\nThree\nFour\nFive",
    }))).toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "milestone", fields({
      milestoneValue: "1000000000",
      milestoneLabel: "Stars",
      milestoneDetail: "Growing",
    }))).toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "stats", fields({ stats: "Stars: 1e20" }))).toBeNull();
    expect(createGrowthCardInputFromForm("acme/repo", "whats-new", fields({
      whatsNewItems: "One\nTwo\nThree\nFour\nFive\nSix",
    }))).toBeNull();
  });
});
