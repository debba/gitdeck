import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { GoalContentSource, GoalMetric, GoalProposal, GoalSuggestion, RepositoryGoal } from "../types/goals";
import { calculateGoalProgress } from "../utils/goals";
import {
  attachSourceMedia,
  extractMediaUrls,
  extractWebPageSignal,
  hasCompleteSocialSet,
  normalizeSocialProposals,
  SOCIAL_PROPOSAL_FORMATS,
} from "../utils/socialProposals";
import { AiNotConfiguredError, AiRequestError, generateStructured } from "./ai/client";
import { isAiConfigured } from "./ai/settings";
import { getIssuesCached, getPullRequestsCached, getReposCached } from "./dashboardData";
import { ghApiJson, restApi, restApiPaginate } from "./githubClient";
import { updateGoalCurrentValue } from "./goalStore";

interface MetricResolver {
  resolve(repository: string): Promise<number | null>;
}

/** Add a metric here to make it automatically refreshable by the Goals API. */
const METRIC_RESOLVERS: Record<GoalMetric, MetricResolver> = {
  stars: {
    async resolve(repository) {
      const result = await getReposCached(false);
      return result.ok ? result.repos.find((repo) => repo.nameWithOwner === repository)?.stargazerCount ?? null : null;
    },
  },
  forks: {
    async resolve(repository) {
      const result = await getReposCached(false);
      return result.ok ? result.repos.find((repo) => repo.nameWithOwner === repository)?.forkCount ?? null : null;
    },
  },
  closed_prs: {
    async resolve(repository) {
      const query = encodeURIComponent(`repo:${repository} is:pr is:closed`);
      const result = await ghApiJson(`/search/issues?q=${query}&per_page=1`);
      return result.ok ? Number((result.data as { total_count?: number }).total_count ?? 0) : null;
    },
  },
  downloads: {
    async resolve(repository) {
      const result = await restApiPaginate(`/repos/${repository}/releases?per_page=100`);
      if (!result.ok) return null;
      return (result.data as Array<{ assets?: Array<{ download_count?: number }> }>).reduce(
        (total, release) => total + (release.assets ?? []).reduce((sum, asset) => sum + (asset.download_count ?? 0), 0),
        0,
      );
    },
  },
};

export async function refreshGoal(goal: Omit<RepositoryGoal, "aiEnabled">): Promise<Omit<RepositoryGoal, "aiEnabled">> {
  try {
    const currentValue = await METRIC_RESOLVERS[goal.metric].resolve(goal.repository);
    if (currentValue === null || currentValue === goal.currentValue) return goal;
    updateGoalCurrentValue(goal.accountId, goal.id, currentValue);
    return { ...goal, currentValue, updatedAt: new Date().toISOString() };
  } catch {
    return goal;
  }
}

function fallbackSuggestions(goal: Omit<RepositoryGoal, "aiEnabled">): GoalSuggestion[] {
  const progress = calculateGoalProgress(goal);
  return [
    {
      category: "product",
      title: "Turn demand into a visible roadmap",
      action: "Review the most discussed open issues, label the top three requests and publish which one will ship next.",
    },
    {
      category: "community",
      title: "Reduce contribution friction",
      action: "Triage unanswered issues and small PRs, add good-first-issue labels, and document one concrete contribution path.",
    },
    {
      category: "marketing",
      title: "Publish a complete X launch thread",
      action: `Tell the story of ${goal.repository} in a 5–7 post X thread: open with a concrete hook, show what the project solves, highlight recent work, share the ${progress.percentage}% goal progress, and close with one clear call to action.`,
    },
    {
      category: "marketing",
      title: "Build the next campaign from the latest updates",
      action: "Use the latest verified release notes, issue activity, and merged work as the campaign narrative. Explain what changed, why it matters, and invite the community to try it or contribute without claiming that unfinished work has shipped.",
    },
  ];
}

export async function generateGoalSuggestions(goal: Omit<RepositoryGoal, "aiEnabled">): Promise<GoalSuggestion[]> {
  if (!isAiConfigured()) return fallbackSuggestions(goal);
  const [issuesResult, prsResult, reposResult, releases] = await Promise.all([
    getIssuesCached(false),
    getPullRequestsCached(false),
    getReposCached(false),
    fetchReleaseSignals(goal.repository),
  ]);
  const issues = issuesResult.ok ? issuesResult.issues.filter((item) => item.repository.nameWithOwner === goal.repository) : [];
  const prs = prsResult.ok ? prsResult.pullRequests.filter((item) => item.repository.nameWithOwner === goal.repository) : [];
  const repo = reposResult.ok ? reposResult.repos.find((item) => item.nameWithOwner === goal.repository) : null;
  const progress = calculateGoalProgress(goal);
  const staleIssues = issues.filter((item) => Date.now() - new Date(item.updatedAt).getTime() > 30 * 86_400_000).length;

  const result = await generateStructured<{ suggestions: GoalSuggestion[] }>({
    instructions: "Act as an open-source growth and social strategist. Give specific, ethical actions grounded in the supplied activity. Include at least one substantial social campaign idea designed as a complete 5–7 post X thread, not a generic one-line post. Also include one recommendation explicitly based on the latest verified updates (releases, recently updated issues, or pull requests), clearly framing unfinished work as work in progress. Give it a strong hook, a useful narrative arc, concrete project details, and one clear call to action. Return JSON only.",
    input: JSON.stringify({
      repository: goal.repository,
      description: repo?.description,
      metric: goal.metric,
      current: goal.currentValue,
      target: goal.targetValue,
      deadline: goal.deadline,
      percentage: progress.percentage,
      openIssues: issues.length,
      staleIssues,
      openPullRequests: prs.length,
      recentIssues: issues.slice(0, 8).map((item) => ({ title: item.title, updatedAt: item.updatedAt })),
      recentPullRequests: prs.slice(0, 5).map((item) => ({ title: item.title, updatedAt: item.updatedAt })),
      latestReleases: releases.map((release) => ({
        name: release.name || release.tag_name || null,
        publishedAt: release.published_at ?? null,
        notesExcerpt: release.body?.replace(/\s+/g, " ").trim().slice(0, 350) || null,
      })),
    }),
    schemaName: "goal_actions",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggestions: {
          type: "array",
          minItems: 3,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              category: { type: "string", enum: ["product", "community", "engineering", "marketing"] },
              title: { type: "string" },
              action: { type: "string" },
            },
            required: ["category", "title", "action"],
          },
        },
      },
      required: ["suggestions"],
    },
    maxOutputTokens: 900,
  });
  const suggestions = Array.isArray(result.data.suggestions) ? result.data.suggestions : [];
  return suggestions.length ? suggestions : fallbackSuggestions(goal);
}

export const SOCIAL_PROPOSALS_VERSION = 4;
const README_EXCERPT_CHARS = 7000;

interface ReleaseSignal {
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
}

async function fetchReleaseSignals(repository: string): Promise<ReleaseSignal[]> {
  try {
    const result = await restApi<ReleaseSignal[]>(`/repos/${repository}/releases?per_page=3`);
    return result.ok && Array.isArray(result.data) ? result.data.slice(0, 3) : [];
  } catch {
    return [];
  }
}

interface ReadmeSignal {
  excerpt: string;
  mediaUrls: string[];
}

async function fetchReadmeSignal(repository: string): Promise<ReadmeSignal | null> {
  try {
    const result = await restApi<{ content?: string; encoding?: string; download_url?: string | null }>(`/repos/${repository}/readme`);
    if (!result.ok || !result.data?.content) return null;
    const text = result.data.encoding === "base64" ? Buffer.from(result.data.content, "base64").toString("utf-8") : result.data.content;
    return {
      excerpt: text.replace(/\r/g, "").trim().slice(0, README_EXCERPT_CHARS),
      mediaUrls: extractMediaUrls(text, result.data.download_url),
    };
  } catch {
    return null;
  }
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:") && isPrivateAddress(normalized.slice(7));
}

async function assertPublicWebsite(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("unsupported source URL");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) throw new Error("private source URL");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("private source URL");
}

async function readBoundedText(response: Response, maxBytes = 600_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); break; }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchWebsiteSignal(value: string): Promise<unknown> {
  try {
    let url = new URL(value);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await assertPublicWebsite(url);
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(7_000),
        headers: { Accept: "text/html,text/plain,image/*,video/*", "User-Agent": "GitDeck/1.0 source-reader" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new Error("too many source redirects");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`source returned ${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.startsWith("image/") || contentType.startsWith("video/")) {
        return { type: "website", url: value, title: null, excerpt: null, mediaUrls: [url.toString()] };
      }
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("unsupported source content");
      const page = extractWebPageSignal(await readBoundedText(response), url.toString());
      return { type: "website", url: value, title: page.title, excerpt: page.excerpt, mediaUrls: page.mediaUrls };
    }
  } catch (error) {
    return { type: "website", url: value, error: (error as Error).message };
  }
  return { type: "website", url: value, error: "source unavailable" };
}

async function fetchAdditionalSourceSignals(sources: GoalContentSource[]): Promise<unknown[]> {
  return Promise.all(sources.map(async (source) => {
    if (source.type === "website") return fetchWebsiteSignal(source.value);
    const [readme, releases] = await Promise.all([
      fetchReadmeSignal(source.value),
      fetchReleaseSignals(source.value),
    ]);
    return {
      type: source.type,
      repository: source.value,
      readmeExcerpt: readme?.excerpt ?? null,
      mediaUrls: readme?.mediaUrls ?? [],
      releases: releases.map((release) => ({
        name: release.name || release.tag_name || null,
        url: release.html_url ?? null,
        publishedAt: release.published_at ?? null,
        notesExcerpt: release.body?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      })),
    };
  }));
}

/**
 * Turns one recommended action into concrete, ready-to-use deliverables
 * (posts, issue drafts, checklists…) grounded in the repository's README and
 * current activity. Requires a configured AI provider.
 */
export async function generateGoalProposals(
  goal: Omit<RepositoryGoal, "aiEnabled">,
  suggestion: GoalSuggestion,
  sources: GoalContentSource[] = [],
): Promise<GoalProposal[]> {
  if (!isAiConfigured()) throw new AiNotConfiguredError();
  const [issuesResult, prsResult, reposResult, readme, releases, additionalSources] = await Promise.all([
    getIssuesCached(false),
    getPullRequestsCached(false),
    getReposCached(false),
    fetchReadmeSignal(goal.repository),
    fetchReleaseSignals(goal.repository),
    fetchAdditionalSourceSignals(sources),
  ]);
  const issues = issuesResult.ok ? issuesResult.issues.filter((item) => item.repository.nameWithOwner === goal.repository) : [];
  const prs = prsResult.ok ? prsResult.pullRequests.filter((item) => item.repository.nameWithOwner === goal.repository) : [];
  const repo = reposResult.ok ? reposResult.repos.find((item) => item.nameWithOwner === goal.repository) : null;
  const progress = calculateGoalProgress(goal);

  const context = {
    generatedOn: new Date().toISOString().slice(0, 10),
    repository: goal.repository,
    repositoryUrl: repo?.url ?? null,
    visibility: repo?.visibility ?? null,
    description: repo?.description ?? null,
    primaryLanguage: repo?.primaryLanguage?.name ?? null,
    verifiedMetrics: { stars: repo?.stargazerCount ?? null, forks: repo?.forkCount ?? null },
    goal: { metric: goal.metric, current: goal.currentValue, target: goal.targetValue, deadline: goal.deadline, percentage: progress.percentage },
    recommendedAngle: { category: suggestion.category, title: suggestion.title, description: suggestion.action },
    openIssues: issues.slice(0, 10).map((item) => ({ title: item.title, url: item.url, updatedAt: item.updatedAt, labels: item.labels.map((label) => label.name) })),
    openPullRequests: prs.slice(0, 6).map((item) => ({ title: item.title, url: item.url, updatedAt: item.updatedAt, isDraft: item.isDraft })),
    releases: releases.map((release) => ({
      name: release.name || release.tag_name || null,
      url: release.html_url ?? null,
      publishedAt: release.published_at ?? null,
      notesExcerpt: release.body?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
    })),
    readmeExcerpt: readme?.excerpt ?? null,
    repositoryMediaUrls: readme?.mediaUrls ?? [],
    additionalSources,
  };
  const instructions = [
    "You are a senior open-source social strategist. Create publishable social copy, not an operational plan.",
    "Choose one clear, credible campaign angle from the recommended action and adapt it to each platform and its audience. Use relevant facts and terminology from the fixed project source library, including website excerpts and release notes, rather than using sources only as visual references.",
    "Use only facts explicitly present in the input. Never invent users, benefits, benchmarks, quotes, release recency, roadmap commitments, or issue status. Treat issue and PR titles only as themes, not proof that work shipped. If evidence is thin, write a transparent invitation to try or contribute rather than making a claim.",
    "Write in the main natural language of the README (English if unclear). Keep the project's own terminology and avoid generic AI phrases, hype, clickbait, fake urgency, and engagement bait.",
    "Return exactly three distinct assets: one 'x-thread', one 'linkedin-post', and one 'mastodon-post'. Each must work standalone and include the supplied repository URL when it is public and available.",
    "The X thread needs 5–7 ordered posts in threadPosts, each at most 280 Unicode characters. Build a coherent arc: specific hook, problem, project approach, one or two verified details, then one relevant CTA in the final post. Use at most two hashtags across the whole thread. Set content to the same posts in order.",
    "The LinkedIn post should be 700–1400 characters when the evidence supports it, use short paragraphs, speak to a professional technical audience, and use at most three hashtags. Do not imitate X-thread fragments.",
    "The Mastodon post must be at most 500 characters, direct and community-oriented, with at most two relevant hashtags and no engagement bait.",
    "For both standalone posts threadPosts must be empty. Give each asset a concrete title. In summary, state the intended audience and the evidence-led angle in one sentence.",
    "For every asset choose one or two concrete mediaUrls from the repository or project source library when available. Different posts may use different assets from that fixed library. Put only an actual image or video URL in mediaSuggestions.sourceUrl: never use a page URL and never fabricate a URL. State exactly how the attached asset supports that specific post, and remind the user to verify reuse rights when the source is external. Output JSON only.",
  ].join(" ");
  const schema = {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      proposals: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            format: { type: "string", enum: [...SOCIAL_PROPOSAL_FORMATS] },
            summary: { type: "string" },
            content: { type: "string" },
            threadPosts: { type: "array", minItems: 0, maxItems: 7, items: { type: "string", maxLength: 280 } },
            mediaSuggestions: {
              type: "array", minItems: 0, maxItems: 2,
              items: {
                type: "object", additionalProperties: false,
                properties: {
                  kind: { type: "string", enum: ["image", "video"] },
                  title: { type: "string" },
                  sourceUrl: { type: "string" },
                  guidance: { type: "string" },
                },
                required: ["kind", "title", "sourceUrl", "guidance"],
              },
            },
          },
          required: ["title", "format", "summary", "content", "threadPosts", "mediaSuggestions"],
        },
      },
    },
    required: ["proposals"],
  };

  let feedback: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await generateStructured<{ proposals: GoalProposal[] }>({
      instructions,
      input: JSON.stringify({ ...context, validationFeedback: feedback }),
      schemaName: "social_goal_proposals",
      schema,
      maxOutputTokens: 3600,
    });
    const proposals = normalizeSocialProposals(result.data.proposals);
    const sourceMedia = [
      ...(readme?.mediaUrls ?? []),
      ...additionalSources.flatMap((source) => {
        if (!source || typeof source !== "object") return [];
        const mediaUrls = (source as { mediaUrls?: unknown }).mediaUrls;
        return Array.isArray(mediaUrls) ? mediaUrls.filter((url): url is string => typeof url === "string") : [];
      }),
    ];
    if (proposals.length === 3 && hasCompleteSocialSet(proposals)) return attachSourceMedia(proposals, sourceMedia);
    feedback = "The previous answer was not publishable. Return all three required formats exactly once; use 5–7 X posts of at most 280 characters, LinkedIn content of at most 3000 characters, and Mastodon content of at most 500 characters.";
  }
  throw new AiRequestError("AI returned incomplete or platform-invalid social proposals");
}
