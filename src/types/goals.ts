/** Add display metadata here; the metric type and creation UI update automatically. */
export const GOAL_METRIC_DEFINITIONS = [
  { id: "stars", label: "Stars" },
  { id: "forks", label: "Forks" },
  { id: "closed_prs", label: "Closed PRs" },
  { id: "downloads", label: "Release downloads" },
] as const;

export type GoalMetric = typeof GOAL_METRIC_DEFINITIONS[number]["id"];
export const GOAL_METRICS: readonly GoalMetric[] = GOAL_METRIC_DEFINITIONS.map((metric) => metric.id);

export const GOAL_PROPOSAL_FORMATS = ["x-thread", "linkedin-post", "mastodon-post", "post", "issue", "discussion", "email", "checklist", "message", "doc"] as const;
export type GoalProposalFormat = (typeof GOAL_PROPOSAL_FORMATS)[number];

export type GoalContentSource =
  | { type: "repository"; value: string }
  | { type: "website"; value: string };

export interface GoalMediaSuggestion {
  kind: "image" | "video";
  title: string;
  /** A concrete asset URL, or the source page where it can be found. */
  sourceUrl: string;
  guidance: string;
}

/** A ready-to-use deliverable that carries out one recommended action. */
export interface GoalProposal {
  title: string;
  format: GoalProposalFormat;
  summary: string;
  /** Markdown text the user can copy and publish or adapt. */
  content: string;
  /** Complete, ordered X posts. Present when format is `x-thread`. */
  threadPosts?: string[];
  /** Visual assets that can accompany this platform-specific draft. */
  mediaSuggestions?: GoalMediaSuggestion[];
}

export interface GoalSuggestion {
  title: string;
  action: string;
  category: "product" | "community" | "engineering" | "marketing";
  proposals?: GoalProposal[];
  proposalsGeneratedAt?: string | null;
  /** Generation strategy version, used to invalidate obsolete cached drafts. */
  proposalsVersion?: number;
}

export interface GoalProposalsData {
  ok: true;
  proposals: GoalProposal[];
  generatedAt: string;
  cached: boolean;
}

export interface RepositoryGoal {
  id: string;
  accountId: string;
  repository: string;
  metric: GoalMetric;
  targetValue: number;
  currentValue: number;
  deadline: string;
  createdAt: string;
  updatedAt: string;
  suggestions: GoalSuggestion[];
  suggestionsGeneratedAt: string | null;
  aiEnabled: boolean;
}

export interface GoalsData {
  ok: true;
  goals: RepositoryGoal[];
}
