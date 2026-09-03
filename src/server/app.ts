import type { IncomingMessage, ServerResponse } from "node:http";
import { send, sendJson, sendStaticFile } from "./http";
import { AppRouter } from "./router";
import { registerApiRoutes } from "./routes";
import { isAppRoute, isClientRoutePath, sendClientIndex } from "./spa";

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Builds the HTTP request handler: known client routes and static assets are
 * served first, then the API router, then the SPA fallback for any other
 * extension-less path.
 */
export function createRequestHandler(router: AppRouter = createApiRouter()): RequestHandler {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;

    if (isAppRoute(pathname)) return sendClientIndex(res);
    if (await sendStaticFile(res, pathname)) return;
    if (await router.dispatch(req, res, url)) return;

    if (pathname.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "not found" });
    if (isClientRoutePath(pathname)) return sendClientIndex(res);
    send(res, 404, "not found", "text/plain; charset=utf-8");
  };
}

export function createApiRouter(): AppRouter {
  const router = new AppRouter();
  registerApiRoutes(router);
  return router;
}
