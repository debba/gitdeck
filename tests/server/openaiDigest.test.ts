import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeGenerateOpenAIDigest } from "../../src/server/openaiDigest";
import type { DailyRepoDigest } from "../../src/types/github";
import type { DailyDigestRecord } from "../../src/utils/digests";

const repositoryDigest: DailyRepoDigest = {
  repo: "acme/app",
  date: "2026-10-15",
  stars: 10,
  forks: 2,
  issueCount: 3,
  staleIssueCount: 1,
  securityAlertsCount: 2,
  securityAlertsUnavailable: false,
  starsDelta: 1,
  forksDelta: 0,
  issueDelta: 0,
  staleIssueDelta: 0,
  securityAlertsDelta: 1,
  highlights: ["One new star"],
  executiveSummary: [],
  momentum: [],
  risks: [],
};

const dashboardDigest: DailyDigestRecord = {
  date: "2026-10-15",
  repoCount: 1,
  issueCount: 3,
  staleIssueCount: 1,
  securityAlertsCount: 2,
  securityReposCount: 1,
  securityAlertsUnavailable: false,
  totalStars: 10,
  totalForks: 2,
  repos: [repositoryDigest],
};

beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenAI digest prompts", () => {
  it.each([
    { name: "repository", record: repositoryDigest, securityLine: "Security alerts: 2" },
    { name: "dashboard", record: dashboardDigest, securityLine: "Security alerts: 2 across 1 repos" },
  ])("includes valid security totals in the $name request", async ({ record, securityLine }) => {
    const draft = { headline: "Daily update", briefing: ["Stars increased", "Issues stable", "Review security alerts"] };
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(draft) }] }],
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await maybeGenerateOpenAIDigest(record);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { input: string };

    expect(payload.input.split("\n")).toContain(securityLine);
    expect(payload.input).not.toContain("undefined");
    expect(result).toMatchObject(draft);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
