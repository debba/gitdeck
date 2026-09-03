import { parseRepositoryName } from "../../utils/repository";
import { sendJson } from "../http";
import type { RouteContext } from "../router";

/** Reads `?repo=owner/name`, answering 400 and returning `null` when it is missing or malformed. */
export function requireRepo({ res, url }: RouteContext): string | null {
  const repo = url.searchParams.get("repo");
  if (!repo || !parseRepositoryName(repo)) {
    sendJson(res, 400, { ok: false, error: "invalid repo" });
    return null;
  }
  return repo;
}

/** Like {@link requireRepo} but returns the `[owner, name]` pair. */
export function requireRepoParts(ctx: RouteContext): [string, string] | null {
  const parts = parseRepositoryName(ctx.url.searchParams.get("repo"));
  if (!parts) sendJson(ctx.res, 400, { ok: false, error: "invalid repo" });
  return parts;
}

export function sendError(ctx: RouteContext, error: unknown, status = 500): void {
  sendJson(ctx.res, status, { ok: false, error: (error as Error).message || String(error) });
}
