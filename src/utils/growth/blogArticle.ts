import type { GrowthContentItem } from "../../types/growth";
import { normalizeGeneratedGrowthDraft } from "./contentDraft";

/** Editorial patterns distilled from Tabularis product stories and engineering retrospectives. */
export const GROWTH_BLOG_EDITORIAL_GUIDE = [
  "Write a standalone blog article worth sharing, not a changelog rewrite or a social post padded to article length.",
  "Choose one strong thesis: a newly possible workflow with a concrete before/after, a surprising implementation lesson, an architectural tradeoff, or a measured optimization.",
  "For a product story, open with the reader's problem and a compelling, verifiable outcome that can spark interest on social networks. Explain how the change helps in practice and where its limits remain.",
  "For a technical story aimed at Reddit, Hacker News or Lobsters, explain the constraints, decision, alternatives, implementation, failure modes and transferable lesson. Give readers something substantive to discuss even if they never use the product.",
  "Use an accurate, specific headline and a strong opening. Avoid clickbait, generic hype, fabricated controversy, requests for votes, and claims of guaranteed popularity.",
  "Use Markdown headings, connected prose, source links and code only when supported by the supplied evidence. Distinguish illustrative pseudocode from actual implementation. Never invent benchmarks, quotations, author experiences or reasons a decision was made.",
  "Treat merged work as merged, not necessarily released. Treat open issues and pull requests as unfinished. If evidence does not establish a motivation or result, say so or omit the claim.",
  "Use reference content for editorial structure, never transplant its product facts or wording into another repository. Follow the profile language, voice and audience. Do not use em dashes.",
].join(" ");

export function blogInterventionProposalIssue(value: unknown, allowedSources: readonly string[]): string | null {
  const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const issue = normalizeGeneratedGrowthDraft("doc", "", { title: entry.title, body: entry.content }, "blog").issue;
  if (issue) return issue;
  if (typeof entry.summary !== "string" || !entry.summary.trim()) return "Include the intended audience and article angle in summary.";
  if (!Array.isArray(entry.sources) || entry.sources.some((url) => typeof url !== "string" || !allowedSources.includes(url))) {
    return "Use only supplied evidence URLs in sources.";
  }
  return null;
}

export function growthBlogFilename(title: string): string {
  const slug = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100).replace(/-+$/g, "");
  return `${slug || "blog-article"}.md`;
}

/** Exports editable copy with portable YAML metadata, without inventing author or release fields. */
export function exportGrowthBlogMarkdown(
  item: Pick<GrowthContentItem, "title" | "body" | "pillar" | "scheduledFor" | "generatedAt" | "createdAt">,
): string {
  const body = item.body.trim().replace(/\r\n/g, "\n");
  // Preserve frontmatter supplied by the editor or an existing imported article.
  if (/^---\n[\s\S]*?\n---(?:\n|$)/.test(body)) return `${body}\n`;
  const title = item.title.trim() || "Blog article";
  const opening = body.split(/\n\s*\n/).find((paragraph) => paragraph.trim() && !/^(?:#|>|```|\s*[-*] )/.test(paragraph)) ?? "";
  const excerpt = opening.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
  const date = item.scheduledFor ?? item.generatedAt ?? item.createdAt;
  const heading = /^#\s/m.test(body) ? "" : `# ${title.replace(/\s+/g, " ")}\n\n`;
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `date: ${JSON.stringify(date)}`,
    `tags: ${JSON.stringify(item.pillar ? [item.pillar] : [])}`,
    `excerpt: ${JSON.stringify(excerpt)}`,
    "---",
    "",
    `${heading}${body}`,
    "",
  ].join("\n");
}
