import type { IncomingMessage, ServerResponse } from "node:http";
import Router from "find-my-way";
import { sendJson } from "./http";

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string | undefined>;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export type RouteMatch =
  | { kind: "matched"; handler: RouteHandler; params: Record<string, string | undefined> }
  | { kind: "method-not-allowed"; allowed: RouteMethod[] }
  | { kind: "not-found" };

const KNOWN_METHODS: RouteMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// find-my-way requires a handler callback on registration; the real handler is
// kept in the route store so it can be invoked with a typed context.
function noopHandler(): void {}

/**
 * Thin, typed wrapper around find-my-way. Routes are matched by method and
 * exact path; a path that exists for a different method yields a 405 with an
 * `Allow` header instead of falling through.
 */
export class AppRouter {
  private readonly tree = Router({ ignoreTrailingSlash: true, caseSensitive: true });

  on(methods: RouteMethod | RouteMethod[], path: string, handler: RouteHandler): this {
    this.tree.on(methods, path, noopHandler, handler);
    return this;
  }

  get(path: string, handler: RouteHandler): this {
    return this.on("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.on("POST", path, handler);
  }

  delete(path: string, handler: RouteHandler): this {
    return this.on("DELETE", path, handler);
  }

  match(method: string, pathname: string): RouteMatch {
    const found = this.tree.find(method as Router.HTTPMethod, pathname);
    if (found) return { kind: "matched", handler: found.store as RouteHandler, params: found.params };
    const allowed = KNOWN_METHODS.filter((candidate) => candidate !== method && this.tree.find(candidate, pathname));
    return allowed.length ? { kind: "method-not-allowed", allowed } : { kind: "not-found" };
  }

  /** Runs the matching handler. Resolves to `false` when no route exists for the path. */
  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const match = this.match(req.method ?? "GET", url.pathname);
    if (match.kind === "not-found") return false;
    if (match.kind === "method-not-allowed") {
      res.setHeader("Allow", match.allowed.join(", "));
      sendJson(res, 405, { ok: false, error: `${match.allowed.join(" or ")} required` });
      return true;
    }
    await match.handler({ req, res, url, params: match.params });
    return true;
  }
}
