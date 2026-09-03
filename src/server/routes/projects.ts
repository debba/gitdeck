import { gql } from "../githubClient";
import { CLEAR_FIELD_MUTATION, MOVE_MUTATION, PROJECT_QUERY, PROJECTS_LIST_QUERY } from "../graphql/projectQueries";
import { parseJsonBody, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";

const MAX_PROJECT_ITEMS = 500;

interface ProjectSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription: string | null;
  updatedAt?: string;
  items?: { totalCount: number };
  owner: { __typename: string; login?: string };
}

type RepoNode = { nameWithOwner: string; projectsV2?: { nodes: ProjectSummary[] } };

interface ProjectsListResponse {
  viewer: {
    projectsV2: { nodes: ProjectSummary[] };
    repositories?: { nodes: RepoNode[] };
    organizations: {
      nodes: {
        login: string;
        projectsV2: { nodes: ProjectSummary[] };
        repositories?: { nodes: RepoNode[] };
      }[];
    };
  };
}

interface ProjectResponse {
  node: {
    id: string;
    number: number;
    title: string;
    url: string;
    closed: boolean;
    shortDescription: string | null;
    owner: { __typename: string; login?: string };
    fields: { nodes: unknown[] };
    items: {
      totalCount: number;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      nodes: unknown[];
    };
  } | null;
}

/** Projects v2 errors caused by a missing token scope are reported as 200 + `needsScope`. */
function sendProjectsError(ctx: RouteContext, error: unknown): void {
  const msg = (error as Error).message || String(error);
  if (/scope|permission|not been granted/i.test(msg)) {
    return sendJson(ctx.res, 200, {
      ok: false,
      needsScope: true,
      error:
        "Your gh token lacks Projects v2 permissions.\n" +
        "Run in your terminal: gh auth refresh -h github.com -s project\n" +
        "(or 'read:project' if you only need to view).",
    });
  }
  sendJson(ctx.res, 500, { ok: false, needsScope: false, error: msg });
}

/** Collects open projects visible to the viewer and the repositories each is linked to. */
function collectProjects(data: ProjectsListResponse): Array<ProjectSummary & { linkedRepos: string[] }> {
  const byId = new Map<string, ProjectSummary & { linkedRepos: string[] }>();
  const linkSet = new Map<string, Set<string>>();

  const addProject = (p: ProjectSummary | null | undefined, repoNwo?: string) => {
    if (!p || p.closed) return;
    if (!byId.has(p.id)) byId.set(p.id, { ...p, linkedRepos: [] });
    if (repoNwo) {
      if (!linkSet.has(p.id)) linkSet.set(p.id, new Set());
      linkSet.get(p.id)!.add(repoNwo);
    }
  };
  const addRepoProjects = (repos: RepoNode[] | undefined) => {
    for (const r of repos || []) {
      for (const p of r.projectsV2?.nodes || []) addProject(p, r.nameWithOwner);
    }
  };

  for (const p of data.viewer.projectsV2.nodes || []) addProject(p);
  addRepoProjects(data.viewer.repositories?.nodes);
  for (const org of data.viewer.organizations.nodes || []) {
    for (const p of org.projectsV2?.nodes || []) addProject(p);
    addRepoProjects(org.repositories?.nodes);
  }
  for (const [id, set] of linkSet) {
    const proj = byId.get(id);
    if (proj) proj.linkedRepos = [...set].sort();
  }

  return [...byId.values()].sort((a, b) => {
    const oa = a.owner?.login || "";
    const ob = b.owner?.login || "";
    return oa.localeCompare(ob) || a.title.localeCompare(b.title);
  });
}

async function list(ctx: RouteContext): Promise<void> {
  try {
    const data = await gql<ProjectsListResponse>(PROJECTS_LIST_QUERY, {});
    sendJson(ctx.res, 200, { ok: true, projects: collectProjects(data) });
  } catch (error) {
    sendProjectsError(ctx, error);
  }
}

async function details(ctx: RouteContext): Promise<void> {
  const id = ctx.url.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return sendJson(ctx.res, 400, { ok: false, error: "invalid project id" });
  }
  try {
    let cursor: string | null = null;
    let project: NonNullable<ProjectResponse["node"]> | null = null;
    const allItems: unknown[] = [];
    let totalCount = 0;
    while (true) {
      const resp: ProjectResponse = await gql<ProjectResponse>(PROJECT_QUERY, { id, cursor });
      const page = resp.node;
      if (!page) throw new Error("Project not found");
      project ??= page;
      totalCount = page.items.totalCount;
      allItems.push(...page.items.nodes);
      if (!page.items.pageInfo.hasNextPage || allItems.length >= MAX_PROJECT_ITEMS) break;
      cursor = page.items.pageInfo.endCursor;
    }
    sendJson(ctx.res, 200, {
      ok: true,
      project: {
        id: project.id,
        number: project.number,
        title: project.title,
        url: project.url,
        closed: project.closed,
        shortDescription: project.shortDescription,
        owner: project.owner,
        fields: project.fields.nodes,
        items: allItems,
        totalCount,
        truncated: allItems.length < totalCount,
      },
    });
  } catch (error) {
    sendProjectsError(ctx, error);
  }
}

interface MoveBody {
  projectId?: string;
  itemId?: string;
  fieldId?: string;
  optionId?: string | null;
}

async function move(ctx: RouteContext): Promise<void> {
  const parsed = await parseJsonBody<MoveBody>(ctx.req, ctx.res);
  if (!parsed) return;
  const { projectId, itemId, fieldId } = parsed;
  const optionId = parsed.optionId ?? null;
  if (!projectId || !itemId || !fieldId) {
    return sendJson(ctx.res, 400, { ok: false, error: "missing projectId/itemId/fieldId" });
  }
  try {
    if (optionId) {
      await gql(MOVE_MUTATION, { projectId, itemId, fieldId, optionId });
    } else {
      await gql(CLEAR_FIELD_MUTATION, { projectId, itemId, fieldId });
    }
    sendJson(ctx.res, 200, { ok: true });
  } catch (error) {
    sendProjectsError(ctx, error);
  }
}

export function registerProjectRoutes(router: AppRouter): void {
  router.get("/api/projects", list);
  router.get("/api/project", details);
  router.post("/api/project/move", move);
}
