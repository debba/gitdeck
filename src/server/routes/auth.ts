import { getAuthMode } from "../authProvider";
import { invalidateCIHealthCache } from "../ciHealth";
import { HOST, PORT } from "../config";
import { invalidateDataCache } from "../dashboardData";
import { finishGitLabOAuth, startGitLabOAuth } from "../gitlabOAuth";
import { sendJson, sendRedirect } from "../http";
import { invalidateNotificationsCache } from "../notifications";
import { authStatus, isClientIdConfigured, logout, pollDeviceFlow, startDeviceFlow } from "../oauth";
import type { AppRouter, RouteContext } from "../router";
import { sendError } from "./shared";

function requireDeviceMode(ctx: RouteContext, action: string): boolean {
  if (getAuthMode() === "device") return true;
  sendJson(ctx.res, 400, { ok: false, error: `${action} is disabled in '${getAuthMode()}' auth mode.` });
  return false;
}

async function status(ctx: RouteContext): Promise<void> {
  const result = await authStatus();
  sendJson(ctx.res, 200, { ok: true, ...result, clientIdConfigured: isClientIdConfigured() });
}

async function start(ctx: RouteContext): Promise<void> {
  if (!requireDeviceMode(ctx, "Device flow")) return;
  if (!isClientIdConfigured()) {
    return sendJson(ctx.res, 400, {
      ok: false,
      error: "GITHUB_CLIENT_ID is not set. See README to register an OAuth App.",
    });
  }
  try {
    const flow = await startDeviceFlow();
    sendJson(ctx.res, 200, { ok: true, ...flow });
  } catch (error) {
    sendError(ctx, error);
  }
}

async function poll(ctx: RouteContext): Promise<void> {
  if (!requireDeviceMode(ctx, "Device flow")) return;
  try {
    const result = await pollDeviceFlow();
    if (result.status === "ok") invalidateDataCache();
    sendJson(ctx.res, 200, { ok: true, ...result });
  } catch (error) {
    sendError(ctx, error);
  }
}

async function signOut(ctx: RouteContext): Promise<void> {
  if (getAuthMode() !== "device") {
    return sendJson(ctx.res, 400, {
      ok: false,
      error: `Logout is not available in '${getAuthMode()}' auth mode. Sign out via your gh CLI or unset the env token.`,
    });
  }
  await logout();
  invalidateDataCache();
  invalidateNotificationsCache();
  invalidateCIHealthCache();
  sendJson(ctx.res, 200, { ok: true });
}

function gitLabRedirectUri(ctx: RouteContext): string {
  const configured = process.env.GITLAB_REDIRECT_URI?.trim();
  if (configured) return configured;
  const forwardedProto = String(ctx.req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwardedProto || (ctx.req.socket.localPort === 443 ? "https" : "http");
  const host = ctx.req.headers.host || `${HOST}:${PORT}`;
  return `${protocol}://${host}/api/auth/gitlab/callback`;
}

async function gitLabStart(ctx: RouteContext): Promise<void> {
  const instanceUrl = ctx.url.searchParams.get("instanceUrl")?.trim() || "https://gitlab.com";
  try {
    sendRedirect(ctx.res, startGitLabOAuth(instanceUrl, gitLabRedirectUri(ctx)));
  } catch (error) {
    sendError(ctx, error, 400);
  }
}

async function gitLabCallback(ctx: RouteContext): Promise<void> {
  const { searchParams } = ctx.url;
  const providerError = searchParams.get("error_description") || searchParams.get("error");
  if (providerError) {
    return sendRedirect(ctx.res, `/?gitlabOAuth=error&message=${encodeURIComponent(providerError)}`);
  }
  try {
    await finishGitLabOAuth(searchParams.get("code") || "", searchParams.get("state") || "");
    invalidateDataCache();
    invalidateNotificationsCache();
    sendRedirect(ctx.res, "/?gitlabOAuth=success");
  } catch (error) {
    const message = (error as Error).message || String(error);
    sendRedirect(ctx.res, `/?gitlabOAuth=error&message=${encodeURIComponent(message)}`);
  }
}

export function registerAuthRoutes(router: AppRouter): void {
  router.get("/api/auth/status", status);
  router.post("/api/auth/start", start);
  router.post("/api/auth/poll", poll);
  router.post("/api/auth/logout", signOut);
  router.get("/api/auth/gitlab/start", gitLabStart);
  router.get("/api/auth/gitlab/callback", gitLabCallback);
}
