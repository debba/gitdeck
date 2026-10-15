import { describe, expect, it } from "vitest";
import type { GrowthContentItem } from "../../../src/types/growth";
import {
  buildEvergreenIdeaInput,
  contentIdFromEvergreenRuleKey,
  createEvergreenRuleKey,
  isEvergreenContentEligible,
} from "../../../src/utils/growth/evergreen";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const DAY_MS = 86_400_000;

function content(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: "plan-1",
    interventionId: null,
    goalIds: ["goal-1"],
    channel: "x",
    format: "x-thread",
    pillar: "education",
    angle: "Original angle",
    title: "Original title",
    summary: "Original summary",
    body: "Original body",
    threadPosts: ["Original post"],
    media: [{ kind: "image", url: "https://example.com/card.png", alt: "Card" }],
    sources: ["https://example.com/guide"],
    status: "published",
    scheduledFor: "2026-07-12T12:00:00.000Z",
    publishedAt: new Date(NOW.getTime() - 60 * DAY_MS).toISOString(),
    publishedUrl: "https://social.example/post",
    generatedAt: "2026-07-11T12:00:00.000Z",
    generationVersion: 7,
    evergreen: 1,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    ...overrides,
  };
}

describe("evergreen recycling", () => {
  it("uses a stable reversible identity and rejects malformed keys", () => {
    expect(createEvergreenRuleKey(" content-1 ")).toBe("evergreen:content-1");
    expect(contentIdFromEvergreenRuleKey("evergreen:content-1")).toBe("content-1");
    expect(createEvergreenRuleKey("")).toBeNull();
    expect(createEvergreenRuleKey("content:1")).toBeNull();
    expect(contentIdFromEvergreenRuleKey("release:content-1")).toBeNull();
    expect(contentIdFromEvergreenRuleKey("evergreen: content-1")).toBeNull();
  });

  it("qualifies only published evergreen content at least sixty days old", () => {
    expect(isEvergreenContentEligible(content(), NOW)).toBe(true);
    expect(isEvergreenContentEligible(content({
      publishedAt: new Date(NOW.getTime() - 60 * DAY_MS + 1).toISOString(),
    }), NOW)).toBe(false);
    expect(isEvergreenContentEligible(content({ status: "ready" }), NOW)).toBe(false);
    expect(isEvergreenContentEligible(content({ evergreen: 0 }), NOW)).toBe(false);
    expect(isEvergreenContentEligible(content({ publishedAt: "2026-02-30T00:00:00.000Z" }), NOW)).toBe(false);
    expect(isEvergreenContentEligible(content(), new Date("invalid"))).toBe(false);
  });

  it("carries identity and evidence while clearing every draft and publication field", () => {
    const source = content();
    const clone = buildEvergreenIdeaInput(source, "intervention-1");

    expect(clone).toEqual({
      accountId: "account-a",
      repository: "acme/rocket",
      planId: null,
      interventionId: "intervention-1",
      goalIds: ["goal-1"],
      channel: "x",
      format: "x-thread",
      pillar: "education",
      angle: "",
      title: "",
      summary: "",
      body: "",
      threadPosts: [],
      media: [],
      sources: ["https://example.com/guide"],
      status: "idea",
      scheduledFor: null,
      publishedAt: null,
      publishedUrl: null,
      generatedAt: null,
      generationVersion: 1,
      evergreen: 0,
    });
    expect(source).toEqual(content());
    expect(clone.goalIds).not.toBe(source.goalIds);
    expect(clone.sources).not.toBe(source.sources);
  });
});
