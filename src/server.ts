import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { nameWithOwnerFromApiUrl, parseRepositoryName } from "./utils/repository";
import { buildMentionQuery, isValidRepoName } from "./utils/aliasQuery";
import { addAlias, getAliases, removeAlias } from "./server/aliasStore";
import { CLIENT_INDEX_PATH, HOST, PORT, SOURCE_INDEX_PATH } from "./server/config";
import {
  getIssuesCached,
  getPullRequestsCached,
  getReposCached,
  invalidateDataCache,
} from "./server/dashboardData";
import { getLatestRepoDigest, handleDailyDigests } from "./server/digests";
import {
  AuthRequiredError,
  getToken,
  ghApiJson,
  gql,
  restApi,
  restApiPaginate,
} from "./server/githubClient";
import {
  authStatus,
  isClientIdConfigured,
  logout,
  pollDeviceFlow,
  startDeviceFlow,
} from "./server/oauth";
import { getAuthMode } from "./server/authProvider";
import {
  add as addAccount,
  getActive as getActiveAccount,
  getProviderConfig,
  init as initAccountStore,
  list as listAccountsStore,
  listProviderConfigs,
  remove as removeAccountStore,
  setActive as setActiveAccount,
} from "./server/accountStore";
import { getProvider, getProviderForAccount } from "./server/providers/registry";
import { send, sendJson, sendJsonCacheable, sendStaticFile } from "./server/http";
import {
  getNotificationsCached,
  invalidateNotificationsCache,
  markAllRead,
  markThreadRead,
} from "./server/notifications";
import { fetchRepoSecuritySummary } from "./server/securityAlerts";
import { handleRepoInsights } from "./server/repoInsights";
import { getCIHealthCached, invalidateCIHealthCache } from "./server/ciHealth";

const STARGAZERS_QUERY = `
query($owner:String!, $name:String!, $cursor:String, $direction:OrderDirection!) {
  repository(owner:$owner, name:$name) {
    stargazers(first:100, after:$cursor, orderBy:{field:STARRED_AT, direction:$direction}) {
      totalCount
      pageInfo { endCursor hasNextPage }
      edges { starredAt node { login avatarUrl url } }
    }
  }
}`;

const FORKS_QUERY = `
query($owner:String!, $name:String!, $cursor:String, $field:RepositoryOrderField!, $direction:OrderDirection!) {
  repository(owner:$owner, name:$name) {
    forks(first:100, after:$cursor, orderBy:{field:$field, direction:$direction}) {
      totalCount
      pageInfo { endCursor hasNextPage }
      nodes {
        nameWithOwner
        owner { login avatarUrl }
        stargazerCount
        forkCount
        pushedAt
        updatedAt
        createdAt
        url
        description
        primaryLanguage { name }
      }
    }
  }
}`;

const REPO_COUNTS_QUERY = `
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    refs(refPrefix:"refs/heads/", first:1) { totalCount }
    discussions(first:1) { totalCount }
  }
}`;

const BRANCHES_QUERY = `
query($owner:String!, $name:String!, $defaultRef:String!) {
  repository(owner:$owner, name:$name) {
    defaultBranchRef { name }
    refs(refPrefix:"refs/heads/", first:100, orderBy:{field:ALPHABETICAL, direction:ASC}) {
      totalCount
      nodes {
        name
        target {
          ... on Commit {
            committedDate
            author { name user { login } }
          }
        }
        compare(headRef:$defaultRef) { aheadBy behindBy }
      }
    }
  }
}`;

const DISCUSSIONS_QUERY = `
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    hasDiscussionsEnabled
    discussions(first:50, orderBy:{field:UPDATED_AT, direction:DESC}) {
      totalCount
      nodes {
        title
        url
        createdAt
        updatedAt
        isAnswered
        author { login avatarUrl }
        category { name }
        comments(first:1) { totalCount }
      }
    }
  }
}`;

const ALLOWED_DIRECTIONS = new Set(["DESC", "ASC"]);
const ALLOWED_FORK_FIELDS = new Set([
  "PUSHED_AT", "UPDATED_AT", "CREATED_AT", "STARGAZERS", "NAME",
]);
function parseRepo(raw: string | null): [string, string] | null {
  return parseRepositoryName(raw);
}

async function handleStargazers(res: ServerResponse, u: URL): Promise<void> {
  const rp = parseRepo(u.searchParams.get("repo"));
  if (!rp) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const direction = (u.searchParams.get("direction") || "DESC").toUpperCase();
  if (!ALLOWED_DIRECTIONS.has(direction)) return sendJson(res, 400, { ok: false, error: "invalid direction" });
  const cursor = u.searchParams.get("cursor") || null;
  try {
    const data = await gql<{
      repository: {
        stargazers: {
          totalCount: number;
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
          edges: { starredAt: string; node: { login: string; avatarUrl: string; url: string } }[];
        };
      };
    }>(STARGAZERS_QUERY, { owner: rp[0], name: rp[1], cursor, direction });
    sendJson(res, 200, { ok: true, ...data.repository.stargazers });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
}

async function handleForks(res: ServerResponse, u: URL): Promise<void> {
  const rp = parseRepo(u.searchParams.get("repo"));
  if (!rp) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const direction = (u.searchParams.get("direction") || "DESC").toUpperCase();
  if (!ALLOWED_DIRECTIONS.has(direction)) return sendJson(res, 400, { ok: false, error: "invalid direction" });
  const field = (u.searchParams.get("field") || "PUSHED_AT").toUpperCase();
  if (!ALLOWED_FORK_FIELDS.has(field)) return sendJson(res, 400, { ok: false, error: "invalid field" });
  const cursor = u.searchParams.get("cursor") || null;
  try {
    const data = await gql<{
      repository: {
        forks: {
          totalCount: number;
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
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
    sendJson(res, 200, { ok: true, ...data.repository.forks });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
}

async function handleRepoBranches(res: ServerResponse, u: URL): Promise<void> {
  const rp = parseRepo(u.searchParams.get("repo"));
  if (!rp) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  try {
    const head = await gql<{ repository: { defaultBranchRef: { name: string } | null } }>(
      `query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { defaultBranchRef { name } } }`,
      { owner: rp[0], name: rp[1] },
    );
    const defaultRef = head.repository.defaultBranchRef?.name;
    if (!defaultRef) return sendJson(res, 200, { ok: true, totalCount: 0, defaultBranch: null, branches: [] });
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
    const branches = data.repository.refs.nodes.map((node) => ({
      name: node.name,
      committedDate: node.target?.committedDate ?? null,
      author: node.target?.author?.user?.login || node.target?.author?.name || null,
      // compare uses the branch as base and the default branch as head, so the
      // perspective is inverted relative to "branch vs default".
      aheadOfDefault: node.compare?.behindBy ?? null,
      behindDefault: node.compare?.aheadBy ?? null,
      isDefault: node.name === defaultRef,
    }));
    branches.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return (b.committedDate || "").localeCompare(a.committedDate || "");
    });
    sendJson(res, 200, { ok: true, totalCount: data.repository.refs.totalCount, defaultBranch: defaultRef, branches });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
}

async function handleRepoDiscussions(res: ServerResponse, u: URL): Promise<void> {
  const rp = parseRepo(u.searchParams.get("repo"));
  if (!rp) return sendJson(res, 400, { ok: false, error: "invalid repo" });
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
    sendJson(res, 200, {
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
  } catch (e) {
    sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
}

/* ===================== MENTIONS ===================== */

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

async function handleMentionIssues(res: ServerResponse, u: URL): Promise<void> {
  const repo = u.searchParams.get("repo");
  if (!parseRepo(repo) || !repo) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const aliases = await getAliases(repo);
  const selfNames = new Set([repo, ...aliases]);
  const query = buildMentionQuery(repo, aliases);
  const path = `/search/issues?q=${encodeURIComponent(query)}&per_page=100`;
  const result = await restApi<{ items: RestIssueSearchItem[] }>(path);
  if (!result.ok) {
    if (result.status === 401) return sendJson(res, 401, { ok: false, error: "authentication required", needsAuth: true });
    return sendJson(res, 500, { ok: false, error: result.error });
  }
  const items = (result.data.items ?? [])
    .map((entry) => ({
      repository: { nameWithOwner: nameWithOwnerFromApiUrl(entry.repository_url) },
      title: entry.title,
      url: entry.html_url,
      number: entry.number,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      state: entry.state,
      isPullRequest: Boolean(entry.pull_request),
      author: entry.user ? { login: entry.user.login, url: entry.user.html_url } : undefined,
    }))
    .filter((entry) => !selfNames.has(entry.repository.nameWithOwner));
  sendJson(res, 200, { ok: true, items, totalCount: items.length, aliases });
}

async function handleMentionCode(res: ServerResponse, u: URL): Promise<void> {
  const repo = u.searchParams.get("repo");
  if (!parseRepo(repo) || !repo) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const aliases = await getAliases(repo);
  const selfNames = new Set([repo, ...aliases]);
  const query = buildMentionQuery(repo, aliases);
  const path = `/search/code?q=${encodeURIComponent(query)}&per_page=100`;
  const result = await restApi<{ items: RestCodeSearchItem[] }>(path);
  if (!result.ok) {
    if (result.status === 401) return sendJson(res, 401, { ok: false, error: "authentication required", needsAuth: true });
    return sendJson(res, 500, { ok: false, error: result.error });
  }
  const items = (result.data.items ?? [])
    .map((entry) => ({
      repository: { nameWithOwner: entry.repository.full_name },
      path: entry.path,
      url: entry.html_url,
    }))
    .filter((entry) => !selfNames.has(entry.repository.nameWithOwner));
  sendJson(res, 200, { ok: true, items, totalCount: items.length, aliases });
}

async function handleRepoAliases(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  const repo = u.searchParams.get("repo");
  if (!parseRepo(repo) || !repo) return sendJson(res, 400, { ok: false, error: "invalid repo" });

  if (req.method === "GET") {
    const aliases = await getAliases(repo);
    return sendJson(res, 200, { ok: true, aliases });
  }

  if (req.method === "POST") {
    let parsed: { alias?: string };
    try { parsed = (await readJsonBody(req)) as { alias?: string }; }
    catch { return sendJson(res, 400, { ok: false, error: "invalid JSON" }); }
    const alias = (parsed.alias || "").trim();
    if (!isValidRepoName(alias)) return sendJson(res, 400, { ok: false, error: "alias must be in 'owner/repo' format" });
    if (alias === repo) return sendJson(res, 400, { ok: false, error: "alias cannot equal the repository name" });
    const aliases = await addAlias(repo, alias);
    return sendJson(res, 200, { ok: true, aliases });
  }

  if (req.method === "DELETE") {
    const alias = (u.searchParams.get("alias") || "").trim();
    if (!alias) return sendJson(res, 400, { ok: false, error: "missing alias" });
    const aliases = await removeAlias(repo, alias);
    return sendJson(res, 200, { ok: true, aliases });
  }

  sendJson(res, 405, { ok: false, error: "method not allowed" });
}

async function handleReferrers(res: ServerResponse, u: URL): Promise<void> {
  const repo = u.searchParams.get("repo");
  if (!parseRepo(repo) || !repo) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const [refs, paths, views, clones] = await Promise.all([
    ghApiJson(`/repos/${repo}/traffic/popular/referrers`),
    ghApiJson(`/repos/${repo}/traffic/popular/paths`),
    ghApiJson(`/repos/${repo}/traffic/views`),
    ghApiJson(`/repos/${repo}/traffic/clones`),
  ]);
  // Access denied / not owner: all four typically fail with 403. Report it as a structured reason.
  const anyForbidden = [refs, paths, views, clones].some(
    (r) => !r.ok && (r.status === 403 || /403|forbidden/i.test(r.error))
  );
  sendJson(res, 200, {
    ok: true,
    forbidden: anyForbidden,
    referrers: refs.ok ? refs.data : [],
    paths: paths.ok ? paths.data : [],
    views: views.ok ? views.data : null,
    clones: clones.ok ? clones.data : null,
  });
}

interface DependentItem {
  owner: string;
  repo: string;
  nameWithOwner: string;
  url: string;
  stars: number;
  forks: number;
  avatar: string;
}

function parseDependentsHtml(html: string): {
  items: DependentItem[];
  totalRepos: number;
  totalPackages: number;
  hasNextPage: boolean;
  nextCursor: string | null;
  hasPrevPage: boolean;
  prevCursor: string | null;
  notAvailable: boolean;
} {
  const notAvailable =
    /We haven(?:'|&#39;)t found any dependents for this repository yet/i.test(html) ||
    /This repository is not used by any other repository/i.test(html);

  const repoCountMatch = /([\d,]+)\s+Repositor(?:y|ies)/.exec(html);
  const pkgCountMatch = /([\d,]+)\s+Packages?/.exec(html);
  const totalRepos = repoCountMatch ? Number(repoCountMatch[1].replace(/,/g, "")) : 0;
  const totalPackages = pkgCountMatch ? Number(pkgCountMatch[1].replace(/,/g, "")) : 0;

  const items: DependentItem[] = [];
  const seen = new Set<string>();
  const rowMarker = '<div class="Box-row d-flex flex-items-center"';
  const pagMarker = 'class="paginate-container"';
  const parts = html.split(rowMarker);
  for (let i = 1; i < parts.length; i++) {
    let chunk = parts[i];
    const pagIdx = chunk.indexOf(pagMarker);
    if (pagIdx >= 0) chunk = chunk.substring(0, pagIdx);

    const repoLinkMatch = /data-hovercard-type="repository"[^>]*href="\/([^"\/]+)\/([^"?#]+)"/.exec(chunk);
    if (!repoLinkMatch) continue;
    const owner = repoLinkMatch[1];
    const repoName = repoLinkMatch[2];
    const nwo = `${owner}/${repoName}`;
    if (seen.has(nwo)) continue;
    seen.add(nwo);

    const starsMatch = /octicon-star[\s\S]{0,2000}?<\/svg>\s*([\d,]+)/.exec(chunk);
    const forksMatch = /octicon-repo-forked[\s\S]{0,2000}?<\/svg>\s*([\d,]+)/.exec(chunk);
    const avatarMatch =
      /<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/.exec(chunk) ||
      /<img[^>]*src="([^"]+)"[^>]*class="[^"]*avatar/.exec(chunk);

    items.push({
      owner,
      repo: repoName,
      nameWithOwner: nwo,
      url: `https://github.com/${nwo}`,
      stars: starsMatch ? Number(starsMatch[1].replace(/,/g, "")) : 0,
      forks: forksMatch ? Number(forksMatch[1].replace(/,/g, "")) : 0,
      avatar: avatarMatch ? avatarMatch[1].replace(/&amp;/g, "&") : "",
    });
  }

  // Pagination: hrefs encode `&` as `&amp;`, so just match the cursor token
  const nextMatch = /href="[^"]*dependents_after=([^"&]+)[^"]*"[^>]*>\s*Next\s*<\/a>/.exec(html);
  const prevMatch = /href="[^"]*dependents_before=([^"&]+)[^"]*"[^>]*>\s*Previous\s*<\/a>/.exec(html);

  return {
    items,
    totalRepos,
    totalPackages,
    hasNextPage: !!nextMatch,
    nextCursor: nextMatch ? nextMatch[1] : null,
    hasPrevPage: !!prevMatch,
    prevCursor: prevMatch ? prevMatch[1] : null,
    notAvailable,
  };
}

async function handleDependents(res: ServerResponse, u: URL): Promise<void> {
  const repo = u.searchParams.get("repo");
  if (!parseRepo(repo) || !repo) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const type = (u.searchParams.get("type") || "REPOSITORY").toUpperCase();
  if (type !== "REPOSITORY" && type !== "PACKAGE") {
    return sendJson(res, 400, { ok: false, error: "invalid type" });
  }
  const after = u.searchParams.get("after") || "";
  const before = u.searchParams.get("before") || "";
  try {
    const params = new URLSearchParams({ dependent_type: type });
    if (after) params.set("dependents_after", after);
    if (before) params.set("dependents_before", before);
    const pageUrl = `https://github.com/${repo}/network/dependents?${params.toString()}`;
    const token = await getToken().catch(() => "");
    const resp = await fetch(pageUrl, {
      headers: {
        "User-Agent": "gitdeck/1.0 (+local)",
        "Accept": "text/html",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      },
      redirect: "follow",
    });
    if (resp.status === 404) {
      return sendJson(res, 200, {
        ok: true, items: [], totalRepos: 0, totalPackages: 0,
        hasNextPage: false, nextCursor: null, hasPrevPage: false, prevCursor: null,
        notAvailable: true,
      });
    }
    if (!resp.ok) return sendJson(res, 502, { ok: false, error: `GitHub returned HTTP ${resp.status}` });
    const html = await resp.text();
    const parsed = parseDependentsHtml(html);
    sendJson(res, 200, { ok: true, type, ...parsed });
  } catch (e: unknown) {
    sendJson(res, 500, { ok: false, error: (e as Error).message || String(e) });
  }
}

/* ===================== PROJECTS V2 ===================== */

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

const PROJECT_SUMMARY_FIELDS = `
  id number title url closed shortDescription updatedAt
  items(first: 1) { totalCount }
  owner { __typename ... on User { login } ... on Organization { login } }
`;

const PROJECTS_LIST_QUERY = `
query {
  viewer {
    projectsV2(first: 50) {
      nodes { ${PROJECT_SUMMARY_FIELDS} }
    }
    repositories(first: 100, ownerAffiliations: [OWNER, COLLABORATOR]) {
      nodes {
        nameWithOwner
        projectsV2(first: 10) {
          nodes { ${PROJECT_SUMMARY_FIELDS} }
        }
      }
    }
    organizations(first: 50) {
      nodes {
        login
        projectsV2(first: 50) {
          nodes { ${PROJECT_SUMMARY_FIELDS} }
        }
        repositories(first: 50) {
          nodes {
            nameWithOwner
            projectsV2(first: 10) {
              nodes { ${PROJECT_SUMMARY_FIELDS} }
            }
          }
        }
      }
    }
  }
}`;

const PROJECT_QUERY = `
query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      id number title url closed shortDescription
      owner { __typename ... on User { login } ... on Organization { login } }
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name color }
          }
          ... on ProjectV2IterationField {
            id name dataType
            configuration { iterations { id title startDate duration } }
          }
        }
      }
      items(first: 100, after: $cursor) {
        totalCount
        pageInfo { endCursor hasNextPage }
        nodes {
          id isArchived type
          content {
            __typename
            ... on Issue {
              id number title url state
              repository { nameWithOwner }
              author { login url }
              labels(first: 10) { nodes { name color description } }
              assignees(first: 5) { nodes { login avatarUrl url } }
              createdAt updatedAt
            }
            ... on PullRequest {
              id number title url state isDraft
              repository { nameWithOwner }
              author { login url }
              labels(first: 10) { nodes { name color description } }
              assignees(first: 5) { nodes { login avatarUrl url } }
              createdAt updatedAt
            }
            ... on DraftIssue {
              id title
              assignees(first: 5) { nodes { login avatarUrl url } }
              createdAt updatedAt
            }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                field { ... on ProjectV2FieldCommon { id name } }
                name optionId
              }
              ... on ProjectV2ItemFieldTextValue {
                field { ... on ProjectV2FieldCommon { id name } }
                text
              }
              ... on ProjectV2ItemFieldNumberValue {
                field { ... on ProjectV2FieldCommon { id name } }
                number
              }
              ... on ProjectV2ItemFieldDateValue {
                field { ... on ProjectV2FieldCommon { id name } }
                date
              }
              ... on ProjectV2ItemFieldIterationValue {
                field { ... on ProjectV2FieldCommon { id name } }
                title iterationId startDate duration
              }
            }
          }
        }
      }
    }
  }
}`;

const MOVE_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}`;

const CLEAR_FIELD_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
  }) { projectV2Item { id } }
}`;

function classifyProjectsError(msg: string): { needsScope: boolean; friendly: string } {
  if (/scope|permission|not been granted/i.test(msg)) {
    return {
      needsScope: true,
      friendly:
        "Your gh token lacks Projects v2 permissions.\n" +
        "Run in your terminal: gh auth refresh -h github.com -s project\n" +
        "(or 'read:project' if you only need to view).",
    };
  }
  return { needsScope: false, friendly: msg };
}

type RepoNode = { nameWithOwner: string; projectsV2?: { nodes: ProjectSummary[] } };

async function handleProjects(res: ServerResponse): Promise<void> {
  try {
    const data = await gql<{
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
    }>(PROJECTS_LIST_QUERY, {});

    // Collect all projects and track which repos each is linked to.
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

    for (const p of data.viewer.projectsV2.nodes || []) addProject(p);
    for (const r of data.viewer.repositories?.nodes || []) {
      for (const p of r.projectsV2?.nodes || []) addProject(p, r.nameWithOwner);
    }
    for (const org of data.viewer.organizations.nodes || []) {
      for (const p of org.projectsV2?.nodes || []) addProject(p);
      for (const r of org.repositories?.nodes || []) {
        for (const p of r.projectsV2?.nodes || []) addProject(p, r.nameWithOwner);
      }
    }

    for (const [id, set] of linkSet) {
      const proj = byId.get(id);
      if (proj) proj.linkedRepos = [...set].sort();
    }

    const all = [...byId.values()].sort((a, b) => {
      const oa = a.owner?.login || "";
      const ob = b.owner?.login || "";
      return oa.localeCompare(ob) || a.title.localeCompare(b.title);
    });
    sendJson(res, 200, { ok: true, projects: all });
  } catch (e: unknown) {
    const msg = (e as Error).message || String(e);
    const { needsScope, friendly } = classifyProjectsError(msg);
    sendJson(res, needsScope ? 200 : 500, { ok: false, needsScope, error: friendly });
  }
}

async function handleProject(res: ServerResponse, u: URL): Promise<void> {
  const id = u.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return sendJson(res, 400, { ok: false, error: "invalid project id" });
  }
  const MAX_ITEMS = 500;
  try {
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
    let cursor: string | null = null;
    let firstResp: ProjectResponse | null = null;
    const allItems: unknown[] = [];
    let totalCount = 0;
    while (true) {
      const resp: ProjectResponse = await gql<ProjectResponse>(PROJECT_QUERY, { id, cursor });
      if (!firstResp) firstResp = resp;
      const p = resp.node;
      if (!p) throw new Error("Project not found");
      totalCount = p.items.totalCount;
      for (const it of p.items.nodes) allItems.push(it);
      if (!p.items.pageInfo.hasNextPage || allItems.length >= MAX_ITEMS) break;
      cursor = p.items.pageInfo.endCursor;
    }
    const proj = firstResp!.node!;
    sendJson(res, 200, {
      ok: true,
      project: {
        id: proj.id,
        number: proj.number,
        title: proj.title,
        url: proj.url,
        closed: proj.closed,
        shortDescription: proj.shortDescription,
        owner: proj.owner,
        fields: proj.fields.nodes,
        items: allItems,
        totalCount,
        truncated: allItems.length < totalCount,
      },
    });
  } catch (e: unknown) {
    const msg = (e as Error).message || String(e);
    const { needsScope, friendly } = classifyProjectsError(msg);
    sendJson(res, needsScope ? 200 : 500, { ok: false, needsScope, error: friendly });
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

async function handleProjectMove(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "POST required" });
  }
  let parsed: { projectId?: string; itemId?: string; fieldId?: string; optionId?: string | null };
  try { parsed = (await readJsonBody(req)) as typeof parsed; }
  catch { return sendJson(res, 400, { ok: false, error: "invalid JSON" }); }
  const { projectId, itemId, fieldId } = parsed;
  const optionId = parsed.optionId ?? null;
  if (!projectId || !itemId || !fieldId) {
    return sendJson(res, 400, { ok: false, error: "missing projectId/itemId/fieldId" });
  }
  try {
    if (optionId) {
      await gql(MOVE_MUTATION, { projectId, itemId, fieldId, optionId });
    } else {
      await gql(CLEAR_FIELD_MUTATION, { projectId, itemId, fieldId });
    }
    sendJson(res, 200, { ok: true });
  } catch (e: unknown) {
    const msg = (e as Error).message || String(e);
    const { needsScope, friendly } = classifyProjectsError(msg);
    sendJson(res, needsScope ? 200 : 500, { ok: false, needsScope, error: friendly });
  }
}

/* ===================== REPO DETAILS ===================== */

async function handleRepoDetails(res: ServerResponse, u: URL): Promise<void> {
  const repo = u.searchParams.get("repo");
  if (!parseRepo(repo) || !repo) return sendJson(res, 400, { ok: false, error: "invalid repo" });

  async function fetchContributors() {
    return restApiPaginate(`/repos/${repo}/contributors?per_page=100&anon=1`);
  }

  async function fetchReleases() {
    return restApiPaginate(`/repos/${repo}/releases?per_page=100`);
  }

  async function fetchRepoCounts(): Promise<{ branches: number | null; discussions: number | null }> {
    const rp = parseRepo(repo);
    if (!rp) return { branches: null, discussions: null };
    try {
      const data = await gql<{
        repository: {
          refs: { totalCount: number } | null;
          discussions: { totalCount: number };
        };
      }>(REPO_COUNTS_QUERY, { owner: rp[0], name: rp[1] });
      return {
        branches: data.repository.refs?.totalCount ?? null,
        discussions: data.repository.discussions.totalCount,
      };
    } catch {
      return { branches: null, discussions: null };
    }
  }

  const [meta, languages, contributors, commits, workflows, views, releases, repoDigest, security, milestones, community, counts] = await Promise.all([
    ghApiJson(`/repos/${repo}`),
    ghApiJson(`/repos/${repo}/languages`),
    fetchContributors(),
    ghApiJson(`/repos/${repo}/commits?per_page=20`),
    ghApiJson(`/repos/${repo}/actions/runs?per_page=100`),
    ghApiJson(`/repos/${repo}/traffic/views`),
    fetchReleases(),
    getLatestRepoDigest(repo),
    fetchRepoSecuritySummary(repo),
    ghApiJson(`/repos/${repo}/milestones?state=open&per_page=100&sort=due_on&direction=asc`),
    ghApiJson(`/repos/${repo}/community/profile`),
    fetchRepoCounts(),
  ]);

  const normalizedReleases = releases.ok
    ? ((releases.data as Array<{
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
      }> | null) ?? []).map((release) => {
        const assets = release.assets ?? [];
        return {
          ...release,
          assets,
          totalDownloads: assets.reduce((sum, asset) => sum + (asset.download_count || 0), 0),
        };
      })
    : [];

  sendJson(res, 200, {
    ok: true,
    meta: meta.ok ? meta.data : null,
    languages: languages.ok ? languages.data : {},
    contributors: contributors.ok ? contributors.data : [],
    views: views.ok ? views.data : null,
    releases: normalizedReleases,
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

/* ===================== AUTH ===================== */

async function handleAuthStatus(res: ServerResponse): Promise<void> {
  const status = await authStatus();
  sendJson(res, 200, {
    ok: true,
    ...status,
    clientIdConfigured: isClientIdConfigured(),
  });
}

async function handleAuthStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  if (getAuthMode() !== "device") {
    return sendJson(res, 400, {
      ok: false,
      error: `Device flow is disabled in '${getAuthMode()}' auth mode.`,
    });
  }
  if (!isClientIdConfigured()) {
    return sendJson(res, 400, {
      ok: false,
      error: "GITHUB_CLIENT_ID is not set. See README to register an OAuth App.",
    });
  }
  try {
    const flow = await startDeviceFlow();
    sendJson(res, 200, { ok: true, ...flow });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: (error as Error).message });
  }
}

async function handleAuthPoll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  if (getAuthMode() !== "device") {
    return sendJson(res, 400, {
      ok: false,
      error: `Device flow is disabled in '${getAuthMode()}' auth mode.`,
    });
  }
  try {
    const result = await pollDeviceFlow();
    if (result.status === "ok") invalidateDataCache();
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: (error as Error).message });
  }
}

async function handleAuthLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  if (getAuthMode() !== "device") {
    return sendJson(res, 400, {
      ok: false,
      error: `Logout is not available in '${getAuthMode()}' auth mode. Sign out via your gh CLI or unset the env token.`,
    });
  }
  await logout();
  invalidateDataCache();
  invalidateNotificationsCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true });
}

/* ===================== ACCOUNTS ===================== */

interface AccountSummary {
  id: string;
  providerKind: string;
  providerConfigId: string;
  label: string;
  login: string | null;
  scope: string;
  source: string;
  ephemeral: boolean;
  active: boolean;
  capabilities: Record<string, boolean>;
}

async function summariseAccount(account: Awaited<ReturnType<typeof getActiveAccount>>, activeId: string | null): Promise<AccountSummary | null> {
  if (!account) return null;
  let capabilities: Record<string, boolean> = {};
  try {
    const provider = await getProviderForAccount(account);
    capabilities = { ...provider.capabilities };
  } catch {
    // Unknown provider kind — return empty caps; UI will treat as conservative.
  }
  return {
    id: account.id,
    providerKind: account.providerKind,
    providerConfigId: account.providerConfigId,
    label: account.label,
    login: account.login,
    scope: account.scope,
    source: account.source,
    ephemeral: Boolean(account.ephemeral),
    active: account.id === activeId,
    capabilities,
  };
}

async function handleAccountsList(res: ServerResponse): Promise<void> {
  await initAccountStore();
  const all = await listAccountsStore();
  const active = await getActiveAccount();
  const summaries: AccountSummary[] = [];
  for (const account of all) {
    const summary = await summariseAccount(account, active?.id ?? null);
    if (summary) summaries.push(summary);
  }
  sendJson(res, 200, { ok: true, accounts: summaries, activeId: active?.id ?? null });
}

async function handleAccountActivate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  let parsed: { id?: string };
  try { parsed = (await readJsonBody(req)) as { id?: string }; }
  catch { return sendJson(res, 400, { ok: false, error: "invalid JSON" }); }
  const id = (parsed.id || "").trim();
  if (!id) return sendJson(res, 400, { ok: false, error: "missing id" });
  await initAccountStore();
  const account = await setActiveAccount(id);
  if (!account) return sendJson(res, 404, { ok: false, error: "account not found" });
  invalidateDataCache();
  invalidateNotificationsCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true, activeId: account.id });
}

async function handleProviderConfigsList(res: ServerResponse): Promise<void> {
  await initAccountStore();
  const configs = await listProviderConfigs();
  const summaries = Object.values(configs).map((cfg) => ({
    id: cfg.id,
    kind: cfg.kind,
    label: cfg.label,
    webUrl: cfg.webUrl,
    supportsDeviceFlow: Boolean(cfg.oauthDeviceCodeUrl) && cfg.kind === "github",
  }));
  sendJson(res, 200, { ok: true, configs: summaries });
}

async function handleAccountAddToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  let parsed: { providerConfigId?: string; token?: string; label?: string };
  try { parsed = (await readJsonBody(req)) as typeof parsed; }
  catch { return sendJson(res, 400, { ok: false, error: "invalid JSON" }); }
  const providerConfigId = (parsed.providerConfigId || "").trim();
  const token = (parsed.token || "").trim();
  if (!providerConfigId) return sendJson(res, 400, { ok: false, error: "missing providerConfigId" });
  if (!token) return sendJson(res, 400, { ok: false, error: "missing token" });
  await initAccountStore();
  const config = await getProviderConfig(providerConfigId);
  if (!config) return sendJson(res, 404, { ok: false, error: "unknown providerConfigId" });
  let identity;
  try {
    const provider = await getProvider(providerConfigId);
    identity = await provider.fetchIdentity(token);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: (error as Error).message });
  }
  if (!identity.login) return sendJson(res, 400, { ok: false, error: "provider did not return a login" });
  const safeLogin = identity.login.replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = config.kind === "github" ? "gh" : "fj";
  const webHost = new URL(config.webUrl).host;
  const account = await addAccount({
    id: `${prefix}_${safeLogin}_${providerConfigId}`,
    providerKind: config.kind,
    providerConfigId,
    label: parsed.label?.trim() || `${identity.login} (${webHost})`,
    login: identity.login,
    accessToken: token,
    scope: identity.scope ?? "",
    obtainedAt: new Date().toISOString(),
    source: "token",
  });
  invalidateDataCache();
  invalidateNotificationsCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true, accountId: account.id });
}

async function handleAccountRemove(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  if (req.method !== "DELETE") return sendJson(res, 405, { ok: false, error: "DELETE required" });
  const id = (u.searchParams.get("id") || "").trim();
  if (!id) return sendJson(res, 400, { ok: false, error: "missing id" });
  await initAccountStore();
  const existed = await removeAccountStore(id);
  if (!existed) return sendJson(res, 404, { ok: false, error: "account not found" });
  invalidateDataCache();
  invalidateNotificationsCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true });
}

/* ===================== NOTIFICATIONS ===================== */

async function handleNotifications(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  if (req.method && req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "GET required" });
  }
  const fresh = u.searchParams.get("fresh") === "1";
  const result = await getNotificationsCached(fresh);
  if (!result.ok) {
    const status = result.needsAuth ? 401 : 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  const participating = u.searchParams.get("participating") === "1";
  const onlyUnread = u.searchParams.get("unread") === "1";
  const reasonFilter = (u.searchParams.get("reason") || "").trim();
  let notifications = result.data.notifications;
  if (participating) {
    const participatingReasons = new Set([
      "assign", "author", "comment", "manual", "mention", "review_requested", "team_mention",
    ]);
    notifications = notifications.filter((entry) => participatingReasons.has(entry.reason));
  }
  if (onlyUnread) notifications = notifications.filter((entry) => entry.unread);
  if (reasonFilter) {
    const allowed = new Set(reasonFilter.split(",").map((value) => value.trim()).filter(Boolean));
    if (allowed.size) notifications = notifications.filter((entry) => allowed.has(entry.reason));
  }
  sendJsonCacheable(req, res, 200, {
    ok: true,
    notifications,
    fetchedAt: result.data.fetchedAt,
    pollInterval: result.data.pollInterval,
  });
}

async function handleNotificationRead(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  let parsed: { threadId?: string };
  try { parsed = (await readJsonBody(req)) as { threadId?: string }; }
  catch { return sendJson(res, 400, { ok: false, error: "invalid JSON" }); }
  const threadId = (parsed.threadId || "").trim();
  if (!threadId || !/^\d+$/.test(threadId)) {
    return sendJson(res, 400, { ok: false, error: "missing or invalid threadId" });
  }
  const result = await markThreadRead(threadId);
  if (!result.ok) {
    const status = result.needsAuth ? 401 : result.status || 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  sendJson(res, 200, { ok: true });
}

async function handleNotificationsReadAll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  let parsed: { repo?: string; lastReadAt?: string };
  try { parsed = (await readJsonBody(req)) as { repo?: string; lastReadAt?: string }; }
  catch { return sendJson(res, 400, { ok: false, error: "invalid JSON" }); }
  const repo = (parsed.repo || "").trim() || null;
  if (repo && !parseRepo(repo)) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const lastReadAt = parsed.lastReadAt ? String(parsed.lastReadAt) : null;
  if (lastReadAt && Number.isNaN(Date.parse(lastReadAt))) {
    return sendJson(res, 400, { ok: false, error: "invalid lastReadAt" });
  }
  const result = await markAllRead({ repo, lastReadAt });
  if (!result.ok) {
    const status = result.needsAuth ? 401 : result.status || 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  sendJson(res, 200, { ok: true });
}

/* ===================== ROUTING ===================== */

const APP_ROUTES = new Set([
  "/",
  "/index.html",
  "/inbox",
  "/repositories",
  "/issues",
  "/pull-requests",
  "/insights",
  "/alerts",
  "/ci",
  "/daily",
  "/board",
  "/alert",
]);

async function sendClientIndex(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(CLIENT_INDEX_PATH, "utf-8").catch(() => readFile(SOURCE_INDEX_PATH, "utf-8"));
    send(res, 200, html, "text/html; charset=utf-8");
  } catch {
    send(res, 500, "index.html not found", "text/plain; charset=utf-8");
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const pathname = new URL(url, "http://localhost").pathname;
  if (APP_ROUTES.has(pathname)) return sendClientIndex(res);
  if (await sendStaticFile(res, pathname)) return;
  if (url.startsWith("/api/auth/status")) return handleAuthStatus(res);
  if (url.startsWith("/api/auth/start")) return handleAuthStart(req, res);
  if (url.startsWith("/api/auth/poll")) return handleAuthPoll(req, res);
  if (url.startsWith("/api/auth/logout")) return handleAuthLogout(req, res);
  if (url.startsWith("/api/accounts/activate")) return handleAccountActivate(req, res);
  if (url.startsWith("/api/accounts/add-token")) return handleAccountAddToken(req, res);
  if (url.startsWith("/api/provider-configs")) return handleProviderConfigsList(res);
  if (url.startsWith("/api/accounts")) {
    if (req.method === "DELETE") {
      return handleAccountRemove(req, res, new URL(url, "http://localhost"));
    }
    return handleAccountsList(res);
  }
  if (url.startsWith("/api/stargazers")) {
    return handleStargazers(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/forks")) {
    return handleForks(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/issues")) {
    return handleMentionIssues(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/code")) {
    return handleMentionCode(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-aliases")) {
    return handleRepoAliases(req, res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/referrers")) {
    return handleReferrers(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/dependents")) {
    return handleDependents(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-details")) {
    return handleRepoDetails(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-branches")) {
    return handleRepoBranches(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-discussions")) {
    return handleRepoDiscussions(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-insights")) {
    return handleRepoInsights(req, res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/daily-digests")) {
    return handleDailyDigests(req, res);
  }
  if (url.startsWith("/api/ci-health")) {
    const u = new URL(url, "http://localhost");
    const fresh = u.searchParams.get("fresh") === "1";
    const payload = await getCIHealthCached(fresh);
    const status = payload.ok ? 200 : payload.needsAuth ? 401 : 500;
    sendJsonCacheable(req, res, status, payload);
    return;
  }
  if (url.startsWith("/api/projects")) {
    return handleProjects(res);
  }
  if (url.startsWith("/api/project/move")) {
    return handleProjectMove(req, res);
  }
  if (url.startsWith("/api/project")) {
    return handleProject(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repos")) {
    const u = new URL(url, "http://localhost");
    const fresh = u.searchParams.get("fresh") === "1";
    const payload = await getReposCached(fresh);
    const status = payload.ok ? 200 : payload.needsAuth ? 401 : 500;
    sendJsonCacheable(req, res, status, payload);
    return;
  }
  if (url.startsWith("/api/issues")) {
    const u = new URL(url, "http://localhost");
    const fresh = u.searchParams.get("fresh") === "1";
    const payload = await getIssuesCached(fresh);
    const status = payload.ok ? 200 : payload.needsAuth ? 401 : 500;
    sendJsonCacheable(req, res, status, payload);
    return;
  }
  if (url.startsWith("/api/prs")) {
    const u = new URL(url, "http://localhost");
    const fresh = u.searchParams.get("fresh") === "1";
    const payload = await getPullRequestsCached(fresh);
    const status = payload.ok ? 200 : payload.needsAuth ? 401 : 500;
    sendJsonCacheable(req, res, status, payload);
    return;
  }
  if (url.startsWith("/api/notifications/read-all")) {
    return handleNotificationsReadAll(req, res);
  }
  if (url.startsWith("/api/notifications/read")) {
    return handleNotificationRead(req, res);
  }
  if (url.startsWith("/api/notifications")) {
    return handleNotifications(req, res, new URL(url, "http://localhost"));
  }
  const lastSlash = pathname.lastIndexOf("/");
  const fileName = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
  if (!fileName.includes(".")) {
    return sendClientIndex(res);
  }
  send(res, 404, "not found", "text/plain; charset=utf-8");
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    send(res, 500, String(err), "text/plain; charset=utf-8");
  });
}).listen(PORT, HOST, () => {
  console.log(`GitHub Issues Dashboard -> http://${HOST}:${PORT}`);
  console.log(`Auth mode: ${getAuthMode()}`);
});
