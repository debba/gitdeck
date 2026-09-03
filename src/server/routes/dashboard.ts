import { getCIHealthCached } from "../ciHealth";
import { getIssuesCached, getPullRequestsCached, getReposCached } from "../dashboardData";
import { handleDailyDigests } from "../digests";
import { sendPayload } from "../http";
import { handleRepoInsights } from "../repoInsights";
import type { AppRouter, RouteContext, RouteHandler } from "../router";

function isFresh(ctx: RouteContext): boolean {
  return ctx.url.searchParams.get("fresh") === "1";
}

/** Wraps a `getXCached(fresh)` loader into a route honouring `?fresh=1` and ETags. */
function cachedPayload(load: (fresh: boolean) => Promise<{ ok: boolean; needsAuth?: boolean }>): RouteHandler {
  return async (ctx) => sendPayload(ctx.req, ctx.res, await load(isFresh(ctx)));
}

export function registerDashboardRoutes(router: AppRouter): void {
  router.get("/api/repos", cachedPayload(getReposCached));
  router.get("/api/issues", cachedPayload(getIssuesCached));
  router.get("/api/prs", cachedPayload(getPullRequestsCached));
  router.get("/api/ci-health", cachedPayload(getCIHealthCached));
  router.get("/api/repo-insights", ({ req, res, url }) => handleRepoInsights(req, res, url));
  router.get("/api/daily-digests", ({ req, res }) => handleDailyDigests(req, res));
}
