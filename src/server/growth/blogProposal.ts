import type { GoalProposal } from "../../types/goals";
import { blogInterventionProposalIssue, GROWTH_BLOG_EDITORIAL_GUIDE } from "../../utils/growth/blogArticle";
import { generateEditorial } from "./editorial";

interface BlogAnswer {
  title: string;
  summary: string;
  content: string;
  sources: string[];
}

/** Produce one real article, not the social campaign historically returned for every intervention. */
export async function generateBlogInterventionProposal(context: Record<string, unknown>, allowedSources: string[]): Promise<GoalProposal[]> {
  const answer = await generateEditorial<BlogAnswer>({
    instructions: [
      GROWTH_BLOG_EDITORIAL_GUIDE,
      "Carry out the recommended intervention as one complete blog article in the profile language, voice and audience. Return the finished Markdown article in content, not an outline or a plan to write later.",
      "Include one # title, a substantive introduction, ## sections, a connected explanation with supported examples and limitations, and a practical next step. Aim for 800–1600 words when sources support that depth; prefer a shorter useful article over invented detail.",
      "Use source links near factual claims, only from allowedSources. Distinguish source-backed facts from proposed experiments. Explain technical terms for the intended reader. Do not add social hashtags or platform submission copy. Media is optional and not required for this article.",
      "Return title, an audience-and-angle summary, the full content and the evidence URLs actually used in sources. Return JSON only.",
    ].join(" "),
    input: JSON.stringify({ ...context, allowedSources }),
    schemaName: "growth_blog_intervention",
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string" }, summary: { type: "string" }, content: { type: "string" },
        sources: { type: "array", items: { type: "string" } },
      },
      required: ["title", "summary", "content", "sources"],
    },
    maxOutputTokens: 6500,
  }, (value) => blogInterventionProposalIssue(value, allowedSources));
  return [{ title: answer.title.trim(), summary: answer.summary.trim(), content: answer.content.trim(),
    format: "doc", threadPosts: [], mediaSuggestions: [], sources: [...new Set(answer.sources)] }];
}
