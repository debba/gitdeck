import { getActive as getActiveAccount } from "../accountStore";
import { AiNotConfiguredError, AiRequestError, testAiConnection } from "../ai/client";
import { isAiProviderId } from "../ai/providers";
import { AiSettingsValidationError, resetAiSettings, summarizeAiSettings, updateAiSettings } from "../ai/settings";
import { parseJsonBody, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import type { AiSettingsUpdate } from "../../types/ai";

async function requireAccount(ctx: RouteContext): Promise<boolean> {
  const account = await getActiveAccount();
  if (!account) sendJson(ctx.res, 401, { ok: false, needsAuth: true, error: "authentication required" });
  return Boolean(account);
}

async function read(ctx: RouteContext): Promise<void> {
  if (!(await requireAccount(ctx))) return;
  sendJson(ctx.res, 200, { ok: true, settings: summarizeAiSettings() });
}

async function update(ctx: RouteContext): Promise<void> {
  if (!(await requireAccount(ctx))) return;
  const body = await parseJsonBody<Partial<Record<keyof AiSettingsUpdate, unknown>>>(ctx.req, ctx.res);
  if (!body) return;
  if (body.provider !== undefined && !isAiProviderId(body.provider)) return sendJson(ctx.res, 400, { ok: false, error: "unknown provider" });
  for (const field of ["apiKey", "model", "baseUrl"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") return sendJson(ctx.res, 400, { ok: false, error: `${field} must be a string` });
  }
  try {
    const settings = updateAiSettings(body as AiSettingsUpdate);
    sendJson(ctx.res, 200, { ok: true, settings });
  } catch (error) {
    if (error instanceof AiSettingsValidationError) return sendJson(ctx.res, 400, { ok: false, error: error.message });
    throw error;
  }
}

async function reset(ctx: RouteContext): Promise<void> {
  if (!(await requireAccount(ctx))) return;
  sendJson(ctx.res, 200, { ok: true, settings: resetAiSettings() });
}

async function test(ctx: RouteContext): Promise<void> {
  if (!(await requireAccount(ctx))) return;
  try {
    sendJson(ctx.res, 200, await testAiConnection());
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return sendJson(ctx.res, 409, { ok: false, error: error.message });
    const status = error instanceof AiRequestError ? 502 : 500;
    sendJson(ctx.res, status, { ok: false, error: (error as Error).message });
  }
}

export function registerAiRoutes(router: AppRouter): void {
  router.get("/api/ai/settings", read);
  router.on("PUT", "/api/ai/settings", update);
  router.delete("/api/ai/settings", reset);
  router.post("/api/ai/settings/test", test);
}
