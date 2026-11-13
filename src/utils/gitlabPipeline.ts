import type { PullRequestCheckStatus, PullRequestHeadCheck } from "../types/github";

export type { PullRequestCheckStatus, PullRequestHeadCheck };

export interface GitLabPipelineRef {
  id?: number | null;
  status?: string | null;
  web_url?: string | null;
  sha?: string | null;
  ref?: string | null;
}

const STATUS_MAP: Record<string, PullRequestCheckStatus> = {
  success: "success",
  failed: "failed",
  running: "running",
  pending: "pending",
  created: "pending",
  waiting_for_resource: "pending",
  preparing: "pending",
  scheduled: "pending",
  canceled: "canceled",
  canceling: "canceled",
  skipped: "skipped",
  manual: "manual",
};

export function mapGitLabPipelineStatus(status: string | null | undefined): PullRequestCheckStatus | null {
  if (!status) return null;
  return STATUS_MAP[status.trim().toLowerCase()] ?? null;
}

/**
 * Resolves a pipeline link for a GitLab instance.
 * Prefers the absolute `web_url` GitLab returns (correct for self-hosted hosts and relative installs).
 * Falls back to `{webUrl}/{projectPath}/-/pipelines/{id}` when the payload only has an id.
 */
export function gitLabPipelineUrl(
  webUrl: string,
  projectPath: string,
  pipeline: Pick<GitLabPipelineRef, "id" | "web_url">,
): string | null {
  const explicit = pipeline.web_url?.trim();
  if (explicit) {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(explicit)) return explicit;
    const base = webUrl.replace(/\/+$/, "");
    return `${base}${explicit.startsWith("/") ? explicit : `/${explicit}`}`;
  }
  if (!pipeline.id || !projectPath.trim()) return null;
  const base = webUrl.replace(/\/+$/, "");
  const path = projectPath.replace(/^\/+|\/+$/g, "");
  return `${base}/${path}/-/pipelines/${pipeline.id}`;
}

export function mapGitLabHeadPipeline(
  pipeline: GitLabPipelineRef | null | undefined,
  webUrl: string,
  projectPath: string,
): PullRequestHeadCheck | null {
  if (!pipeline) return null;
  const status = mapGitLabPipelineStatus(pipeline.status);
  if (!status) return null;
  return { status, url: gitLabPipelineUrl(webUrl, projectPath, pipeline) };
}

/**
 * Picks the latest head pipeline from a project pipeline list ordered newest-first.
 * A SHA match is the pipeline for the merge request head commit. The newest pipeline
 * on the source branch is the fallback when that commit is not in the page.
 */
export function pickGitLabHeadPipeline<T extends GitLabPipelineRef>(
  pipelines: readonly T[],
  headSha: string | null | undefined,
  sourceBranch: string | null | undefined,
): T | null {
  const usable = pipelines.filter((pipeline) => mapGitLabPipelineStatus(pipeline.status));
  if (headSha) {
    const bySha = usable.find((pipeline) => pipeline.sha === headSha);
    if (bySha) return bySha;
  }
  if (sourceBranch) {
    const byRef = usable.find((pipeline) => pipeline.ref === sourceBranch);
    if (byRef) return byRef;
  }
  return null;
}
