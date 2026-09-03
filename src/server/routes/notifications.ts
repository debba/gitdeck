import { parseRepositoryName } from "../../utils/repository";
import { parseJsonBody, sendJson, sendJsonCacheable } from "../http";
import { getNotificationsCached, markAllRead, markThreadRead } from "../notifications";
import type { AppRouter, RouteContext } from "../router";

const PARTICIPATING_REASONS = new Set([
  "assign", "author", "comment", "manual", "mention", "review_requested", "team_mention",
]);

async function list(ctx: RouteContext): Promise<void> {
  const { searchParams } = ctx.url;
  const result = await getNotificationsCached(searchParams.get("fresh") === "1");
  if (!result.ok) {
    return sendJson(ctx.res, result.needsAuth ? 401 : 500, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  let notifications = result.data.notifications;
  if (searchParams.get("participating") === "1") {
    notifications = notifications.filter((entry) => PARTICIPATING_REASONS.has(entry.reason));
  }
  if (searchParams.get("unread") === "1") notifications = notifications.filter((entry) => entry.unread);
  const reasonFilter = (searchParams.get("reason") || "").trim();
  if (reasonFilter) {
    const allowed = new Set(reasonFilter.split(",").map((value) => value.trim()).filter(Boolean));
    if (allowed.size) notifications = notifications.filter((entry) => allowed.has(entry.reason));
  }
  sendJsonCacheable(ctx.req, ctx.res, 200, {
    ok: true,
    notifications,
    fetchedAt: result.data.fetchedAt,
    pollInterval: result.data.pollInterval,
  });
}

function sendMarkResult(ctx: RouteContext, result: Awaited<ReturnType<typeof markThreadRead>>): void {
  if (!result.ok) {
    const status = result.needsAuth ? 401 : result.status || 500;
    return sendJson(ctx.res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  sendJson(ctx.res, 200, { ok: true });
}

async function markRead(ctx: RouteContext): Promise<void> {
  const parsed = await parseJsonBody<{ threadId?: string }>(ctx.req, ctx.res);
  if (!parsed) return;
  const threadId = (parsed.threadId || "").trim();
  if (!threadId || !/^\d+$/.test(threadId)) {
    return sendJson(ctx.res, 400, { ok: false, error: "missing or invalid threadId" });
  }
  sendMarkResult(ctx, await markThreadRead(threadId));
}

async function markAll(ctx: RouteContext): Promise<void> {
  const parsed = await parseJsonBody<{ repo?: string; lastReadAt?: string }>(ctx.req, ctx.res);
  if (!parsed) return;
  const repo = (parsed.repo || "").trim() || null;
  if (repo && !parseRepositoryName(repo)) return sendJson(ctx.res, 400, { ok: false, error: "invalid repo" });
  const lastReadAt = parsed.lastReadAt ? String(parsed.lastReadAt) : null;
  if (lastReadAt && Number.isNaN(Date.parse(lastReadAt))) {
    return sendJson(ctx.res, 400, { ok: false, error: "invalid lastReadAt" });
  }
  sendMarkResult(ctx, await markAllRead({ repo, lastReadAt }));
}

export function registerNotificationRoutes(router: AppRouter): void {
  router.get("/api/notifications", list);
  router.post("/api/notifications/read", markRead);
  router.post("/api/notifications/read-all", markAll);
}
