import { AiRequestError, generateStructured, type StructuredRequest, type StructuredResult } from "../ai/client";
import {
  EDITORIAL_DIMENSIONS,
  EDITORIAL_GUIDE,
  EDITORIAL_RECOMMENDATION_GUIDE,
  canUseEditorialDraft,
  parseEditorialReview,
  passesEditorialReview,
} from "../../utils/growth/editorialQuality";

/** Bounded Self-Refine-style generation: draft, critique, at most one revision, then re-check. */
export async function generateEditorial<T>(
  request: StructuredRequest,
  validate: (answer: T) => string | null,
  task: "content" | "recommendations" = "content",
): Promise<T> {
  const guide = task === "recommendations" ? EDITORIAL_RECOMMENDATION_GUIDE : EDITORIAL_GUIDE;
  let previousDraft: T | null = null;
  let usableDraft: { data: T } | null = null;
  let feedback: unknown = null;
  let failure = "No usable draft was returned.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result: StructuredResult<T> = await generateStructured<T>({
      ...request,
      instructions: `${request.instructions}\n${guide}${attempt ? "\nRevise the previous draft to resolve every listed issue. Preserve supported details and the requested output format." : ""}`,
      input: attempt ? JSON.stringify({ originalInput: request.input, previousDraft, editorialFeedback: feedback }) : request.input,
    });
    previousDraft = result.data;
    const issue = validate(result.data);
    if (issue) {
      feedback = { issues: [issue] };
      failure = `Invalid format: ${issue}`;
      continue;
    }
    const critique = await generateStructured<unknown>({
      instructions: [
        "Act as a demanding technical editor, not a promoter. Evaluate the supplied draft against the original evidence and requirements; do not rewrite it.",
        guide,
        "Score grounding, specificity, readerValue and structure from 1 (unusable) to 5 (excellent). Grounding 4 means supported claims with no identified factual error; 5 means especially precise source attribution. Scores 1–3 indicate concrete unsupported claims or status errors. Source URLs alone are not proof. Do not lower grounding for stylistic preferences or clearly framed proposed work.",
        "Specificity needs identifiable project details, not a project name plus generic advice. ReaderValue requires an actionable insight or useful explanation, not merely a release announcement.",
        "Structure assesses narrative progression, non-repetition, profile/language adherence and channel fit. For multiple assets score the weakest asset, not the average.",
        task === "recommendations"
          ? "Assess action recommendations for source relevance, feasible next steps and distinct angles. An observable result can be a proposed deliverable or verification step, not a measured success. Do not demand article structure or already executed work."
          : "Assess finished content for evidence-led explanation, narrative progression and channel fit.",
        "Judge proportionally to the format and available evidence: do not demand a long tutorial in a short post. Never reward length or invented detail.",
        "List up to six actionable improvements in issues. Separately list blockingIssues ONLY for identifiable unsupported factual claims, incorrect work status or violations of explicit requirements such as the requested language or format. Quote the problematic passage and explain a concrete evidence-based fix. Style, stronger hooks, optional detail, preferred phrasing and requests for more evidence without identifying an unsupported claim are non-blocking improvements. Empty blockingIssues means the draft can be used even if issues suggests refinements. Never invent a blocker just to justify a score. Return JSON only.",
      ].join(" "),
      input: JSON.stringify({ requirements: request.instructions, evidence: request.input, draft: result.data }),
      schemaName: "growth_editorial_review",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scores: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(EDITORIAL_DIMENSIONS.map((key) => [key, { type: "integer", minimum: 1, maximum: 5 }])),
            required: [...EDITORIAL_DIMENSIONS],
          },
          issues: { type: "array", maxItems: 6, items: { type: "string", maxLength: 1200 } },
          blockingIssues: { type: "array", maxItems: 6, items: { type: "string", maxLength: 1200 } },
        },
        required: ["scores", "issues", "blockingIssues"],
      },
      maxOutputTokens: 1800,
    });
    const review = parseEditorialReview(critique.data);
    if (!review) throw new AiRequestError("AI returned an invalid editorial review");
    if (passesEditorialReview(review)) return result.data;
    if (canUseEditorialDraft(review)) usableDraft = { data: result.data };
    failure = review.blockingIssues.length
      ? `Unresolved review issues: ${review.blockingIssues.slice(0, 2).join("; ")}`
      : `Factual grounding remains insufficient (${review.scores.grounding}/5): ${review.issues[0] || "claims could not be supported by the supplied evidence"}`;
    feedback = review;
  }
  // A revision can regress. Keep an already validated, grounded candidate rather than losing it.
  if (usableDraft) return usableDraft.data;
  throw new AiRequestError(`AI content did not pass validation after revision. ${failure.replace(/\s+/g, " ").slice(0, 600)}`);
}
