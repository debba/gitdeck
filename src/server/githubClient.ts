import { getActiveToken } from "./authProvider";
import { readUpstreamJson, requireUpstreamJson } from "./upstream";

const API_ROOT = "https://api.github.com";
const GRAPHQL_URL = `${API_ROOT}/graphql`;
const USER_AGENT = "gitdeck";
const SERVICE = "GitHub";

export class AuthRequiredError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export async function getToken(): Promise<string> {
  try {
    const token = await getActiveToken();
    if (!token) throw new AuthRequiredError();
    return token;
  } catch (error) {
    if (error instanceof AuthRequiredError) throw error;
    throw new AuthRequiredError((error as Error).message);
  }
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(extra ?? {}),
  };
}

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getToken();
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401) throw new AuthRequiredError();
  const json = await requireUpstreamJson<{ data?: T; errors?: { message: string }[] } | null>(SERVICE, response);
  if (json?.errors?.length) throw new Error(json.errors.map((error) => error.message).join("; "));
  if (!json?.data) throw new Error("Empty GraphQL response");
  return json.data;
}

export type RestResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

function buildUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_ROOT}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function restApi<T = unknown>(path: string): Promise<RestResult<T>> {
  let token: string;
  try {
    token = await getToken();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return { ok: false, error: error.message, status: 401 };
    }
    throw error;
  }
  const response = await fetch(buildUrl(path), { headers: authHeaders(token) });
  if (response.status === 204) return { ok: true, data: null as T };
  const result = await readUpstreamJson<T>(SERVICE, response);
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error, status: result.status };
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

export async function restApiPaginate<T = unknown>(path: string): Promise<RestResult<T[]>> {
  let token: string;
  try {
    token = await getToken();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return { ok: false, error: error.message, status: 401 };
    }
    throw error;
  }
  const all: T[] = [];
  let nextUrl: string | null = buildUrl(path);
  while (nextUrl) {
    const response: Response = await fetch(nextUrl, { headers: authHeaders(token) });
    const result = await readUpstreamJson<unknown>(SERVICE, response);
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    const page = result.data;
    if (page == null) {
      // Nothing to collect on this page.
    } else if (Array.isArray(page)) {
      for (const item of page) all.push(item as T);
    } else {
      // Some endpoints (e.g. search) return wrapped results; pagination there
      // is rare for our usage. Surface the page as a single record.
      all.push(page as T);
    }
    nextUrl = parseNextLink(response.headers.get("link"));
  }
  return { ok: true, data: all };
}

export async function ghApiJson(path: string): Promise<RestResult> {
  return restApi(path);
}
