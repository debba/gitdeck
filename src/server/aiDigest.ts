import type { DailyDigestRecord } from "../utils/digests";
import type { DailyRepoDigest } from "../types/github";
import { generateStructured } from "./ai/client";
import { isAiConfigured } from "./ai/settings";

interface AiDigestResult {
  provider: string;
  model: string;
  headline: string;
  briefing: string[];
  generatedAt: string;
}

function buildDigestPrompt(record: DailyDigestRecord | DailyRepoDigest): string {
  if ("repo" in record) {
    return [
      `Date: ${record.date}`,
      `Repository: ${record.repo}`,
      `Stars: ${record.stars} (delta ${record.starsDelta >= 0 ? "+" : ""}${record.starsDelta})`,
      `Forks: ${record.forks} (delta ${record.forksDelta >= 0 ? "+" : ""}${record.forksDelta})`,
      `Open issues: ${record.issueCount} (delta ${record.issueDelta >= 0 ? "+" : ""}${record.issueDelta})`,
      `Stale issues: ${record.staleIssueCount} (delta ${record.staleIssueDelta >= 0 ? "+" : ""}${record.staleIssueDelta})`,
      `Security alerts: ${record.securityAlertsCount}`,
      "Highlights:",
      ...record.highlights,
      "Momentum:",
      ...(record.momentum.length ? record.momentum : ["None"]),
      "Risks:",
      ...(record.risks.length ? record.risks : ["None"]),
    ].join("\n");
  }

  const topRepos = record.repos
    .slice(0, 8)
    .map((repo) => `${repo.repo}: stars ${repo.stars}, forks ${repo.forks}, open issues ${repo.issueCount}, stale ${repo.staleIssueCount}`)
    .join("\n");

  return [
    `Date: ${record.date}`,
    `Tracked repositories: ${record.repoCount}`,
    `Total stars: ${record.totalStars}`,
    `Total forks: ${record.totalForks}`,
    `Open issues: ${record.issueCount}`,
    `Stale issues: ${record.staleIssueCount}`,
    `Security alerts: ${record.securityAlertsCount} across ${record.securityReposCount} repos`,
    "Repository snapshot:",
    topRepos || "None",
  ].join("\n");
}

export async function maybeGenerateAiDigest(record: DailyDigestRecord | DailyRepoDigest): Promise<AiDigestResult | null> {
  if (!isAiConfigured()) return null;
  if (record.ai?.headline && record.ai?.briefing?.length) return record.ai as AiDigestResult;

  const result = await generateStructured<{ headline: string; briefing: string[] }>({
    instructions: "You write concise engineering daily digests. Return plain JSON with keys: headline (string), briefing (array of exactly 3 strings). Keep each string under 140 characters.",
    input: buildDigestPrompt(record),
    schemaName: "daily_digest",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        headline: { type: "string" },
        briefing: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 3,
        },
      },
      required: ["headline", "briefing"],
    },
    maxOutputTokens: 300,
  });
  if (!result.data.headline || !Array.isArray(result.data.briefing) || !result.data.briefing.length) return null;
  return {
    provider: result.provider,
    model: result.model,
    headline: result.data.headline,
    briefing: result.data.briefing.map(String),
    generatedAt: new Date().toISOString(),
  };
}
