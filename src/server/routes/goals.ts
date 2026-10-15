import { getActive as getActiveAccount } from "../accountStore";
import {
  createGoal,
  deleteGoal,
  findGoal,
  getRepositoryContentSources,
  listGoals,
  saveGoalProposals,
  saveGoalSuggestions,
} from "../goalStore";
import { isAiConfigured } from "../ai/settings";
import { AiNotConfiguredError, AiRequestError } from "../ai/client";
import { generateGoalProposals, generateGoalSuggestions, refreshGoal, SOCIAL_PROPOSALS_VERSION } from "../goals";
import { parseJsonBody, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import { GOAL_METRICS, type GoalMetric } from "../../types/goals";
import { parseRepositoryName } from "../../utils/repository";

async function requireAccount(ctx: RouteContext) {
  const account = await getActiveAccount();
  if (!account) sendJson(ctx.res, 401, { ok: false, needsAuth: true, error: "authentication required" });
  return account;
}

async function list(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const goals = await Promise.all(listGoals(account.id).map(refreshGoal));
  sendJson(ctx.res, 200, { ok: true, goals: goals.map((goal) => ({ ...goal, aiEnabled: isAiConfigured() })) });
}

async function create(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const body = await parseJsonBody<{ repository?: string; metric?: string; targetValue?: number; currentValue?: number; deadline?: string }>(ctx.req, ctx.res);
  if (!body) return;
  const repository = body.repository?.trim() ?? "";
  const metric = body.metric as GoalMetric;
  const targetValue = Number(body.targetValue);
  const deadline = body.deadline ?? "";
  if (!parseRepositoryName(repository)) return sendJson(ctx.res, 400, { ok: false, error: "invalid repository" });
  if (!GOAL_METRICS.includes(metric)) return sendJson(ctx.res, 400, { ok: false, error: "invalid metric" });
  if (!Number.isSafeInteger(targetValue) || targetValue <= 0) return sendJson(ctx.res, 400, { ok: false, error: "target must be a positive integer" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(deadline))) return sendJson(ctx.res, 400, { ok: false, error: "invalid deadline" });
  const initial = Number.isSafeInteger(body.currentValue) && Number(body.currentValue) >= 0 ? Number(body.currentValue) : 0;
  let goal = await refreshGoal(createGoal({ accountId: account.id, repository, metric, targetValue, currentValue: initial, deadline }));
  try {
    const suggestions = await generateGoalSuggestions(goal);
    saveGoalSuggestions(account.id, goal.id, suggestions);
    goal = { ...goal, suggestions, suggestionsGeneratedAt: new Date().toISOString() };
  } catch {
    // Goal creation must still succeed when the optional AI provider is unavailable.
  }
  sendJson(ctx.res, 201, { ok: true, goal: { ...goal, aiEnabled: isAiConfigured() } });
}

async function remove(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const id = ctx.params.id ?? "";
  if (!deleteGoal(account.id, id)) return sendJson(ctx.res, 404, { ok: false, error: "goal not found" });
  sendJson(ctx.res, 200, { ok: true });
}

async function advise(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const goal = findGoal(account.id, ctx.params.id ?? "");
  if (!goal) return sendJson(ctx.res, 404, { ok: false, error: "goal not found" });
  try {
    const suggestions = await generateGoalSuggestions(await refreshGoal(goal));
    saveGoalSuggestions(account.id, goal.id, suggestions);
    sendJson(ctx.res, 200, { ok: true, suggestions, generatedAt: new Date().toISOString(), aiEnabled: isAiConfigured() });
  } catch (error) {
    sendJson(ctx.res, 502, { ok: false, error: (error as Error).message });
  }
}

async function proposals(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const goal = findGoal(account.id, ctx.params.id ?? "");
  if (!goal) return sendJson(ctx.res, 404, { ok: false, error: "goal not found" });
  const index = Number(ctx.params.index);
  const suggestion = Number.isInteger(index) ? goal.suggestions[index] : undefined;
  if (!suggestion) return sendJson(ctx.res, 404, { ok: false, error: "suggestion not found" });
  const body = await parseJsonBody<Record<string, never>>(ctx.req, ctx.res);
  if (!body) return;
  const sources = getRepositoryContentSources(account.id, goal.repository);
  const refresh = ctx.url.searchParams.get("refresh") === "1";
  if (!refresh && suggestion.proposals?.length && suggestion.proposalsVersion === SOCIAL_PROPOSALS_VERSION) {
    return sendJson(ctx.res, 200, { ok: true, proposals: suggestion.proposals, generatedAt: suggestion.proposalsGeneratedAt, cached: true });
  }
  try {
    const generated = await generateGoalProposals(goal, suggestion, sources);
    if (!generated.length) return sendJson(ctx.res, 502, { ok: false, error: "AI returned no proposals" });
    const saved = saveGoalProposals(account.id, goal.id, index, generated, SOCIAL_PROPOSALS_VERSION);
    sendJson(ctx.res, 200, { ok: true, proposals: generated, generatedAt: saved?.proposalsGeneratedAt ?? new Date().toISOString(), cached: false });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return sendJson(ctx.res, 409, { ok: false, error: error.message, aiEnabled: false });
    sendJson(ctx.res, error instanceof AiRequestError ? 502 : 500, { ok: false, error: (error as Error).message });
  }
}

export function registerGoalRoutes(router: AppRouter): void {
  router.post("/api/goals/:id/suggestions/:index/proposals", proposals);
  router.get("/api/goals", list);
  router.post("/api/goals", create);
  router.delete("/api/goals/:id", remove);
  router.post("/api/goals/:id/advice", advise);
}
