import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), signals: vi.fn(), configured: true, profile: vi.fn(), history: vi.fn() }));
vi.mock("../../src/server/ai/client", async (actual) => ({
  ...await actual<typeof import("../../src/server/ai/client")>(), generateStructured: mocks.generate,
}));
vi.mock("../../src/server/ai/settings", () => ({ isAiConfigured: () => mocks.configured }));
vi.mock("../../src/server/growth/signals", () => ({ collectRepositorySignals: mocks.signals }));
vi.mock("../../src/server/growth/store", () => ({ getGrowthProfile: mocks.profile, listGrowthInterventions: mocks.history }));
import { generateGoalProposals, generateRepositoryInterventionSuggestions } from "../../src/server/goals";

const review = { scores: { grounding: 5, specificity: 4, readerValue: 4, structure: 4 }, issues: [], blockingIssues: [] };
const suggestions = ["Explain the protocol", "Document crash recovery", "Show driver configuration"]
  .map((title, index) => ({ title, destination: index === 0 ? "blog" as const : "other" as const, category: "engineering" as const, action: "Use the documented JSON-RPC driver example to explain the isolation tradeoff." }));

beforeEach(() => {
  mocks.generate.mockReset();
  mocks.signals.mockReset();
  mocks.profile.mockReset();
  mocks.history.mockReset();
  mocks.configured = true;
  mocks.profile.mockReturnValue({ language: "it", voice: "Technical", audience: "Maintainers", avoid: "Hype", channels: { blog: true, x: false } });
  mocks.history.mockReturnValue([{ title: "Earlier topic", action: "Already covered", status: "done" }]);
  mocks.signals.mockResolvedValue({
    generatedOn: "2026-09-18", repository: "acme/drivers", repositoryMetadata: { url: "https://github.com/acme/drivers", visibility: "PUBLIC" },
    openIssues: [], openPullRequests: [], releases: [{ name: "v2", body: "Driver configuration. ".repeat(60), html_url: "https://github.com/acme/drivers/releases/v2" }],
    mergedPullRequests: [{ title: "Isolate drivers", url: "https://github.com/acme/drivers/pull/42", body: "JSON-RPC over stdin/stdout" }],
    recentCommits: [], readme: { excerpt: "A JSON-RPC driver protocol", mediaUrls: [] }, additionalSources: [], starHistory: [], goals: [],
  });
});

describe("editorial intervention and campaign integration", () => {
  it("uses richer evidence, the account profile and earlier interventions before reviewing actions", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { suggestions } }).mockResolvedValueOnce({ data: review });
    await expect(generateRepositoryInterventionSuggestions("account-a", "acme/drivers")).resolves.toEqual(suggestions);
    expect(mocks.profile).toHaveBeenCalledWith("account-a", "acme/drivers");
    expect(mocks.history).toHaveBeenCalledWith("account-a", { repository: "acme/drivers" });
    const input = JSON.parse(mocks.generate.mock.calls[0][0].input);
    expect(input.profile.language).toBe("it");
    expect(input.existingInterventions[0].title).toBe("Earlier topic");
    expect(input.mergedPullRequests[0].body).toContain("JSON-RPC");
    expect(input.latestReleases[0].notesExcerpt.length).toBeGreaterThan(500);
    expect(mocks.generate.mock.calls[1][0].schemaName).toBe("growth_editorial_review");
  });

  it("returns one useful intervention after revision without requiring article-level perfection", async () => {
    const usable = { scores: { grounding: 4, specificity: 3, readerValue: 4, structure: 3 }, issues: ["An optional example could help."], blockingIssues: [] };
    mocks.generate.mockResolvedValueOnce({ data: { suggestions: suggestions.slice(0, 1) } }).mockResolvedValueOnce({ data: usable })
      .mockResolvedValueOnce({ data: { suggestions: suggestions.slice(0, 1) } }).mockResolvedValueOnce({ data: usable });
    await expect(generateRepositoryInterventionSuggestions("account-a", "acme/drivers")).resolves.toEqual(suggestions.slice(0, 1));
    const initialRequest = mocks.generate.mock.calls[0][0];
    expect(initialRequest.schema.properties.suggestions.minItems).toBe(1);
    expect(initialRequest.instructions).toContain("not finished articles");
    expect(mocks.generate.mock.calls[1][0].instructions).toContain("not finished articles");
    expect(mocks.generate).toHaveBeenCalledTimes(4);
  });

  it("does not disguise malformed AI suggestions as a successful generic fallback", async () => {
    mocks.generate.mockResolvedValue({ data: { suggestions: [] } });
    await expect(generateRepositoryInterventionSuggestions("account-a", "acme/drivers")).rejects.toThrow(/did not pass/);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it("keeps the no-provider path deterministic and avoids AI calls", async () => {
    mocks.configured = false;
    expect(await generateRepositoryInterventionSuggestions("account-a", "acme/drivers")).toHaveLength(4);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.signals).not.toHaveBeenCalled();
  });

  it("repairs a recommendation set that neglects an enabled blog with supporting sources", async () => {
    mocks.generate.mockResolvedValueOnce({ data: { suggestions: suggestions.map((item) => ({ ...item, destination: "other" })) } })
      .mockResolvedValueOnce({ data: { suggestions } }).mockResolvedValueOnce({ data: review });
    const result = await generateRepositoryInterventionSuggestions("account-a", "acme/drivers");
    expect(result.some((item) => item.destination === "blog")).toBe(true);
    expect(JSON.parse(mocks.generate.mock.calls[1][0].input).editorialFeedback.issues[0]).toContain("blog channel is enabled");
  });

  it("generates a complete Markdown blog article instead of three social posts", async () => {
    const content = "# Driver isolation\n\nWhy isolate a driver?\n\n## Protocol\n\nThe implementation uses JSON-RPC over stdin/stdout.\n\n## Limitations\n\n[Inspect the change](https://github.com/acme/drivers/pull/42).";
    mocks.generate.mockResolvedValueOnce({ data: { title: "Driver isolation", summary: "A protocol guide for maintainers", content, sources: ["https://github.com/acme/drivers/pull/42"] } })
      .mockResolvedValueOnce({ data: review });
    const result = await generateGoalProposals({ accountId: "account-a", repository: "acme/drivers" }, suggestions[0]);
    expect(result).toEqual([{ title: "Driver isolation", summary: "A protocol guide for maintainers", content, sources: ["https://github.com/acme/drivers/pull/42"], format: "doc", threadPosts: [], mediaSuggestions: [] }]);
    const request = mocks.generate.mock.calls[0][0];
    expect(request.schemaName).toBe("growth_blog_intervention");
    expect(request.maxOutputTokens).toBeGreaterThanOrEqual(6500);
    expect(request.instructions).toContain("not an outline");
    expect(JSON.parse(request.input).profile.language).toBe("it");
  });

  it("rejects a blog outline without Markdown sections or invented source URLs", async () => {
    mocks.generate.mockResolvedValue({ data: { title: "Outline", summary: "For maintainers", content: "Write about isolation later", sources: [] } });
    await expect(generateGoalProposals({ accountId: "account-a", repository: "acme/drivers" }, suggestions[0])).rejects.toThrow("Markdown title and sections");
    mocks.generate.mockResolvedValue({ data: { title: "Article", summary: "For maintainers", content: "# Article\n\n## Design\n\nDescription", sources: ["https://invented.example/benchmark"] } });
    await expect(generateGoalProposals({ accountId: "account-a", repository: "acme/drivers" }, suggestions[0])).rejects.toThrow("supplied evidence URLs");
  });

  it("reviews a full social campaign using the profile language and preserves format normalization", async () => {
    const proposals = [
      { title: "Protocol", format: "x-thread", summary: "For maintainers", content: "", threadPosts: ["Problem", "Protocol", "Isolation", "Tradeoff", "Try it"], mediaSuggestions: [] },
      { title: "Isolation", format: "linkedin-post", summary: "For maintainers", content: "JSON-RPC driver isolation explained.", threadPosts: [], mediaSuggestions: [] },
      { title: "Driver", format: "mastodon-post", summary: "For maintainers", content: "Explore the documented driver protocol.", threadPosts: [], mediaSuggestions: [] },
    ];
    mocks.generate.mockResolvedValueOnce({ data: { proposals } }).mockResolvedValueOnce({ data: review });
    const result = await generateGoalProposals({ accountId: "account-a", repository: "acme/drivers" }, { ...suggestions[0], destination: "social" });
    expect(result.map((proposal) => proposal.format)).toEqual(["x-thread", "linkedin-post", "mastodon-post"]);
    expect(result[0].content).toContain("Problem");
    expect(JSON.parse(mocks.generate.mock.calls[0][0].input).profile.language).toBe("it");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
});
