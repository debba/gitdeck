import type { PullRequestCheckStatus, PullRequestHeadCheck } from "../types/github";

export interface GitHubCheckRunNode {
  __typename?: "CheckRun";
  status?: string | null;
  conclusion?: string | null;
}

export interface GitHubStatusContextNode {
  __typename?: "StatusContext";
  state?: string | null;
}

export type GitHubStatusCheckNode = GitHubCheckRunNode | GitHubStatusContextNode;

/** Combined commit status and check runs for a pull request head. */
export interface GitHubStatusCheckRollup {
  state?: string | null;
  contexts?: { nodes?: Array<GitHubStatusCheckNode | null> | null } | null;
}

type CheckBucket = PullRequestCheckStatus;

interface CheckSummary {
  total: number;
  success: number;
  failed: number;
  running: number;
  pending: number;
  canceled: number;
  skipped: number;
}

function token(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function bucketCheckRun(status: string, conclusion: string): CheckBucket | null {
  if (status === "IN_PROGRESS" || status === "QUEUED") return "running";
  if (status === "PENDING" || status === "WAITING" || status === "REQUESTED") return "pending";
  switch (conclusion) {
    case "SUCCESS":
    case "NEUTRAL":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
    case "ACTION_REQUIRED":
    case "STALE":
      return "failed";
    case "CANCELLED":
      return "canceled";
    case "SKIPPED":
      return "skipped";
    default:
      return status === "COMPLETED" ? null : null;
  }
}

function bucketStatusContext(state: string): CheckBucket | null {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failed";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return null;
  }
}

function isStatusContext(node: GitHubStatusCheckNode): node is GitHubStatusContextNode {
  return node.__typename === "StatusContext" || ("state" in node && !("status" in node) && !("conclusion" in node));
}

function bucketNode(node: GitHubStatusCheckNode): CheckBucket | null {
  if (isStatusContext(node)) return bucketStatusContext(token(node.state));
  return bucketCheckRun(token(node.status), token(node.conclusion));
}

function summarize(nodes: readonly GitHubStatusCheckNode[]): CheckSummary {
  const summary: CheckSummary = { total: 0, success: 0, failed: 0, running: 0, pending: 0, canceled: 0, skipped: 0 };
  for (const node of nodes) {
    const bucket = bucketNode(node);
    if (!bucket || bucket === "manual") continue;
    summary.total += 1;
    summary[bucket] += 1;
  }
  return summary;
}

function mapRollupState(state: string | null | undefined): PullRequestCheckStatus | null {
  switch (token(state)) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failed";
    case "PENDING":
      return "pending";
    case "EXPECTED":
      return "pending";
    default:
      return null;
  }
}

function fallbackStatus(summary: CheckSummary): PullRequestCheckStatus | null {
  if (!summary.total) return null;
  if (summary.failed) return "failed";
  if (summary.running) return "running";
  if (summary.pending) return "pending";
  if (summary.skipped === summary.total) return "skipped";
  if (summary.canceled === summary.total) return "canceled";
  if (summary.success) return "success";
  return null;
}

/** Checks tab for a pull request, including GitHub Enterprise hosts already present on the PR URL. */
export function githubChecksUrl(pullRequestUrl: string): string | null {
  const trimmed = pullRequestUrl.trim();
  if (!trimmed) return null;
  return `${trimmed.replace(/\/+$/, "")}/checks`;
}

/**
 * Maps GitHub's combined `statusCheckRollup` onto the shared pull request badge.
 * The rollup state is the combined commit status and check runs. Contexts only
 * distinguish a running rollup from a pending one, and an all-skipped or
 * all-canceled head from a plain success.
 */
export function mapGitHubStatusCheckRollup(
  rollup: GitHubStatusCheckRollup | null | undefined,
  pullRequestUrl: string,
): PullRequestHeadCheck | null {
  if (!rollup) return null;
  const nodes = (rollup.contexts?.nodes ?? []).filter((node): node is GitHubStatusCheckNode => Boolean(node));
  const summary = summarize(nodes);
  let status = mapRollupState(rollup.state);
  if (summary.total && !summary.failed && !summary.running && !summary.pending && !summary.success) {
    if (summary.skipped === summary.total) status = "skipped";
    else if (summary.canceled === summary.total) status = "canceled";
  } else if (status === "pending" && summary.running > 0) {
    status = "running";
  } else if (!status) {
    status = fallbackStatus(summary);
  }
  if (!status) return null;
  return { status, url: githubChecksUrl(pullRequestUrl) };
}

/** True when a checks lookup should be dropped and the pull request list kept. */
export function githubCheckStatusUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? Number((error as { status?: number }).status) : NaN;
  if (status === 403 || status === 429) return true;
  const message = error instanceof Error ? error.message : "";
  return /rate limit|secondary rate|abuse detection|forbidden|not accessible/i.test(message);
}
