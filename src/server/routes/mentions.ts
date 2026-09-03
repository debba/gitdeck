import { buildMentionQuery, isValidRepoName } from "../../utils/aliasQuery";
import { EMPTY_DEPENDENTS_PAGE, parseDependentsHtml } from "../../utils/dependents";
import { nameWithOwnerFromApiUrl } from "../../utils/repository";
import { addAlias, getAliases, removeAlias } from "../aliasStore";
import { getToken, ghApiJson, restApi } from "../githubClient";
import { parseJsonBody, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import { requireRepo, sendError } from "./shared";

interface RestIssueSearchItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  pull_request?: unknown;
  user?: { login: string; html_url: string };
  repository_url: string;
  created_at: string;
  updated_at: string;
}

interface RestCodeSearchItem {
  path: string;
  html_url: string;
  repository: { full_name: string };
}

/** Runs a GitHub search for the repo and its aliases, dropping hits inside the repo itself. */
async function searchMentions<TItem, TOut extends { repository: { nameWithOwner: string } }>(
  ctx: RouteContext,
  endpoint: "issues" | "code",
  map: (item: TItem) => TOut,
): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  const aliases = await getAliases(repo);
  const selfNames = new Set([repo, ...aliases]);
  const query = buildMentionQuery(repo, aliases);
  const result = await restApi<{ items: TItem[] }>(`/search/${endpoint}?q=${encodeURIComponent(query)}&per_page=100`);
  if (!result.ok) {
    if (result.status === 401) return sendJson(ctx.res, 401, { ok: false, error: "authentication required", needsAuth: true });
    return sendJson(ctx.res, 500, { ok: false, error: result.error });
  }
  const items = (result.data.items ?? []).map(map).filter((entry) => !selfNames.has(entry.repository.nameWithOwner));
  sendJson(ctx.res, 200, { ok: true, items, totalCount: items.length, aliases });
}

function issues(ctx: RouteContext): Promise<void> {
  return searchMentions<RestIssueSearchItem, ReturnType<typeof toIssue>>(ctx, "issues", toIssue);
}

function toIssue(entry: RestIssueSearchItem) {
  return {
    repository: { nameWithOwner: nameWithOwnerFromApiUrl(entry.repository_url) },
    title: entry.title,
    url: entry.html_url,
    number: entry.number,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    state: entry.state,
    isPullRequest: Boolean(entry.pull_request),
    author: entry.user ? { login: entry.user.login, url: entry.user.html_url } : undefined,
  };
}

function code(ctx: RouteContext): Promise<void> {
  return searchMentions<RestCodeSearchItem, ReturnType<typeof toCodeHit>>(ctx, "code", toCodeHit);
}

function toCodeHit(entry: RestCodeSearchItem) {
  return {
    repository: { nameWithOwner: entry.repository.full_name },
    path: entry.path,
    url: entry.html_url,
  };
}

async function referrers(ctx: RouteContext): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  const [refs, paths, views, clones] = await Promise.all([
    ghApiJson(`/repos/${repo}/traffic/popular/referrers`),
    ghApiJson(`/repos/${repo}/traffic/popular/paths`),
    ghApiJson(`/repos/${repo}/traffic/views`),
    ghApiJson(`/repos/${repo}/traffic/clones`),
  ]);
  // Access denied / not owner: all four typically fail with 403. Report it as a structured reason.
  const anyForbidden = [refs, paths, views, clones].some(
    (r) => !r.ok && (r.status === 403 || /403|forbidden/i.test(r.error)),
  );
  sendJson(ctx.res, 200, {
    ok: true,
    forbidden: anyForbidden,
    referrers: refs.ok ? refs.data : [],
    paths: paths.ok ? paths.data : [],
    views: views.ok ? views.data : null,
    clones: clones.ok ? clones.data : null,
  });
}

async function dependents(ctx: RouteContext): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  const { searchParams } = ctx.url;
  const type = (searchParams.get("type") || "REPOSITORY").toUpperCase();
  if (type !== "REPOSITORY" && type !== "PACKAGE") {
    return sendJson(ctx.res, 400, { ok: false, error: "invalid type" });
  }
  try {
    const params = new URLSearchParams({ dependent_type: type });
    const after = searchParams.get("after");
    const before = searchParams.get("before");
    if (after) params.set("dependents_after", after);
    if (before) params.set("dependents_before", before);
    const token = await getToken().catch(() => "");
    const resp = await fetch(`https://github.com/${repo}/network/dependents?${params.toString()}`, {
      headers: {
        "User-Agent": "gitdeck/1.0 (+local)",
        "Accept": "text/html",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      },
      redirect: "follow",
    });
    if (resp.status === 404) return sendJson(ctx.res, 200, { ok: true, ...EMPTY_DEPENDENTS_PAGE });
    if (!resp.ok) return sendJson(ctx.res, 502, { ok: false, error: `GitHub returned HTTP ${resp.status}` });
    sendJson(ctx.res, 200, { ok: true, type, ...parseDependentsHtml(await resp.text()) });
  } catch (error) {
    sendError(ctx, error);
  }
}

async function listAliases(ctx: RouteContext): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  sendJson(ctx.res, 200, { ok: true, aliases: await getAliases(repo) });
}

async function createAlias(ctx: RouteContext): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  const parsed = await parseJsonBody<{ alias?: string }>(ctx.req, ctx.res);
  if (!parsed) return;
  const alias = (parsed.alias || "").trim();
  if (!isValidRepoName(alias)) return sendJson(ctx.res, 400, { ok: false, error: "alias must be in 'owner/repo' format" });
  if (alias === repo) return sendJson(ctx.res, 400, { ok: false, error: "alias cannot equal the repository name" });
  sendJson(ctx.res, 200, { ok: true, aliases: await addAlias(repo, alias) });
}

async function deleteAlias(ctx: RouteContext): Promise<void> {
  const repo = requireRepo(ctx);
  if (!repo) return;
  const alias = (ctx.url.searchParams.get("alias") || "").trim();
  if (!alias) return sendJson(ctx.res, 400, { ok: false, error: "missing alias" });
  sendJson(ctx.res, 200, { ok: true, aliases: await removeAlias(repo, alias) });
}

export function registerMentionRoutes(router: AppRouter): void {
  router.get("/api/mentions/issues", issues);
  router.get("/api/mentions/code", code);
  router.get("/api/mentions/referrers", referrers);
  router.get("/api/mentions/dependents", dependents);
  router.get("/api/repo-aliases", listAliases);
  router.post("/api/repo-aliases", createAlias);
  router.delete("/api/repo-aliases", deleteAlias);
}
