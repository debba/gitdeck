import { describe, expect, it } from "vitest";
import type { GrowthContentItem, GrowthIntervention } from "../../../src/types/growth";
import { groupGrowthInterventions, growthInterventionGroup } from "../../../src/utils/growth/interventionGroups";

function intervention(overrides: Partial<GrowthIntervention> = {}): GrowthIntervention {
  return {
    id: "action", accountId: "account-a", repository: "acme/rocket", goalId: null,
    category: "engineering", title: "Improve onboarding", action: "Review the setup flow.",
    origin: "ai", ruleKey: null, dedupeKey: "action", status: "proposed",
    createdAt: "2026-09-18T00:00:00Z", updatedAt: "2026-09-18T00:00:00Z", ...overrides,
  };
}

function content(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "content", accountId: "account-a", repository: "acme/rocket", interventionId: "action",
    planId: null, goalIds: [], channel: "blog", format: "doc", pillar: "", angle: "", title: "", summary: "",
    body: "", threadPosts: [], media: [], sources: [], status: "draft", scheduledFor: null,
    publishedAt: null, publishedUrl: null, generatedAt: null, generationVersion: 1, evergreen: 0,
    createdAt: "2026-09-18T00:00:00Z", updatedAt: "2026-09-18T00:00:00Z", ...overrides,
  };
}

describe("intervention destination groups", () => {
  it.each([
    ["Write a blog article", "Share it on Reddit and X", "blog"],
    ["Publish a technical deep dive", "Start a Hacker News discussion", "blog"],
    ["Scrivi un articolo tecnico", "Condividi il risultato", "blog"],
    ["Launch an X thread", "Link to the blog article", "social"],
    ["Share the blog article on LinkedIn", "Use the summary", "social"],
    ["Submit the technical article to Hacker News", "Ask for feedback", "communities"],
    ["Discuss the tradeoffs on lobster.rs", "Show the implementation", "communities"],
    ["Ask r/rust on Reddit", "Open a discussion", "communities"],
    ["Improve onboarding", "Post a tutorial on the blog", "blog"],
    ["Fix the worker thread", "Avoid a deadlock", "other"],
    ["Update example X coordinates", "Document X and Y", "other"],
    ["Review compiler flags", "Measure the build", "other"],
  ])("classifies %s as %s", (title, action, group) => {
    expect(growthInterventionGroup(intervention({ title, action }), [])).toBe(group);
  });

  it("uses an explicit destination instead of guessing from localized titles or distribution channels", () => {
    expect(growthInterventionGroup(intervention({ destination: "blog", title: "Condividi su Reddit", action: "Spiega il protocollo" }), [])).toBe("blog");
    expect(growthInterventionGroup(intervention({ destination: "social", title: "Share the blog article" }), [content()])).toBe("social");
  });

  it("uses linked channels without leaking content from another account or repository", () => {
    const item = intervention();
    expect(growthInterventionGroup(item, [content()])).toBe("blog");
    expect(growthInterventionGroup(item, [content({ channel: "discussion", format: "discussion" })])).toBe("communities");
    expect(growthInterventionGroup(item, [content({ channel: "x", format: "x-thread" })])).toBe("social");
    expect(growthInterventionGroup(item, [content({ accountId: "account-b" }), content({ repository: "acme/other" })])).toBe("other");
    expect(growthInterventionGroup(item, [content({ interventionId: "unrelated" })])).toBe("other");
    expect(growthInterventionGroup(item, [content({ channel: "other", format: "doc" })])).toBe("other");
  });

  it("follows the original channel when recycling evergreen content", () => {
    const item = intervention({ origin: "rule", ruleKey: "evergreen:source", title: "Recycle evergreen content", category: "marketing" });
    expect(growthInterventionGroup(item, [content({ id: "source", interventionId: null })])).toBe("blog");
    expect(growthInterventionGroup(item, [content({ id: "source", interventionId: null, channel: "linkedin" })])).toBe("social");
  });

  it("preserves statuses and order, includes empty main groups and never duplicates multi-channel actions", () => {
    const first = intervention({ id: "one", title: "Write a blog article", status: "accepted" });
    const second = intervention({ id: "two", title: "Discuss on Reddit and X", status: "dismissed" });
    const third = intervention({ id: "three", title: "Another blog article", status: "done" });
    const groups = groupGrowthInterventions([first, second, third], []);
    expect(groups.map(({ id }) => id)).toEqual(["blog", "social", "communities", "other"]);
    expect(groups[0].interventions).toEqual([first, third]);
    expect(groups[1].interventions).toEqual([]);
    expect(groups[2].interventions).toEqual([second]);
    expect(groups.flatMap(({ interventions }) => interventions)).toHaveLength(3);
  });
});
