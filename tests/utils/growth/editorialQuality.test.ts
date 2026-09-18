import { describe, expect, it } from "vitest";
import { canUseEditorialDraft, interventionSuggestionsIssue, parseEditorialReview, passesEditorialReview } from "../../../src/utils/growth/editorialQuality";

const good = { scores: { grounding: 5, specificity: 4, readerValue: 4, structure: 5 }, issues: [], blockingIssues: [] };

describe("editorial quality gate", () => {
  it("accepts strong grounded work without requiring a perfect score", () => {
    expect(passesEditorialReview(good)).toBe(true);
    expect(passesEditorialReview({ ...good, scores: { ...good.scores, grounding: 4 } })).toBe(true);
    expect(passesEditorialReview({ ...good, scores: { ...good.scores, readerValue: 3 } })).toBe(false);
    expect(passesEditorialReview({ ...good, issues: ["Unsupported performance claim"] })).toBe(false);
  });

  it("separates the ideal revision target from grounded content that is usable", () => {
    expect(canUseEditorialDraft({ ...good, scores: { grounding: 4, specificity: 3, readerValue: 3, structure: 3 }, issues: ["Use a stronger hook"] })).toBe(true);
    expect(canUseEditorialDraft({ ...good, blockingIssues: ["Unsupported benchmark"] })).toBe(false);
    expect(canUseEditorialDraft({ ...good, scores: { ...good.scores, grounding: 3 } })).toBe(false);
    expect(passesEditorialReview({ ...good, blockingIssues: ["Wrong language"] })).toBe(false);
  });

  it.each([null, {}, { scores: {}, issues: [] }, { ...good, issues: [""] },
    { ...good, blockingIssues: undefined }, { ...good, blockingIssues: [""] },
    { ...good, blockingIssues: Array(7).fill("issue") },
    { ...good, scores: { ...good.scores, grounding: "5" } },
    { ...good, scores: { ...good.scores, specificity: 4.5 } },
    { ...good, scores: { ...good.scores, readerValue: 6 } },
    { ...good, issues: Array(7).fill("issue") },
  ])("rejects malformed reviews: %j", (value) => {
    expect(parseEditorialReview(value)).toBeNull();
  });

  it("parses a valid review", () => expect(parseEditorialReview(good)).toEqual(good));

  it("rejects missing, duplicate and malformed action recommendations", () => {
    const suggestions = ["Document the protocol", "Explain isolation", "Test crash recovery"]
      .map((title) => ({ title, action: "Use the documented example and report the result.", category: "engineering" }));
    expect(interventionSuggestionsIssue({ suggestions })).toBeNull();
    expect(interventionSuggestionsIssue(null)).toBeTruthy();
    expect(interventionSuggestionsIssue({ suggestions: suggestions.slice(0, 1) })).toBeNull();
    expect(interventionSuggestionsIssue({ suggestions: [] })).toBeTruthy();
    expect(interventionSuggestionsIssue({ suggestions: [...suggestions, ...suggestions] })).toBeTruthy();
    expect(interventionSuggestionsIssue({ suggestions: [...suggestions.slice(0, 2), suggestions[0]] })).toContain("distinct");
    expect(interventionSuggestionsIssue({ suggestions: [...suggestions.slice(0, 2), {}] })).toBeTruthy();
  });
});
