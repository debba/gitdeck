import { describe, expect, it } from "vitest";
import {
  GROWTH_CARD_HEIGHT,
  GROWTH_CARD_WIDTH,
  GrowthCardValidationError,
  normalizeGrowthCard,
  renderGrowthCard,
} from "../../src/server/growth/cards";
import type { GrowthCardDataByTemplate, GrowthCardTemplate } from "../../src/types/growth";

const cases: Array<[GrowthCardTemplate, GrowthCardDataByTemplate[GrowthCardTemplate], string]> = [
  ["release", { version: "v2.4.0", highlights: ["Faster planning", "Safer previews"] }, "Version v2.4.0"],
  ["milestone", { value: 10_000, label: "GitHub stars", detail: "Thank you to every contributor." }, "10000"],
  ["stats", { stats: [{ label: "Stars", value: 5120 }, { label: "Forks", value: 340 }] }, "Project stats"],
  ["quote", { quote: "The workflow keeps our release notes focused.", attribution: "A maintainer" }, "Community voice"],
  ["whats-new", { items: ["Editorial calendar", "Private media library"] }, "What&apos;s new"],
];

function render(template: GrowthCardTemplate, data: GrowthCardDataByTemplate[GrowthCardTemplate]) {
  return renderGrowthCard({
    repository: "acme/rocket",
    color: "#2563EB",
    template,
    title: "Rocket growth update",
    alt: "A card summarizing the Rocket project update",
    data,
  });
}

describe("generated Growth cards", () => {
  it.each(cases)("renders a deterministic, accessible %s card", (template, data, expected) => {
    const first = render(template, data);
    const second = render(template, data);

    expect(first).toBe(second);
    expect(first).toContain(`<svg xmlns="http://www.w3.org/2000/svg" width="${GROWTH_CARD_WIDTH}" height="${GROWTH_CARD_HEIGHT}"`);
    expect(first).toContain('role="img" aria-labelledby="card-title card-description"');
    expect(first).toContain('<title id="card-title">Rocket growth update</title>');
    expect(first).toContain('<desc id="card-description">A card summarizing the Rocket project update</desc>');
    expect(first).toContain("acme/rocket");
    expect(first).toContain("#2563EB");
    expect(first).toContain(expected);
    expect(first).not.toContain("<script");
    expect(first).not.toContain("<image");
    expect(first).not.toContain("@font-face");
  });

  it("XML-escapes every user-controlled card value", () => {
    const attack = `<script>alert("x")</script> & 'quoted'`;
    const svg = renderGrowthCard({
      repository: "acme/rocket",
      color: "#BE123C",
      template: "release",
      title: attack,
      alt: `Description ${attack}`,
      data: { version: attack, highlights: [attack] },
    });

    expect(svg).not.toContain(attack);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;quoted&apos;");
  });

  it("normalizes all template shapes and rejects unknown fields", () => {
    expect(normalizeGrowthCard("release", { version: " v1 ", highlights: [" Shipped "] })).toEqual({
      template: "release",
      data: { version: "v1", highlights: ["Shipped"] },
    });
    expect(normalizeGrowthCard("milestone", { value: 100, label: " Stars ", detail: " Growing " }).data)
      .toEqual({ value: 100, label: "Stars", detail: "Growing" });
    expect(normalizeGrowthCard("stats", { stats: [{ label: "Stars", value: 1.5 }] }).data)
      .toEqual({ stats: [{ label: "Stars", value: 1.5 }] });
    expect(normalizeGrowthCard("quote", { quote: "Useful", attribution: "Alex" }).data)
      .toEqual({ quote: "Useful", attribution: "Alex" });
    expect(normalizeGrowthCard("whats-new", { items: ["One"] }).data).toEqual({ items: ["One"] });

    expect(() => normalizeGrowthCard("release", { version: "v1", highlights: ["One"], script: "x" }))
      .toThrow(GrowthCardValidationError);
    expect(() => normalizeGrowthCard("unknown", {})).toThrow("invalid card template");
  });

  it("enforces text, array, and numeric bounds", () => {
    const invalid: Array<[unknown, unknown]> = [
      ["release", { version: "v1", highlights: [] }],
      ["release", { version: "v1", highlights: ["x".repeat(121)] }],
      ["release", { version: "x".repeat(81), highlights: ["One"] }],
      ["milestone", { value: -1, label: "Stars", detail: "Growing" }],
      ["milestone", { value: 1.5, label: "Stars", detail: "Growing" }],
      ["stats", { stats: Array.from({ length: 5 }, (_, index) => ({ label: `S${index}`, value: index })) }],
      ["stats", { stats: [{ label: "Stars", value: Number.POSITIVE_INFINITY }] }],
      ["quote", { quote: "x".repeat(281), attribution: "Alex" }],
      ["whats-new", { items: ["One", "Two", "Three", "Four", "Five", "Six"] }],
      ["whats-new", { items: ["unsafe\nline"] }],
    ];

    for (const [template, data] of invalid) {
      expect(() => normalizeGrowthCard(template, data), JSON.stringify(template)).toThrow(GrowthCardValidationError);
    }
  });

  it("rejects malformed rendering metadata before producing SVG", () => {
    const invalid = [
      { repository: "invalid", color: "#2563EB", template: "quote", title: "Title", alt: "Alt", data: { quote: "Q", attribution: "A" } },
      { repository: "acme/repo", color: "red", template: "quote", title: "Title", alt: "Alt", data: { quote: "Q", attribution: "A" } },
      { repository: "acme/repo", color: "#2563EB", template: "quote", title: "", alt: "Alt", data: { quote: "Q", attribution: "A" } },
      { repository: "acme/repo", color: "#2563EB", template: "quote", title: "Title", alt: "Alt", data: { quote: "Q" } },
    ];
    for (const input of invalid) {
      expect(() => renderGrowthCard(input)).toThrow(GrowthCardValidationError);
    }
  });
});
