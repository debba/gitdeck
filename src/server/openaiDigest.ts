import type { DailyDigestRecord } from "../utils/digests";
import type { DailyRepoDigest } from "../types/github";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_DIGEST_MODEL = process.env.OPENAI_DIGEST_MODEL ?? "gpt-4.1-mini";

interface OpenAIDigestResult {
  model: string;
  headline: string;
  briefing: string[];
  generatedAt: string;
}

function hasOpenAIConfig(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
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

function extractText(response: { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }): string {
  return (response.output || [])
    .flatMap((item) => item.type === "message" ? (item.content || []) : [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export async function maybeGenerateOpenAIDigest(record: DailyDigestRecord | DailyRepoDigest): Promise<OpenAIDigestResult | null> {
  if (!hasOpenAIConfig()) return null;
  if (record.ai?.headline && record.ai?.briefing?.length) return record.ai;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_DIGEST_MODEL,
      instructions: "You write concise engineering daily digests. Return plain JSON with keys: headline (string), briefing (array of exactly 3 strings). Keep each string under 140 characters.",
      input: buildDigestPrompt(record),
      text: {
        format: {
          type: "json_schema",
          name: "daily_digest",
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
        },
      },
      max_output_tokens: 300,
      store: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI digest request failed with HTTP ${response.status}`);
  }

  const json = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  const text = extractText(json);
  if (!text) return null;

  const parsed = JSON.parse(text) as { headline: string; briefing: string[] };
  return {
    model: OPENAI_DIGEST_MODEL,
    headline: parsed.headline,
    briefing: parsed.briefing,
    generatedAt: new Date().toISOString(),
  };
}
