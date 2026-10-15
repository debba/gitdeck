import type { RepoSecuritySummary } from "../../types/github";
import { normalizeContentSources } from "../../utils/socialProposals";
import { getActive as getActiveAccount } from "../accountStore";
import { ghApiJson, gql, restApiPaginate, type RestResult } from "../githubClient";
import { getRepositoryContentSources, saveRepositoryContentSources } from "../goalStore";
import { getLatestRepoDigest } from "../digests";
import {
  BRANCHES_QUERY,
  DEFAULT_BRANCH_QUERY,
  DISCUSSIONS_QUERY,
  FORKS_QUERY,
  REPO_COUNTS_QUERY,
  STARGAZERS_QUERY,
} from "../graphql/repositoryQueries";
import { parseJsonBody, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import { fetchRepoSecuritySummary } from "../securityAlerts";
import { requireRepo, requireRepoParts, sendError } from "./shared";

const ALLOWED_DIRECTIONS = new Set(["DESC", "ASC"]);
const ALLOWED_FORK_FIELDS = new Set(["PUSHED_AT", "UPDATED_AT", "CREATED_AT", "STARGAZERS", "NAME"]);
const REPO_DETAIL_SECTIONS = new Set(["overview", "actions", "commits", "milestones", "releases", "traffic", "minimal"]);

interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

function readDirection(ctx: RouteContext): string | null {
  const direction = (ctx.url.searchParams.get("direction") || "DESC").toUpperCase();
  if (ALLOWED_DIRECTIONS.has(direction)) return direction;
  sendJson(ctx.res, 400, { ok: false, error: "invalid direction" });
  return null;
}

async function stargazers(ctx: RouteContext): Promise<void> {
  const rp = requireRepoParts(ctx);
  if (!rp) return;
  const direction = readDirection(ctx);
  if (!direction) return;
  const cursor = ctx.url.searchParams.get("cursor") || null;
  try {
    const data = await gql<{
      repository: {
        stargazers: {
          totalCount: number;
          pageInfo: PageInfo;
          edges: { starredAt: string; node: { login: string; avatarUrl: string; url: string } }[];
        };
      };
    }>(STARGAZERS_QUERY, { owner: rp[0], name: rp[1], cursor, direction });
    sendJson(ctx.res, 200, { ok: true, ...data.repository.stargazers });
  } catch (error) {
    sendError(ctx, error);
  }
}

async function forks(ctx: RouteContext): Promise<void> {
  const rp = requireRepoParts(ctx);
  if (!rp) return;
  const direction = readDirection(ctx);
  if (!direction) return;
  const field = (ctx.url.searchParams.get("field") || "PUSHED_AT").toUpperCase();
  if (!ALLOWED_FORK_FIELDS.has(field)) return sendJson(ctx.res, 400, { ok: false, error: "invalid field" });
  const cursor = ctx.url.searchParams.get("cursor") || null;
  try {
    const data = await gql<{
      repository: {
        forks: {
          totalCount: number;
          pageInfo: PageInfo;
          nodes: {
            nameWithOwner: string;
            owner: { login: string; avatarUrl: string };
            stargazerCount: number;
            forkCount: number;
            pushedAt: string;
            updatedAt: string;
            createdAt: string;
            url: string;
            description: string | null;
            primaryLanguage: { name: string } | null;
          }[];
        };
      };
    }>(FORKS_QUERY, { owner: rp[0], name: rp[1], cursor, direction, field });
    sendJson(ctx.res, 200, { ok: true, ...data.repository.forks });
  } catch (error) {
    sendError(ctx, error);
  }
}

async function branches(ctx: RouteContext): Promise<void> {
  const rp = requireRepoParts(ctx);
  if (!rp) return;
  try {
    const head = await gql<{ repository: { defaultBranchRef: { name: string } | null } }>(
      DEFAULT_BRANCH_QUERY,
      { owner: rp[0], name: rp[1] },
    );
    const defaultRef = head.repository.defaultBranchRef?.name;
    if (!defaultRef) return sendJson(ctx.res, 200, { ok: true, totalCount: 0, defaultBranch: null, branches: [] });
    const data = await gql<{
      repository: {
        refs: {
          totalCount: number;
          nodes: {
            name: string;
            target: { committedDate?: string; author?: { name: string | null; user: { login: string } | null } } | null;
            compare: { aheadBy: number; behindBy: number } | null;
          }[];
        };
      };
    }>(BRANCHES_QUERY, { owner: rp[0], name: rp[1], defaultRef });
    const list = data.repository.refs.nodes.map((node) => ({
      name: node.name,
      committedDate: node.target?.committedDate ?? null,
      author: node.target?.author?.user?.login || node.target?.author?.name || null,
      // compare uses the branch as base and the default branch as head, so the
      // perspective is inverted relative to "branch vs default".
      aheadOfDefault: node.compare?.behindBy ?? null,
      behindDefault: node.compare?.aheadBy ?? null,
      isDefault: node.name === defaultRef,
    }));
    list.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return (b.committedDate || "").localeCompare(a.committedDate || "");
    });
    sendJson(ctx.res, 200, { ok: true, totalCount: data.repository.refs.totalCount, defaultBranch: defaultRef, branches: list });
  } catch (error) {
    sendError(ctx, error);
  }
}

async function discussions(ctx: RouteContext): Promise<void> {
  const rp = requireRepoParts(ctx);
  if (!rp) return;
  try {
    const data = await gql<{
      repository: {
        hasDiscussionsEnabled: boolean;
        discussions: {
          totalCount: number;
          nodes: {
            title: string;
            url: string;
            createdAt: string;
            updatedAt: string;
            isAnswered: boolean | null;
            author: { login: string; avatarUrl: string } | null;
            category: { name: string } | null;
            comments: { totalCount: number };
          }[];
        };
      };
    }>(DISCUSSIONS_QUERY, { owner: rp[0], name: rp[1] });
    sendJson(ctx.res, 200, {
      ok: true,
      enabled: data.repository.hasDiscussionsEnabled,
      totalCount: data.repository.discussions.totalCount,
      discussions: data.repository.discussions.nodes.map((node) => ({
        title: node.title,
        url: node.url,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        isAnswered: node.isAnswered ?? false,
        author: node.author?.login ?? null,
        authorAvatar: node.author?.avatarUrl ?? null,
        category: node.category?.name ?? null,
        comments: node.comments.totalCount,
      })),
    });
  } catch (error) {
    sendError(ctx, error);
  }
}

/* ===================== REPO DETAILS ===================== */

const UNAVAILABLE_COUNTS = {
  actions: null,
  branches: null,
  commits: null,
  discussions: null,
  issues: null,
  milestones: null,
  pullRequests: null,
  releases: null,
};

async function fetchRepoCounts(repo: string, rp: [string, string]): Promise<typeof UNAVAILABLE_COUNTS | Record<keyof typeof UNAVAILABLE_COUNTS, number | null>> {
  try {
    const [data, actions] = await Promise.all([
      gql<{
        repository: {
          refs: { totalCount: number } | null;
          discussions: { totalCount: number } | null;
          issues: { totalCount: number };
          pullRequests: { totalCount: number };
          milestones: { totalCount: number };
          releases: { totalCount: number };
          defaultBranchRef: { target: { history?: { totalCount: number } } | null } | null;
        };
      }>(REPO_COUNTS_QUERY, { owner: rp[0], name: rp[1] }),
      ghApiJson(`/repos/${repo}/actions/runs?per_page=1`),
    ]);
    const actionData = actions.ok ? actions.data as { total_count?: number } : null;
    return {
      actions: actionData?.total_count ?? null,
      branches: data.repository.refs?.totalCount ?? null,
      commits: data.repository.defaultBranchRef?.target?.history?.totalCount ?? null,
      discussions: data.repository.discussions?.totalCount ?? null,
      issues: data.repository.issues.totalCount,
      milestones: data.repository.milestones.totalCount,
      pullRequests: data.repository.pullRequests.totalCount,
      releases: data.repository.releases.totalCount,
    };
  } catch {
    return UNAVAILABLE_COUNTS;
  }
}

interface RestRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at?: string | null;
  body?: string | null;
  assets?: Array<{
    id: number;
    name: string;
    download_count: number;
    size?: number;
    browser_download_url?: string;
  }>;
}

function normaliseReleases(releases: RestRelease[] | null | undefined) {
  return (releases ?? []).map((release) => {
    const assets = release.assets ?? [];
    return {
      ...release,
      assets,
      totalDownloads: assets.reduce((sum, asset) => sum + (asset.download_count || 0), 0),
    };
  });
}

async function details(ctx: RouteContext): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  const rp = repo.split("/") as [string, string];
  const requestedSection = ctx.url.searchParams.get("section") ?? "overview";
  const section = REPO_DETAIL_SECTIONS.has(requestedSection) ? requestedSection : "overview";
  const only = <T>(name: string, load: () => Promise<T>, fallback: NoInfer<T>): Promise<T> =>
    section === name ? load() : Promise.resolve(fallback);
  const emptyResult = <T>(data: T): RestResult<T> => ({ ok: true, data });

  const [meta, languages, contributors, commits, workflows, views, releases, repoDigest, security, milestones, community, counts] = await Promise.all([
    ghApiJson(`/repos/${repo}`),
    only("overview", () => ghApiJson(`/repos/${repo}/languages`), emptyResult({})),
    only("overview", () => restApiPaginate(`/repos/${repo}/contributors?per_page=100&anon=1`), emptyResult([])),
    only("commits", () => ghApiJson(`/repos/${repo}/commits?per_page=20`), emptyResult([])),
    only("actions", () => ghApiJson(`/repos/${repo}/actions/runs?per_page=100`), emptyResult({ workflow_runs: [] })),
    only("traffic", () => ghApiJson(`/repos/${repo}/traffic/views`), emptyResult(null)),
    only("releases", () => restApiPaginate(`/repos/${repo}/releases?per_page=100`), emptyResult([])),
    only("overview", () => getLatestRepoDigest(repo), null),
    only<RepoSecuritySummary | null>("overview", () => fetchRepoSecuritySummary(repo), null),
    only("milestones", () => ghApiJson(`/repos/${repo}/milestones?state=open&per_page=100&sort=due_on&direction=asc`), emptyResult([])),
    only("overview", () => ghApiJson(`/repos/${repo}/community/profile`), emptyResult(null)),
    only("minimal", () => fetchRepoCounts(repo, rp), UNAVAILABLE_COUNTS),
  ]);

  sendJson(ctx.res, 200, {
    ok: true,
    meta: meta.ok ? meta.data : null,
    languages: languages.ok ? languages.data : {},
    contributors: contributors.ok ? contributors.data : [],
    views: views.ok ? views.data : null,
    releases: releases.ok ? normaliseReleases(releases.data as RestRelease[] | null) : [],
    security,
    digest: repoDigest,
    commits: commits.ok ? commits.data : [],
    milestones: milestones.ok ? milestones.data : [],
    community: community.ok ? community.data : null,
    counts,
    workflows: workflows.ok
      ? ((workflows.data as { workflow_runs?: unknown[] } | null)?.workflow_runs ?? [])
      : [],
    errors: {
      meta: meta.ok ? null : meta.error,
      languages: languages.ok ? null : languages.error,
      contributors: contributors.ok ? null : contributors.error,
      views: views.ok ? null : views.error,
      releases: releases.ok ? null : releases.error,
      commits: commits.ok ? null : commits.error,
      workflows: workflows.ok ? null : workflows.error,
      milestones: milestones.ok ? null : milestones.error,
      community: community.ok ? null : community.error,
    },
  });
}

async function contentSources(ctx: RouteContext): Promise<void> {
  const account = await getActiveAccount();
  if (!account) return sendJson(ctx.res, 401, { ok: false, needsAuth: true, error: "authentication required" });
  const repository = requireRepo(ctx);
  if (!repository) return;
  if (ctx.req.method === "GET") {
    return sendJson(ctx.res, 200, { ok: true, sources: getRepositoryContentSources(account.id, repository) });
  }
  const body = await parseJsonBody<{ sources?: unknown }>(ctx.req, ctx.res);
  if (!body) return;
  const sources = normalizeContentSources(body.sources);
  saveRepositoryContentSources(account.id, repository, sources);
  sendJson(ctx.res, 200, { ok: true, sources });
}

export function registerRepositoryRoutes(router: AppRouter): void {
  router.get("/api/stargazers", stargazers);
  router.get("/api/forks", forks);
  router.get("/api/repo-branches", branches);
  router.get("/api/repo-discussions", discussions);
  router.get("/api/repo-details", details);
  router.get("/api/repository-content-sources", contentSources);
  router.on("PUT", "/api/repository-content-sources", contentSources);
}
