import { describe, expect, it } from "vitest";
import type { GrowthContentItem, GrowthMergedPullRequestSignal } from "../../../src/types/growth";
import {
  detectGrowthOpportunities,
  type DetectGrowthOpportunitiesInput,
} from "../../../src/utils/growth/opportunityRules";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const DAY = 86_400_000;

function content(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "content-1",
    accountId: "account-a",
    repository: "acme/rocket",
    planId: null,
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "",
    title: "Useful guide",
    summary: "",
    body: "",
    threadPosts: [],
    media: [{ kind: "image", url: "https://example.com/card.png", alt: "Card" }],
    sources: [],
    status: "published",
    scheduledFor: null,
    publishedAt: "2026-07-12T12:00:00.000Z",
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    ...overrides,
  };
}

function pullRequest(overrides: Partial<GrowthMergedPullRequestSignal> = {}): GrowthMergedPullRequestSignal {
  return {
    number: 42,
    title: "Ship the launch mode",
    url: "https://github.com/acme/rocket/pull/42",
    mergedAt: new Date(NOW.getTime() - DAY).toISOString(),
    additions: 300,
    deletions: 200,
    changedFiles: 10,
    ...overrides,
  };
}

function input(overrides: Partial<DetectGrowthOpportunitiesInput> = {}): DetectGrowthOpportunitiesInput {
  return {
    now: NOW,
    repository: "acme/rocket",
    stars: null,
    releases: [],
    openIssues: [],
    mergedPullRequests: [],
    goals: [],
    contentItems: [],
    ...overrides,
  };
}

function atAge(days: number, milliseconds = 0): string {
  return new Date(NOW.getTime() - days * DAY - milliseconds).toISOString();
}

describe("growth opportunity rules", () => {
  it("detects release follow-ups at the inclusive age boundaries and uses exact source matching", () => {
    const releases = [
      { tagName: "v3", url: "https://github.com/acme/rocket/releases/tag/v3", publishedAt: atAge(3) },
      { tagName: "v30", url: "https://github.com/acme/rocket/releases/tag/v30", publishedAt: atAge(30) },
      { tagName: "too-new", url: "https://example.com/new", publishedAt: atAge(3, -1) },
      { tagName: "too-old", url: "https://example.com/old", publishedAt: atAge(30, 1) },
    ];
    const opportunities = detectGrowthOpportunities(input({
      releases,
      contentItems: [content({ sources: ["https://github.com/acme/rocket/releases/tag/v3/"] })],
    }));
    expect(opportunities.map(({ ruleKey }) => ruleKey)).toEqual(["release:v3", "release:v30"]);

    expect(detectGrowthOpportunities(input({
      releases,
      contentItems: [content({ sources: ["https://github.com/acme/rocket/releases/tag/v3"] })],
    })).map(({ ruleKey }) => ruleKey)).toEqual(["release:v30"]);
  });

  it("detects only the next 1-2-5 star milestone within the inclusive five-percent boundary", () => {
    expect(detectGrowthOpportunities(input({ stars: 95 }))).toEqual([
      expect.objectContaining({ ruleKey: "star-milestone:100", category: "community" }),
    ]);
    expect(detectGrowthOpportunities(input({ stars: 94 }))).toEqual([]);
    expect(detectGrowthOpportunities(input({ stars: 190 }))[0].ruleKey).toBe("star-milestone:200");
    expect(detectGrowthOpportunities(input({ stars: Number.NaN }))).toEqual([]);
  });

  it("requires unanswered, unassigned good-first issues older than fourteen days", () => {
    const base = {
      number: 7,
      title: "Document the quick start",
      url: "https://github.com/acme/rocket/issues/7",
      labels: [{ name: "good first issue" }],
      commentsCount: 0,
      assignees: [],
    };
    expect(detectGrowthOpportunities(input({
      openIssues: [{ ...base, createdAt: atAge(14, 1) }],
    }))[0].ruleKey).toBe("good-first-issue:7");
    expect(detectGrowthOpportunities(input({
      openIssues: [{ ...base, createdAt: atAge(14) }],
    }))).toEqual([]);
    expect(detectGrowthOpportunities(input({
      openIssues: [
        { ...base, number: 8, createdAt: atAge(15), commentsCount: 1 },
        { ...base, number: 9, createdAt: atAge(15), assignees: [{}] },
        { ...base, number: 10, createdAt: atAge(15), labels: [{ name: "help wanted" }] },
        { ...base, number: 11, createdAt: atAge(15), assignees: undefined },
      ],
    }))).toEqual([]);
  });

  it("detects large merged pull requests at either inclusive size threshold and within thirty days", () => {
    const opportunities = detectGrowthOpportunities(input({
      mergedPullRequests: [
        pullRequest({ number: 1, additions: 250, deletions: 250, changedFiles: 1, mergedAt: atAge(30) }),
        pullRequest({ number: 2, additions: 1, deletions: 1, changedFiles: 20 }),
        pullRequest({ number: 3, additions: 250, deletions: 249, changedFiles: 19 }),
        pullRequest({ number: 4, mergedAt: atAge(30, 1) }),
      ],
    }));
    expect(opportunities.map(({ ruleKey }) => ruleKey)).toEqual(["merged-pr:1", "merged-pr:2"]);

    expect(detectGrowthOpportunities(input({
      mergedPullRequests: [pullRequest()],
      contentItems: [content({ sources: ["https://github.com/acme/rocket/pull/42"] })],
    }))).toEqual([]);
  });

  it("detects active goals only when they are more than five percentage points behind elapsed pace", () => {
    const goal = {
      id: "goal-1",
      metric: "stars" as const,
      target: 100,
      createdAt: "2026-08-31T00:00:00.001Z",
      deadline: "2026-09-20",
    };
    expect(detectGrowthOpportunities(input({ goals: [{ ...goal, current: 44 }] }))).toEqual([
      expect.objectContaining({ ruleKey: "goal-pace:goal-1", goalId: "goal-1" }),
    ]);
    expect(detectGrowthOpportunities(input({ goals: [{ ...goal, current: 45 }] }))).toEqual([]);
    expect(detectGrowthOpportunities(input({ goals: [{ ...goal, current: 100 }] }))).toEqual([]);
  });

  it("detects published evergreen content at the inclusive sixty-day boundary", () => {
    expect(detectGrowthOpportunities(input({
      contentItems: [content({ evergreen: 1, publishedAt: atAge(60) })],
    }))[0].ruleKey).toBe("evergreen:content-1");
    expect(detectGrowthOpportunities(input({
      contentItems: [content({ evergreen: 1, publishedAt: atAge(60, -1) })],
    }))).toEqual([]);
    expect(detectGrowthOpportunities(input({
      contentItems: [content({ evergreen: 0, publishedAt: atAge(90) })],
    }))).toEqual([]);
  });

  it("fails closed for malformed dates and incomplete signals", () => {
    expect(detectGrowthOpportunities(input({
      releases: [{ tagName: "bad", url: "https://example.com/release", publishedAt: "2026-02-30T00:00:00Z" }],
      openIssues: [{ number: 1, title: "Issue", url: "https://example.com/issue", createdAt: "invalid", labels: ["good-first-issue"], commentsCount: 0, assignees: [] }],
      mergedPullRequests: [pullRequest({ mergedAt: "not-a-date" })],
      goals: [{ id: "goal", metric: "forks", current: 1, target: 10, createdAt: "bad", deadline: "2026-09-30" }],
      contentItems: [content({ evergreen: 1, publishedAt: null })],
    }))).toEqual([]);
  });

  it("returns every rule in deterministic type and numeric key order", () => {
    const opportunities = detectGrowthOpportunities(input({
      stars: 95,
      releases: [
        { tagName: "v2", url: "https://example.com/v2", publishedAt: atAge(4) },
        { tagName: "v1", url: "https://example.com/v1", publishedAt: atAge(4) },
      ],
      openIssues: [
        { number: 10, title: "Ten", url: "https://example.com/10", createdAt: atAge(15), labels: ["good-first-issue"], commentsCount: 0, assignees: [] },
        { number: 2, title: "Two", url: "https://example.com/2", createdAt: atAge(15), labels: ["good first issue"], commentsCount: 0, assignees: [] },
      ],
      mergedPullRequests: [pullRequest({ number: 10 }), pullRequest({ number: 2 })],
      contentItems: [content({ id: "old", evergreen: 1, publishedAt: atAge(60) })],
    }));
    expect(opportunities.map(({ ruleKey }) => ruleKey)).toEqual([
      "release:v1",
      "release:v2",
      "star-milestone:100",
      "good-first-issue:2",
      "good-first-issue:10",
      "merged-pr:2",
      "merged-pr:10",
      "evergreen:old",
    ]);
  });
});
