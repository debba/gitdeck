import type { GoalProposal, GoalProposalFormat } from "../types/goals";

export const SOCIAL_PROPOSAL_FORMATS = ["x-thread", "linkedin-post", "mastodon-post"] as const satisfies readonly GoalProposalFormat[];

const SOCIAL_LIMITS: Partial<Record<GoalProposalFormat, number>> = {
  "x-thread": 280,
  "linkedin-post": 3_000,
  "mastodon-post": 500,
};

/** Counts Unicode code points rather than UTF-16 units, which avoids double-counting most emoji. */
export function socialCharacterCount(text: string): number {
  return Array.from(text).length;
}

function hashtagCount(text: string): number {
  return [...text.matchAll(/(?:^|\s)#[\p{L}\p{N}_]+/gu)].length;
}

export function socialProposalIssue(proposal: GoalProposal): string | null {
  if (!proposal.title.trim()) return "missing title";
  if (!proposal.summary.trim()) return "missing audience and angle summary";
  if (!proposal.content.trim()) return "missing content";
  if (!SOCIAL_PROPOSAL_FORMATS.includes(proposal.format as (typeof SOCIAL_PROPOSAL_FORMATS)[number])) {
    return `unsupported social format: ${proposal.format}`;
  }

  if (proposal.format === "x-thread") {
    const posts = proposal.threadPosts?.map((post) => post.trim()).filter(Boolean) ?? [];
    if (posts.length < 5 || posts.length > 7) return "X thread must contain 5–7 posts";
    if (posts.some((post) => socialCharacterCount(post) > SOCIAL_LIMITS["x-thread"]!)) return "X post exceeds 280 characters";
    if (hashtagCount(posts.join("\n")) > 2) return "X thread contains more than 2 hashtags";
    return null;
  }

  const limit = SOCIAL_LIMITS[proposal.format];
  if (limit && socialCharacterCount(proposal.content) > limit) return `${proposal.format} exceeds ${limit} characters`;
  const hashtagLimit = proposal.format === "linkedin-post" ? 3 : 2;
  return hashtagCount(proposal.content) > hashtagLimit ? `${proposal.format} contains too many hashtags` : null;
}

/**
 * Sanitizes model output and rejects incomplete, duplicate, or platform-invalid
 * social drafts instead of showing content that cannot actually be published.
 */
export function normalizeSocialProposals(entries: unknown): GoalProposal[] {
  if (!Array.isArray(entries)) return [];
  const proposals: GoalProposal[] = [];
  const seenFormats = new Set<string>();
  const seenContent = new Set<string>();

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const format = String(entry.format ?? "") as GoalProposalFormat;
    const posts = format === "x-thread" && Array.isArray(entry.threadPosts)
      ? entry.threadPosts.map((post) => String(post).trim()).filter(Boolean).slice(0, 7)
      : undefined;
    const content = format === "x-thread" && posts?.length
      ? posts.join("\n\n---\n\n")
      : String(entry.content ?? "").trim();
    const proposal: GoalProposal = {
      title: String(entry.title ?? "").trim(),
      format,
      summary: String(entry.summary ?? "").trim(),
      content,
      threadPosts: posts,
    };
    const fingerprint = content.toLocaleLowerCase();
    if (seenFormats.has(format) || seenContent.has(fingerprint) || socialProposalIssue(proposal)) continue;
    seenFormats.add(format);
    seenContent.add(fingerprint);
    proposals.push(proposal);
  }
  return proposals;
}

export function hasCompleteSocialSet(proposals: GoalProposal[]): boolean {
  return SOCIAL_PROPOSAL_FORMATS.every((format) => proposals.some((proposal) => proposal.format === format));
}
