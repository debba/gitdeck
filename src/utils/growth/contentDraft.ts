import type { GrowthContentItem } from "../../types/growth";
import type { GoalProposal } from "../../types/goals";
import { normalizeSocialProposals, SOCIAL_PROPOSAL_FORMATS, socialProposalIssue } from "../socialProposals";

export interface GrowthDraftCopy {
  title: string;
  body: string;
  threadPosts: string[];
}

export interface GrowthFallbackDraftInput {
  repository: string;
  format: GrowthContentItem["format"];
  angle: string;
  cta: string;
  audience: string;
  hashtags: readonly string[];
  facts: readonly string[];
  repositoryUrl: string | null;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateCodePoints(value: string, limit: number): string {
  const points = Array.from(compact(value));
  if (points.length <= limit) return points.join("");
  return `${points.slice(0, Math.max(0, limit - 1)).join("").trimEnd()}…`;
}

function uniqueFacts(facts: readonly string[]): string[] {
  const seen = new Set<string>();
  return facts.flatMap((fact) => {
    const normalized = compact(fact);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function hashtagText(hashtags: readonly string[], limit: number): string {
  return hashtags.map(compact).filter((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag)).slice(0, limit).join(" ");
}

/** Creates conservative fallback copy from already verified repository facts. */
export function buildFallbackGrowthDraft(input: GrowthFallbackDraftInput): GrowthDraftCopy {
  const facts = uniqueFacts(input.facts);
  const angle = compact(input.angle) || facts[0] || `Explore the latest information available for ${input.repository}`;
  const cta = compact(input.cta) || `Review ${input.repository} and share feedback`;
  const repositoryUrl = input.repositoryUrl ?? `https://github.com/${input.repository}`;
  const title = truncateCodePoints(angle, 100);

  if (input.format === "x-thread") {
    const tags = hashtagText(input.hashtags, 2);
    const posts = [
      `${input.repository}: ${angle}`,
      facts[0] ?? `The repository is available for developers to inspect and try.`,
      facts[1] ?? `Its README and repository activity are the source of truth for current capabilities.`,
      facts[2] ?? `Open issues and pull requests show work in progress, not shipped promises.`,
      `${cta}. ${repositoryUrl}${tags ? ` ${tags}` : ""}`,
    ].map((post) => truncateCodePoints(post, 280));
    return { title, body: posts.join("\n\n---\n\n"), threadPosts: posts };
  }

  const audience = compact(input.audience);
  const paragraphs = [
    `${input.repository}: ${angle}`,
    ...facts.slice(0, 3),
    audience ? `For ${audience}, the repository provides the current implementation and project context.` : "",
    `${cta}. ${repositoryUrl}`,
  ].filter(Boolean);
  const tagLimit = input.format === "linkedin-post" ? 3 : 2;
  const tags = hashtagText(input.hashtags, tagLimit);
  const body = `${paragraphs.join("\n\n")}${tags ? `\n\n${tags}` : ""}`;
  const limit = input.format === "mastodon-post" ? 500 : input.format === "linkedin-post" ? 3_000 : 8_000;
  return { title, body: truncateCodePoints(body, limit), threadPosts: [] };
}

/** Applies the existing social format limits to one model-generated draft. */
export function normalizeGeneratedGrowthDraft(
  format: GrowthContentItem["format"],
  summary: string,
  value: unknown,
): { draft: GrowthDraftCopy | null; issue: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { draft: null, issue: "missing draft" };
  }
  const entry = value as Record<string, unknown>;
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  const body = typeof entry.body === "string" ? entry.body.trim() : "";
  const threadPosts = Array.isArray(entry.threadPosts)
    ? entry.threadPosts.map((post) => String(post).trim()).filter(Boolean)
    : [];

  if (!SOCIAL_PROPOSAL_FORMATS.includes(format as (typeof SOCIAL_PROPOSAL_FORMATS)[number])) {
    if (!title) return { draft: null, issue: "missing title" };
    if (!body) return { draft: null, issue: "missing content" };
    return { draft: { title, body, threadPosts: [] }, issue: null };
  }

  const proposal: GoalProposal = {
    title,
    format,
    summary: compact(summary) || "Repository audience and evidence-led update",
    content: body,
    threadPosts,
    mediaSuggestions: [],
  };
  const normalized = normalizeSocialProposals([proposal])[0];
  if (!normalized) {
    const candidate = format === "x-thread" && threadPosts.length > 0
      ? { ...proposal, content: threadPosts.join("\n\n---\n\n") }
      : proposal;
    return { draft: null, issue: socialProposalIssue(candidate) ?? "platform-invalid draft" };
  }
  const issue = socialProposalIssue(normalized);
  if (issue) return { draft: null, issue };
  return {
    draft: {
      title: normalized.title,
      body: normalized.content,
      threadPosts: normalized.threadPosts ?? [],
    },
    issue: null,
  };
}
