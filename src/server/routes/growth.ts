import { getActive as getActiveAccount } from "../accountStore";
import { AiNotConfiguredError, AiRequestError } from "../ai/client";
import { isAiConfigured } from "../ai/settings";
import { findGoal, getRepositoryContentSources, listGoalRepositories } from "../goalStore";
import {
  generateGoalProposals,
  generateRepositoryInterventionSuggestions,
  refreshGoal,
  SOCIAL_PROPOSALS_VERSION,
} from "../goals";
import {
  archiveContentPlanWithItems,
  createContentItem,
  deleteContentItem,
  getContentItem,
  getContentPlan,
  getGrowthIntervention,
  getGrowthProfile,
  getGrowthWorkspaceSummary,
  GrowthStoreValidationError,
  listContentItems,
  listContentPerformance,
  listContentPlans,
  listGrowthAssets,
  listGrowthInterventions,
  listPersistedGrowthProfileRepositories,
  markContentItemPublished,
  updateContentItem,
  updateGrowthIntervention,
  upsertGrowthIntervention,
  validateContentMediaAttachments,
  upsertGrowthProfile,
} from "../growth/store";
import {
  generateGrowthContentPlan,
  generateMultipleGrowthContentPlans,
  regenerateGrowthContentPlan,
} from "../growth/planner";
import {
  discoverGrowthAssetImportCandidates,
  GrowthAssetTooLargeError,
  GrowthAssetValidationError,
  persistGeneratedGrowthCard,
  persistImportedGrowthAsset,
  persistUploadedGrowthAsset,
  readGrowthAssetFile,
  toGrowthAssetMetadata,
  UnsupportedGrowthAssetTypeError,
} from "../growth/assets";
import { GrowthCardValidationError } from "../growth/cards";
import {
  draftGrowthContentItem,
  GrowthContentDraftConflictError,
} from "../growth/drafter";
import { scanRepositoryGrowthOpportunities } from "../growth/rules";
import {
  EvergreenRecycleUnavailableError,
  recycleEvergreenContent,
} from "../growth/recycling";
import { refreshContentPerformance } from "../growth/attribution";
import { getGrowthPerformanceSummary } from "../growth/performance";
import { getGrowthWeeklyReview } from "../growth/review";
import { getGrowthUnifiedCalendar } from "../growth/calendar";
import {
  getGrowthSettings,
  resetGrowthSettings,
  saveGrowthSettings,
} from "../growth/settings";
import { parseJsonBody, readJsonBody, send, sendJson } from "../http";
import type { AppRouter, RouteContext } from "../router";
import {
  GROWTH_CHANNELS,
  GROWTH_CONTENT_ITEM_STATUSES,
  GROWTH_INTERVENTION_STATUSES,
  GROWTH_PERFORMANCE_WINDOWS,
  type GrowthAssetImportOrigin,
  type GrowthContentChannel,
  type GrowthContentMedia,
  type GrowthContentItemStatus,
  type GrowthContentPerformanceFilters,
  type GrowthPerformanceSummaryFilters,
  type GrowthReviewFilters,
  type GrowthUnifiedCalendarFilters,
  type GrowthInterventionCategory,
  type GrowthInterventionStatus,
  type UpdateGrowthContentItemInput,
  type UpdateGrowthInterventionInput,
} from "../../types/growth";
import { GOAL_PROPOSAL_FORMATS, type GoalProposal, type GoalProposalFormat } from "../../types/goals";
import { createGrowthInterventionDedupeKey } from "../../utils/growth/interventions";
import { buildGrowthCalendarIcs } from "../../utils/growth/ics";
import { legacyMediaToContentMedia, legacyProposalChannel } from "../../utils/growth/legacySuggestions";
import { parseUtcIsoDateTime } from "../../utils/growth/performanceSummary";
import {
  GrowthProfileValidationError,
  normalizeGrowthProfileInput,
} from "../../utils/growth/profile";
import { GrowthSettingsValidationError } from "../../utils/growth/settings";
import { parseRepositoryName } from "../../utils/repository";
import { SOCIAL_PROPOSAL_FORMATS } from "../../utils/socialProposals";

const INTERVENTION_CATEGORIES = ["product", "community", "engineering", "marketing"] as const;
const CONTENT_CHANNELS = [...GROWTH_CHANNELS, "other"] as const;
const CONTENT_CREATE_FIELDS = [
  "repository",
  "planId",
  "interventionId",
  "goalIds",
  "channel",
  "format",
  "pillar",
  "angle",
  "title",
  "summary",
  "body",
  "threadPosts",
  "media",
  "sources",
  "status",
  "scheduledFor",
  "generatedAt",
  "generationVersion",
  "evergreen",
] as const;
const CONTENT_UPDATE_FIELDS = CONTENT_CREATE_FIELDS.filter((field) => field !== "repository");

type ActiveAccount = NonNullable<Awaited<ReturnType<typeof getActiveAccount>>>;

async function requireAccount(ctx: RouteContext): Promise<ActiveAccount | null> {
  const account = await getActiveAccount();
  if (!account) {
    sendJson(ctx.res, 401, { ok: false, needsAuth: true, error: "authentication required" });
  }
  return account;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function badRequest(ctx: RouteContext, error: string): void {
  sendJson(ctx.res, 400, { ok: false, error });
}

function decodeRepositoryParams(ctx: RouteContext): string | null {
  try {
    const owner = decodeURIComponent(ctx.params.owner ?? "");
    const repo = decodeURIComponent(ctx.params.repo ?? "");
    const repository = `${owner}/${repo}`;
    if (!parseRepositoryName(repository)) throw new Error("invalid repository");
    return repository;
  } catch {
    badRequest(ctx, "invalid repository");
    return null;
  }
}

function repositoryFromValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const repository = value.trim();
  return parseRepositoryName(repository) ? repository : null;
}

function isEnumValue<Value extends string>(values: readonly Value[], value: unknown): value is Value {
  return typeof value === "string" && values.includes(value as Value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseOptionalId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim();
}

function goalBelongsToRepository(accountId: string, goalId: string, repository: string): boolean {
  return findGoal(accountId, goalId)?.repository === repository;
}

function sendStoreError(ctx: RouteContext, error: unknown): boolean {
  if (error instanceof GrowthStoreValidationError || error instanceof GrowthProfileValidationError) {
    badRequest(ctx, error.message);
    return true;
  }
  return false;
}

async function listWorkspaces(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "workspaces do not accept query parameters");
  const repositories = new Set([
    ...listPersistedGrowthProfileRepositories(account.id),
    ...listGoalRepositories(account.id),
  ]);
  const workspaces = [...repositories]
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .map((repository) => getGrowthWorkspaceSummary(account.id, repository));
  sendJson(ctx.res, 200, { ok: true, workspaces });
}

async function readWorkspace(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "workspace does not accept query parameters");
  const repository = decodeRepositoryParams(ctx);
  if (!repository) return;
  sendJson(ctx.res, 200, { ok: true, workspace: getGrowthWorkspaceSummary(account.id, repository) });
}

const INVALID_SETTINGS_BODY = Symbol("invalid-settings-body");

async function readSettingsBody(ctx: RouteContext): Promise<unknown | typeof INVALID_SETTINGS_BODY> {
  try {
    return await readJsonBody<unknown>(ctx.req);
  } catch {
    sendJson(ctx.res, 400, { ok: false, error: "invalid JSON" });
    return INVALID_SETTINGS_BODY;
  }
}

async function settings(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if ([...ctx.url.searchParams.keys()].length > 0) {
    return badRequest(ctx, "growth settings do not accept query parameters");
  }
  if (ctx.req.method === "GET") {
    return sendJson(ctx.res, 200, { ok: true, settings: getGrowthSettings(account.id) });
  }
  const body = await readSettingsBody(ctx);
  if (body === INVALID_SETTINGS_BODY) return;
  if (ctx.req.method === "DELETE") {
    if (!isRecord(body) || Object.keys(body).length > 0) {
      return badRequest(ctx, "growth settings reset requires an empty body");
    }
    return sendJson(ctx.res, 200, { ok: true, settings: resetGrowthSettings(account.id) });
  }
  try {
    sendJson(ctx.res, 200, { ok: true, settings: saveGrowthSettings(account.id, body) });
  } catch (error) {
    if (error instanceof GrowthSettingsValidationError) return badRequest(ctx, error.message);
    throw error;
  }
}

async function profile(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "profile does not accept query parameters");
  const repository = decodeRepositoryParams(ctx);
  if (!repository) return;
  if (ctx.req.method === "GET") {
    return sendJson(ctx.res, 200, { ok: true, profile: getGrowthProfile(account.id, repository) });
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  try {
    const saved = upsertGrowthProfile(account.id, repository, normalizeGrowthProfileInput(body));
    sendJson(ctx.res, 200, { ok: true, profile: saved });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

function parseInterventionFilters(ctx: RouteContext): { repository?: string; status?: GrowthInterventionStatus; goalId?: string | null } | null {
  const allowed = ["repo", "status", "goalId"] as const;
  if (!hasStrictQueryFields(ctx, allowed, [])) {
    badRequest(ctx, "unknown intervention filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  const statusValue = ctx.url.searchParams.get("status");
  if (statusValue !== null && !isEnumValue(GROWTH_INTERVENTION_STATUSES, statusValue)) {
    badRequest(ctx, "invalid intervention status");
    return null;
  }
  const filters: { repository?: string; status?: GrowthInterventionStatus; goalId?: string | null } = {
    repository: repository ?? undefined,
    status: statusValue ?? undefined,
  };
  if (ctx.url.searchParams.has("goalId")) filters.goalId = ctx.url.searchParams.get("goalId") || null;
  return filters;
}

async function interventions(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (ctx.req.method === "GET") {
    const filters = parseInterventionFilters(ctx);
    if (!filters) return;
    return sendJson(ctx.res, 200, {
      ok: true,
      interventions: listGrowthInterventions(account.id, filters),
    });
  }

  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "intervention creation does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const allowed = ["repository", "goalId", "category", "title", "action"];
  if (!isRecord(body) || !hasOnlyKeys(body, allowed)) return badRequest(ctx, "invalid intervention body");
  const repository = repositoryFromValue(body.repository);
  const goalId = parseOptionalId(body.goalId);
  if (!repository) return badRequest(ctx, "invalid repository");
  if (body.goalId !== undefined && goalId === undefined) return badRequest(ctx, "invalid goalId");
  if (goalId && !goalBelongsToRepository(account.id, goalId, repository)) return badRequest(ctx, "invalid goalId");
  if (!isEnumValue(INTERVENTION_CATEGORIES, body.category)) return badRequest(ctx, "invalid intervention category");
  if (typeof body.title !== "string" || !body.title.trim()) return badRequest(ctx, "title must not be empty");
  if (typeof body.action !== "string" || !body.action.trim()) return badRequest(ctx, "action must not be empty");
  const title = body.title.trim();
  const intervention = upsertGrowthIntervention({
    accountId: account.id,
    repository,
    goalId: goalId ?? null,
    category: body.category,
    title,
    action: body.action.trim(),
    origin: "manual",
    dedupeKey: createGrowthInterventionDedupeKey(repository, goalId ?? null, body.category, title),
  });
  sendJson(ctx.res, 201, { ok: true, intervention });
}

async function generateInterventions(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "intervention generation does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || !hasOnlyKeys(body, ["repository", "goalId"])) {
    return badRequest(ctx, "invalid intervention generation body");
  }
  const repository = repositoryFromValue(body.repository);
  const goalId = parseOptionalId(body.goalId);
  if (!repository) return badRequest(ctx, "invalid repository");
  if (body.goalId !== undefined && (goalId === undefined || goalId === null)) return badRequest(ctx, "invalid goalId");
  const storedGoal = goalId ? findGoal(account.id, goalId) : null;
  if (goalId && !storedGoal) return sendJson(ctx.res, 404, { ok: false, error: "goal not found" });
  if (storedGoal && storedGoal.repository !== repository) return badRequest(ctx, "invalid goalId");

  try {
    const goal = storedGoal ? await refreshGoal(storedGoal) : undefined;
    const suggestions = await generateRepositoryInterventionSuggestions(account.id, repository, goal);
    const generated = suggestions.map((suggestion) => upsertGrowthIntervention({
      accountId: account.id,
      repository,
      goalId: goalId ?? null,
      category: suggestion.category,
      title: suggestion.title.trim(),
      action: suggestion.action.trim(),
      origin: "ai",
      dedupeKey: createGrowthInterventionDedupeKey(
        repository,
        goalId ?? null,
        suggestion.category,
        suggestion.title,
      ),
    }));
    sendJson(ctx.res, 200, {
      ok: true,
      interventions: generated,
      aiEnabled: isAiConfigured(),
    });
  } catch (error) {
    sendJson(ctx.res, 502, { ok: false, error: (error as Error).message });
  }
}

async function scanInterventions(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "intervention scan does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || !hasOnlyKeys(body, ["repository"])) {
    return badRequest(ctx, "invalid intervention scan body");
  }
  const repository = repositoryFromValue(body.repository);
  if (!repository) return badRequest(ctx, "invalid repository");

  try {
    const result = await scanRepositoryGrowthOpportunities(account.id, repository);
    sendJson(ctx.res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(ctx.res, 500, { ok: false, error: (error as Error).message });
  }
}

async function recycleIntervention(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "evergreen recycling does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || Object.keys(body).length > 0) {
    return badRequest(ctx, "invalid evergreen recycling body");
  }

  try {
    const result = recycleEvergreenContent(account.id, ctx.params.id ?? "");
    sendJson(ctx.res, result.duplicate ? 200 : 201, { ok: true, ...result });
  } catch (error) {
    if (error instanceof EvergreenRecycleUnavailableError) {
      return sendJson(ctx.res, 404, { ok: false, error: "evergreen intervention not found" });
    }
    sendJson(ctx.res, 500, { ok: false, error: "evergreen recycling failed" });
  }
}

async function patchIntervention(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "intervention patch does not accept query parameters");
  const current = getGrowthIntervention(account.id, ctx.params.id ?? "");
  if (!current) return sendJson(ctx.res, 404, { ok: false, error: "intervention not found" });
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const allowed = ["goalId", "category", "title", "action", "status"];
  if (!isRecord(body) || Object.keys(body).length === 0 || !hasOnlyKeys(body, allowed)) {
    return badRequest(ctx, "invalid intervention patch");
  }
  const updates: UpdateGrowthInterventionInput = {};
  if (body.goalId !== undefined) {
    const goalId = parseOptionalId(body.goalId);
    if (goalId === undefined) return badRequest(ctx, "invalid goalId");
    if (goalId && !goalBelongsToRepository(account.id, goalId, current.repository)) return badRequest(ctx, "invalid goalId");
    updates.goalId = goalId;
  }
  if (body.category !== undefined) {
    if (!isEnumValue(INTERVENTION_CATEGORIES, body.category)) return badRequest(ctx, "invalid intervention category");
    updates.category = body.category;
  }
  for (const field of ["title", "action"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string" || !body[field].trim()) return badRequest(ctx, `${field} must not be empty`);
      updates[field] = body[field].trim();
    }
  }
  if (body.status !== undefined) {
    if (!isEnumValue(GROWTH_INTERVENTION_STATUSES, body.status)) return badRequest(ctx, "invalid intervention status");
    updates.status = body.status;
  }
  if (updates.title !== undefined || updates.goalId !== undefined || updates.category !== undefined) {
    updates.dedupeKey = createGrowthInterventionDedupeKey(
      current.repository,
      updates.goalId ?? current.goalId,
      updates.category ?? current.category,
      updates.title ?? current.title,
    );
  }
  sendJson(ctx.res, 200, {
    ok: true,
    intervention: updateGrowthIntervention(account.id, current.id, updates),
  });
}

function normalizeMedia(value: unknown): GrowthContentMedia[] | null {
  if (!Array.isArray(value)) return null;
  const result: GrowthContentMedia[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["assetId", "url", "kind", "alt", "caption"])) return null;
    if (entry.kind !== "image" && entry.kind !== "video") return null;
    if (typeof entry.alt !== "string" || !entry.alt.trim()) return null;
    const assetId = parseOptionalId(entry.assetId);
    if (entry.assetId !== undefined && (assetId === undefined || assetId === null)) return null;
    if (entry.url !== undefined && (typeof entry.url !== "string" || !isHttpUrl(entry.url.trim()))) return null;
    if (entry.caption !== undefined && typeof entry.caption !== "string") return null;
    if (!assetId && entry.url === undefined) return null;
    result.push({
      kind: entry.kind,
      alt: entry.alt.trim(),
      ...(assetId ? { assetId } : {}),
      ...(typeof entry.url === "string" ? { url: entry.url.trim() } : {}),
      ...(typeof entry.caption === "string" ? { caption: entry.caption.trim() } : {}),
    });
  }
  return result;
}

function parseContentUpdates(body: Record<string, unknown>, creating: boolean): UpdateGrowthContentItemInput | null {
  const allowed = creating ? CONTENT_CREATE_FIELDS : CONTENT_UPDATE_FIELDS;
  if (!hasOnlyKeys(body, allowed)) return null;
  const updates: UpdateGrowthContentItemInput = {};
  if (body.planId !== undefined) {
    const value = parseOptionalId(body.planId);
    if (value === undefined) return null;
    updates.planId = value;
  }
  if (body.interventionId !== undefined) {
    const value = parseOptionalId(body.interventionId);
    if (value === undefined) return null;
    updates.interventionId = value;
  }
  if (body.goalIds !== undefined) {
    if (!Array.isArray(body.goalIds) || body.goalIds.some((id) => typeof id !== "string" || !id.trim())) return null;
    updates.goalIds = [...new Set(body.goalIds.map((id) => (id as string).trim()))];
  }
  if (body.channel !== undefined) {
    if (!isEnumValue(CONTENT_CHANNELS, body.channel)) return null;
    updates.channel = body.channel as GrowthContentChannel;
  }
  if (body.format !== undefined) {
    if (!isEnumValue(GOAL_PROPOSAL_FORMATS, body.format)) return null;
    updates.format = body.format as GoalProposalFormat;
  }
  for (const field of ["pillar", "angle", "title", "summary", "body"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string") return null;
      updates[field] = body[field];
    }
  }
  if (body.threadPosts !== undefined) {
    if (!Array.isArray(body.threadPosts) || body.threadPosts.some((post) => typeof post !== "string")) return null;
    updates.threadPosts = body.threadPosts as string[];
  }
  if (body.media !== undefined) {
    const media = normalizeMedia(body.media);
    if (!media) return null;
    updates.media = media;
  }
  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources) || body.sources.some((source) => typeof source !== "string" || !isHttpUrl(source.trim()))) return null;
    updates.sources = body.sources.map((source) => (source as string).trim());
  }
  if (body.status !== undefined) {
    if (!isEnumValue(GROWTH_CONTENT_ITEM_STATUSES, body.status)) return null;
    updates.status = body.status as GrowthContentItemStatus;
  }
  for (const field of ["scheduledFor", "generatedAt"] as const) {
    if (body[field] !== undefined) {
      if (!isNullableString(body[field]) || (body[field] !== null && !isIsoDateTime(body[field]))) return null;
      updates[field] = body[field];
    }
  }
  if (body.generationVersion !== undefined) {
    if (!Number.isSafeInteger(body.generationVersion) || (body.generationVersion as number) < 1) return null;
    updates.generationVersion = body.generationVersion as number;
  }
  if (body.evergreen !== undefined) {
    if (body.evergreen !== 0 && body.evergreen !== 1) return null;
    updates.evergreen = body.evergreen;
  }
  return updates;
}

function parseUnifiedCalendarFilters(ctx: RouteContext): GrowthUnifiedCalendarFilters | null {
  const fields = ["scheduledFrom", "scheduledTo"] as const;
  if (!hasStrictQueryFields(ctx, fields, fields)) {
    badRequest(ctx, "invalid unified calendar filter");
    return null;
  }
  const scheduledFrom = ctx.url.searchParams.get("scheduledFrom")!;
  const scheduledTo = ctx.url.searchParams.get("scheduledTo")!;
  const from = parseUtcIsoDateTime(scheduledFrom);
  const to = parseUtcIsoDateTime(scheduledTo);
  if (from === null || to === null || from > to) {
    badRequest(ctx, "invalid unified calendar date range");
    return null;
  }
  return { scheduledFrom, scheduledTo };
}

async function unifiedCalendar(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const filters = parseUnifiedCalendarFilters(ctx);
  if (!filters) return;
  sendJson(ctx.res, 200, {
    ok: true,
    calendar: getGrowthUnifiedCalendar(account.id, filters),
  });
}

interface CalendarExportFilters {
  repository?: string;
  from?: number;
  to?: number;
}

function parseCalendarExportFilters(ctx: RouteContext): CalendarExportFilters | null {
  const allowed = new Set(["repo", "from", "to"]);
  const keys = [...ctx.url.searchParams.keys()];
  if (keys.some((key) => !allowed.has(key)) || [...allowed].some((key) => ctx.url.searchParams.getAll(key).length > 1)) {
    badRequest(ctx, "invalid calendar filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  const fromValue = ctx.url.searchParams.get("from");
  const toValue = ctx.url.searchParams.get("to");
  const from = fromValue === null ? undefined : parseUtcIsoDateTime(fromValue);
  const to = toValue === null ? undefined : parseUtcIsoDateTime(toValue);
  if ((fromValue !== null && from === null) || (toValue !== null && to === null)) {
    badRequest(ctx, "invalid calendar date range");
    return null;
  }
  if (typeof from === "number" && typeof to === "number" && from > to) {
    badRequest(ctx, "invalid calendar date range");
    return null;
  }
  return {
    repository: repository ?? undefined,
    from: from ?? undefined,
    to: to ?? undefined,
  };
}

async function exportCalendar(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const filters = parseCalendarExportFilters(ctx);
  if (!filters) return;
  const contentItems = listContentItems(account.id, {
    repository: filters.repository,
    status: "scheduled",
  }).filter((item) => {
    if (!item.scheduledFor) return false;
    const scheduledFor = Date.parse(item.scheduledFor);
    return !Number.isNaN(scheduledFor)
      && (filters.from === undefined || scheduledFor >= filters.from)
      && (filters.to === undefined || scheduledFor <= filters.to);
  });
  ctx.res.setHeader("Content-Disposition", 'attachment; filename="gitdeck-growth-calendar.ics"');
  send(ctx.res, 200, buildGrowthCalendarIcs(contentItems), "text/calendar; charset=utf-8");
}

function parseContentFilters(ctx: RouteContext): Parameters<typeof listContentItems>[1] | null {
  const allowed = ["repo", "status", "scheduledFrom", "scheduledTo"] as const;
  if (!hasStrictQueryFields(ctx, allowed, [])) {
    badRequest(ctx, "unknown content filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  const statusValue = ctx.url.searchParams.get("status");
  if (statusValue !== null && !isEnumValue(GROWTH_CONTENT_ITEM_STATUSES, statusValue)) {
    badRequest(ctx, "invalid content status");
    return null;
  }
  const scheduledFrom = ctx.url.searchParams.get("scheduledFrom") ?? undefined;
  const scheduledTo = ctx.url.searchParams.get("scheduledTo") ?? undefined;
  if ((scheduledFrom && !isIsoDateTime(scheduledFrom)) || (scheduledTo && !isIsoDateTime(scheduledTo))) {
    badRequest(ctx, "invalid scheduled date range");
    return null;
  }
  return { repository: repository ?? undefined, status: statusValue ?? undefined, scheduledFrom, scheduledTo };
}

function hasStrictQueryFields(ctx: RouteContext, allowed: readonly string[], required: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  const keys = [...ctx.url.searchParams.keys()];
  return keys.every((key) => allowedSet.has(key))
    && allowed.every((key) => ctx.url.searchParams.getAll(key).length <= 1)
    && required.every((key) => ctx.url.searchParams.getAll(key).length === 1);
}

function parsePositiveDimension(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const dimension = Number(value);
  return Number.isSafeInteger(dimension) && dimension <= 100_000 ? dimension : null;
}

function requestContentLength(ctx: RouteContext): number | undefined | null {
  const value = ctx.req.headers["content-length"];
  if (value === undefined) return undefined;
  if (Array.isArray(value) || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

async function assets(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (ctx.req.method === "GET") {
    if (!hasStrictQueryFields(ctx, ["repo"], ["repo"])) return badRequest(ctx, "invalid asset filter");
    const repository = repositoryFromValue(ctx.url.searchParams.get("repo"));
    if (!repository) return badRequest(ctx, "invalid repository");
    return sendJson(ctx.res, 200, {
      ok: true,
      assets: listGrowthAssets(account.id, repository).map(toGrowthAssetMetadata),
    });
  }

  const fields = ["repo", "filename", "title", "alt", "width", "height"] as const;
  if (!hasStrictQueryFields(ctx, fields, ["repo", "filename", "title", "alt"])) {
    return badRequest(ctx, "invalid asset metadata");
  }
  const repository = repositoryFromValue(ctx.url.searchParams.get("repo"));
  const filename = ctx.url.searchParams.get("filename") ?? "";
  const title = ctx.url.searchParams.get("title") ?? "";
  const alt = ctx.url.searchParams.get("alt") ?? "";
  const width = parsePositiveDimension(ctx.url.searchParams.get("width"));
  const height = parsePositiveDimension(ctx.url.searchParams.get("height"));
  const contentLength = requestContentLength(ctx);
  if (!repository) return badRequest(ctx, "invalid repository");
  if (width === null || height === null) return badRequest(ctx, "invalid asset dimensions");
  if (contentLength === null) return badRequest(ctx, "invalid content length");
  const contentType = ctx.req.headers["content-type"];
  if (Array.isArray(contentType)) return badRequest(ctx, "invalid content type");

  try {
    const asset = await persistUploadedGrowthAsset({
      accountId: account.id,
      repository,
      filename,
      title,
      alt,
      width,
      height,
      contentType,
      contentLength,
      body: ctx.req,
    });
    sendJson(ctx.res, 201, { ok: true, asset: toGrowthAssetMetadata(asset) });
  } catch (error) {
    if (error instanceof GrowthAssetTooLargeError) {
      return sendJson(ctx.res, 413, { ok: false, error: error.message });
    }
    if (error instanceof UnsupportedGrowthAssetTypeError) {
      return sendJson(ctx.res, 415, { ok: false, error: error.message });
    }
    if (error instanceof GrowthAssetValidationError) return badRequest(ctx, error.message);
    return sendJson(ctx.res, 500, { ok: false, error: "asset upload failed" });
  }
}

async function assetImportCandidates(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, ["repo"], ["repo"])) return badRequest(ctx, "invalid asset filter");
  const repository = repositoryFromValue(ctx.url.searchParams.get("repo"));
  if (!repository) return badRequest(ctx, "invalid repository");
  try {
    const candidates = await discoverGrowthAssetImportCandidates(account.id, repository);
    sendJson(ctx.res, 200, { ok: true, candidates });
  } catch {
    sendJson(ctx.res, 502, { ok: false, error: "asset candidate discovery failed" });
  }
}

async function importAsset(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "asset import does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const fields = ["repository", "origin", "url", "title", "alt"] as const;
  if (
    !isRecord(body)
    || !hasOnlyKeys(body, fields)
    || fields.some((field) => typeof body[field] !== "string")
  ) return badRequest(ctx, "invalid asset import body");
  const repository = repositoryFromValue(body.repository);
  const origin = body.origin as GrowthAssetImportOrigin;
  if (!repository || (origin !== "readme" && origin !== "website")) {
    return badRequest(ctx, "invalid asset import body");
  }
  try {
    const result = await persistImportedGrowthAsset({
      accountId: account.id,
      repository,
      origin,
      url: body.url as string,
      title: body.title as string,
      alt: body.alt as string,
    });
    sendJson(ctx.res, result.duplicate ? 200 : 201, {
      ok: true,
      asset: toGrowthAssetMetadata(result.asset),
      duplicate: result.duplicate,
    });
  } catch (error) {
    if (error instanceof GrowthAssetTooLargeError) {
      return sendJson(ctx.res, 413, { ok: false, error: error.message });
    }
    if (error instanceof UnsupportedGrowthAssetTypeError) {
      return sendJson(ctx.res, 415, { ok: false, error: error.message });
    }
    if (error instanceof GrowthAssetValidationError) return badRequest(ctx, error.message);
    sendJson(ctx.res, 422, { ok: false, error: "import media is unavailable" });
  }
}

async function createCardAsset(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "card creation does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const fields = ["repository", "template", "title", "alt", "data"] as const;
  if (
    !isRecord(body)
    || Object.keys(body).length !== fields.length
    || !hasOnlyKeys(body, fields)
    || typeof body.repository !== "string"
    || typeof body.template !== "string"
    || typeof body.title !== "string"
    || typeof body.alt !== "string"
  ) return badRequest(ctx, "invalid card asset body");
  const repository = repositoryFromValue(body.repository);
  if (!repository) return badRequest(ctx, "invalid repository");

  try {
    const asset = persistGeneratedGrowthCard({
      accountId: account.id,
      repository,
      template: body.template,
      title: body.title,
      alt: body.alt,
      data: body.data,
    });
    sendJson(ctx.res, 201, { ok: true, asset: toGrowthAssetMetadata(asset) });
  } catch (error) {
    if (error instanceof GrowthAssetValidationError || error instanceof GrowthCardValidationError) {
      return badRequest(ctx, error.message);
    }
    sendJson(ctx.res, 500, { ok: false, error: "card asset creation failed" });
  }
}

async function assetFile(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "asset files do not accept query parameters");
  const file = await readGrowthAssetFile(account.id, ctx.params.id ?? "");
  if (!file) return sendJson(ctx.res, 404, { ok: false, error: "asset not found" });
  ctx.res.writeHead(200, {
    "Content-Type": file.contentType,
    "Content-Length": file.length,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  ctx.res.end(file.body);
}

async function plans(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, ["repo"], ["repo"])) {
    return badRequest(ctx, "invalid plan filter");
  }
  const repository = repositoryFromValue(ctx.url.searchParams.get("repo"));
  if (!repository) return badRequest(ctx, "invalid repository");
  sendJson(ctx.res, 200, { ok: true, plans: listContentPlans(account.id, repository) });
}

async function generatePlan(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "plan generation does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || !hasOnlyKeys(body, ["repository", "periodStart", "periodEnd"])) {
    return badRequest(ctx, "invalid plan generation body");
  }
  const repository = repositoryFromValue(body.repository);
  if (
    !repository
    || typeof body.periodStart !== "string"
    || typeof body.periodEnd !== "string"
  ) return badRequest(ctx, "invalid plan generation body");

  try {
    const result = await generateGrowthContentPlan(account.id, {
      repository,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
    });
    sendJson(ctx.res, 201, { ok: true, ...result });
  } catch (error) {
    if (sendStoreError(ctx, error)) return;
    if (error instanceof RangeError) return badRequest(ctx, error.message);
    sendJson(ctx.res, error instanceof AiRequestError ? 502 : 500, {
      ok: false,
      error: (error as Error).message,
    });
  }
}

async function generateMultiplePlans(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "multi-plan generation does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (
    !isRecord(body)
    || Object.keys(body).length !== 3
    || !hasOnlyKeys(body, ["repositories", "periodStart", "periodEnd"])
    || !Array.isArray(body.repositories)
    || body.repositories.length < 2
    || body.repositories.length > 10
    || typeof body.periodStart !== "string"
    || typeof body.periodEnd !== "string"
  ) return badRequest(ctx, "invalid multi-plan generation body");

  const repositories = body.repositories.map(repositoryFromValue);
  if (repositories.some((repository) => repository === null)) {
    return badRequest(ctx, "invalid multi-plan generation body");
  }
  const validatedRepositories = repositories as string[];
  if (new Set(validatedRepositories.map((repository) => repository.toLocaleLowerCase("en"))).size !== validatedRepositories.length) {
    return badRequest(ctx, "multi-repository planning requires distinct repositories");
  }

  try {
    const result = await generateMultipleGrowthContentPlans(account.id, {
      repositories: validatedRepositories,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
    });
    sendJson(ctx.res, 201, { ok: true, ...result });
  } catch (error) {
    if (sendStoreError(ctx, error)) return;
    if (error instanceof RangeError) return badRequest(ctx, error.message);
    sendJson(ctx.res, error instanceof AiRequestError ? 502 : 500, {
      ok: false,
      error: (error as Error).message,
    });
  }
}

async function regeneratePlan(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "plan regeneration does not accept query parameters");
  const id = ctx.params.id ?? "";
  if (!getContentPlan(account.id, id)) {
    return sendJson(ctx.res, 404, { ok: false, error: "content plan not found" });
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || Object.keys(body).length > 0) {
    return badRequest(ctx, "invalid plan regeneration body");
  }

  try {
    const result = await regenerateGrowthContentPlan(account.id, id);
    if (!result) return sendJson(ctx.res, 404, { ok: false, error: "content plan not found" });
    sendJson(ctx.res, 201, { ok: true, ...result });
  } catch (error) {
    if (sendStoreError(ctx, error)) return;
    if (error instanceof RangeError) return badRequest(ctx, error.message);
    sendJson(ctx.res, error instanceof AiRequestError ? 502 : 500, {
      ok: false,
      error: (error as Error).message,
    });
  }
}

async function archivePlan(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "plan archive does not accept query parameters");
  const id = ctx.params.id ?? "";
  if (!getContentPlan(account.id, id)) {
    return sendJson(ctx.res, 404, { ok: false, error: "content plan not found" });
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || Object.keys(body).length > 0) {
    return badRequest(ctx, "invalid plan archive body");
  }

  const result = archiveContentPlanWithItems(account.id, id);
  if (!result) return sendJson(ctx.res, 404, { ok: false, error: "content plan not found" });
  sendJson(ctx.res, 200, { ok: true, ...result });
}

async function content(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (ctx.req.method === "GET") {
    const filters = parseContentFilters(ctx);
    if (!filters) return;
    return sendJson(ctx.res, 200, { ok: true, contentItems: listContentItems(account.id, filters) });
  }

  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "content creation does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const repository = repositoryFromValue(body.repository);
  const updates = isRecord(body) ? parseContentUpdates(body, true) : null;
  if (!repository || !updates || !isEnumValue(CONTENT_CHANNELS, body.channel) || !isEnumValue(GOAL_PROPOSAL_FORMATS, body.format)) {
    return badRequest(ctx, "invalid content body");
  }
  if (updates.goalIds?.some((goalId) => !goalBelongsToRepository(account.id, goalId, repository))) {
    return badRequest(ctx, "invalid goalIds");
  }
  try {
    if (updates.media) validateContentMediaAttachments(account.id, repository, updates.media);
    const contentItem = createContentItem({
      accountId: account.id,
      repository,
      channel: body.channel,
      format: body.format,
      ...updates,
    });
    sendJson(ctx.res, 201, { ok: true, contentItem });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

function proposalSources(proposal: GoalProposal, repositorySources: ReturnType<typeof getRepositoryContentSources>): string[] {
  return [...new Set([
    ...repositorySources.flatMap((source) => source.type === "website" ? [source.value] : []),
    ...(proposal.mediaSuggestions ?? []).map((media) => media.sourceUrl),
  ])];
}

function reconcileDraftedContent(
  accountId: string,
  intervention: NonNullable<ReturnType<typeof getGrowthIntervention>>,
  proposals: GoalProposal[],
  repositorySources: ReturnType<typeof getRepositoryContentSources>,
  refresh: boolean,
): ReturnType<typeof listContentItems> {
  const existing = listContentItems(accountId, { repository: intervention.repository })
    .filter((item) => item.interventionId === intervention.id);
  const generatedAt = new Date().toISOString();

  return proposals.map((proposal) => {
    const formatItems = existing.filter((item) => item.format === proposal.format);
    const current = [...formatItems].reverse().find((item) => item.generationVersion === SOCIAL_PROPOSALS_VERSION);
    if (!refresh && current) return current;
    const editable = [...formatItems].reverse().find((item) => item.status === "idea" || item.status === "draft");
    const fields = {
      goalIds: intervention.goalId ? [intervention.goalId] : [],
      channel: legacyProposalChannel(proposal.format),
      format: proposal.format,
      title: proposal.title,
      summary: proposal.summary,
      body: proposal.content,
      threadPosts: proposal.threadPosts ?? [],
      media: legacyMediaToContentMedia(proposal.mediaSuggestions),
      sources: proposalSources(proposal, repositorySources),
      status: "draft" as const,
      scheduledFor: null,
      generatedAt,
      generationVersion: SOCIAL_PROPOSALS_VERSION,
    };
    if (editable) return updateContentItem(accountId, editable.id, fields)!;
    return createContentItem({
      accountId,
      repository: intervention.repository,
      interventionId: intervention.id,
      ...fields,
    });
  });
}

async function draftContent(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "content drafting does not accept query parameters");
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (
    !isRecord(body)
    || !hasOnlyKeys(body, ["interventionId", "refresh"])
    || typeof body.interventionId !== "string"
    || !body.interventionId.trim()
    || (body.refresh !== undefined && typeof body.refresh !== "boolean")
  ) return badRequest(ctx, "invalid content draft body");

  const intervention = getGrowthIntervention(account.id, body.interventionId.trim());
  if (!intervention) return sendJson(ctx.res, 404, { ok: false, error: "intervention not found" });
  const refresh = body.refresh === true;
  const existing = listContentItems(account.id, { repository: intervention.repository })
    .filter((item) => item.interventionId === intervention.id && item.generationVersion === SOCIAL_PROPOSALS_VERSION);
  const currentSocialItems = SOCIAL_PROPOSAL_FORMATS.flatMap((format) => {
    const item = [...existing].reverse().find((candidate) => candidate.format === format);
    return item ? [item] : [];
  });
  if (!refresh && currentSocialItems.length === SOCIAL_PROPOSAL_FORMATS.length) {
    return sendJson(ctx.res, 200, { ok: true, contentItems: currentSocialItems, cached: true });
  }

  const goal = intervention.goalId ? findGoal(account.id, intervention.goalId) : null;
  if (intervention.goalId && (!goal || goal.repository !== intervention.repository)) {
    return badRequest(ctx, "intervention has an invalid goal");
  }
  const repositorySources = getRepositoryContentSources(account.id, intervention.repository);
  try {
    const proposals = await generateGoalProposals(
      goal ?? { accountId: account.id, repository: intervention.repository },
      { title: intervention.title, action: intervention.action, category: intervention.category },
      repositorySources,
    );
    if (!proposals.length) return sendJson(ctx.res, 502, { ok: false, error: "AI returned no proposals" });
    const contentItems = reconcileDraftedContent(account.id, intervention, proposals, repositorySources, refresh);
    sendJson(ctx.res, 200, { ok: true, contentItems, cached: false });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return sendJson(ctx.res, 409, { ok: false, error: error.message, aiEnabled: false });
    }
    sendJson(ctx.res, error instanceof AiRequestError ? 502 : 500, { ok: false, error: (error as Error).message });
  }
}

async function draftContentItem(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "content drafting does not accept query parameters");
  if (!getContentItem(account.id, ctx.params.id ?? "")) {
    return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (
    !isRecord(body)
    || !hasOnlyKeys(body, ["refresh"])
    || (body.refresh !== undefined && typeof body.refresh !== "boolean")
  ) return badRequest(ctx, "invalid content draft body");

  try {
    const result = await draftGrowthContentItem(account.id, ctx.params.id ?? "", {
      refresh: body.refresh === true,
    });
    if (!result) return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
    sendJson(ctx.res, 200, { ok: true, ...result });
  } catch (error) {
    if (error instanceof GrowthContentDraftConflictError) {
      return sendJson(ctx.res, 409, { ok: false, error: error.message });
    }
    sendJson(ctx.res, error instanceof AiRequestError ? 502 : 500, {
      ok: false,
      error: (error as Error).message,
    });
  }
}

async function patchContent(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "content patch does not accept query parameters");
  const current = getContentItem(account.id, ctx.params.id ?? "");
  if (!current) return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  const updates = isRecord(body) && Object.keys(body).length > 0 ? parseContentUpdates(body, false) : null;
  if (!updates) return badRequest(ctx, "invalid content patch");
  if (updates.goalIds?.some((goalId) => !goalBelongsToRepository(account.id, goalId, current.repository))) {
    return badRequest(ctx, "invalid goalIds");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "scheduledFor") && updates.status === undefined) {
    updates.status = updates.scheduledFor === null
      ? (current.status === "scheduled" ? "ready" : current.status)
      : "scheduled";
  }
  try {
    if (updates.media) validateContentMediaAttachments(account.id, current.repository, updates.media);
    const contentItem = updateContentItem(account.id, current.id, updates);
    sendJson(ctx.res, 200, { ok: true, contentItem });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

async function publishContent(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "content publication does not accept query parameters");
  if (!getContentItem(account.id, ctx.params.id ?? "")) {
    return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || !hasOnlyKeys(body, ["url"]) || (body.url !== undefined && !isNullableString(body.url))) {
    return badRequest(ctx, "invalid published body");
  }
  try {
    const contentItem = markContentItemPublished(account.id, ctx.params.id ?? "", body.url ?? null);
    sendJson(ctx.res, 200, { ok: true, contentItem });
  } catch (error) {
    if (!sendStoreError(ctx, error)) throw error;
  }
}

async function removeContent(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if (!hasStrictQueryFields(ctx, [], [])) return badRequest(ctx, "content deletion does not accept query parameters");
  if (!deleteContentItem(account.id, ctx.params.id ?? "")) {
    return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  }
  sendJson(ctx.res, 200, { ok: true });
}

function parsePerformanceFilters(ctx: RouteContext): GrowthContentPerformanceFilters | null {
  const allowed = new Set(["repo", "contentId", "window"]);
  const keys = [...ctx.url.searchParams.keys()];
  if (keys.some((key) => !allowed.has(key)) || [...allowed].some((key) => ctx.url.searchParams.getAll(key).length > 1)) {
    badRequest(ctx, "invalid performance filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  const contentIdValue = ctx.url.searchParams.get("contentId");
  const contentId = contentIdValue?.trim();
  if (contentIdValue !== null && !contentId) {
    badRequest(ctx, "invalid content ID");
    return null;
  }
  const windowValue = ctx.url.searchParams.get("window");
  if (windowValue !== null && !isEnumValue(GROWTH_PERFORMANCE_WINDOWS, windowValue)) {
    badRequest(ctx, "invalid performance window");
    return null;
  }
  return {
    repository: repository ?? undefined,
    contentId: contentId ?? undefined,
    window: windowValue ?? undefined,
  };
}

async function performance(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const filters = parsePerformanceFilters(ctx);
  if (!filters) return;
  if (filters.contentId && !getContentItem(account.id, filters.contentId)) {
    return sendJson(ctx.res, 404, { ok: false, error: "content item not found" });
  }
  sendJson(ctx.res, 200, {
    ok: true,
    performance: listContentPerformance(account.id, filters),
  });
}

function parsePerformanceSummaryFilters(ctx: RouteContext): GrowthPerformanceSummaryFilters | null {
  const allowed = new Set(["repo", "from", "to"]);
  const keys = [...ctx.url.searchParams.keys()];
  if (keys.some((key) => !allowed.has(key)) || [...allowed].some((key) => ctx.url.searchParams.getAll(key).length > 1)) {
    badRequest(ctx, "invalid performance summary filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  const from = ctx.url.searchParams.get("from") ?? undefined;
  const to = ctx.url.searchParams.get("to") ?? undefined;
  const fromTimestamp = from === undefined ? undefined : parseUtcIsoDateTime(from);
  const toTimestamp = to === undefined ? undefined : parseUtcIsoDateTime(to);
  if (
    (from !== undefined && fromTimestamp === null)
    || (to !== undefined && toTimestamp === null)
    || (typeof fromTimestamp === "number" && typeof toTimestamp === "number" && fromTimestamp > toTimestamp)
  ) {
    badRequest(ctx, "invalid performance summary date range");
    return null;
  }
  return { repository: repository ?? undefined, from, to };
}

async function performanceSummary(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const filters = parsePerformanceSummaryFilters(ctx);
  if (!filters) return;
  sendJson(ctx.res, 200, {
    ok: true,
    summary: getGrowthPerformanceSummary(account.id, filters),
  });
}

function parseReviewFilters(ctx: RouteContext): GrowthReviewFilters | null {
  if (!hasStrictQueryFields(ctx, ["repo"], [])) {
    badRequest(ctx, "invalid review filter");
    return null;
  }
  const repositoryValue = ctx.url.searchParams.get("repo");
  const repository = repositoryValue === null ? undefined : repositoryFromValue(repositoryValue);
  if (repositoryValue !== null && !repository) {
    badRequest(ctx, "invalid repository");
    return null;
  }
  return { repository: repository ?? undefined };
}

async function review(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  const filters = parseReviewFilters(ctx);
  if (!filters) return;
  const growthReview = await getGrowthWeeklyReview(account.id, filters);
  sendJson(ctx.res, 200, { ok: true, review: growthReview });
}

async function refreshPerformance(ctx: RouteContext): Promise<void> {
  const account = await requireAccount(ctx);
  if (!account) return;
  if ([...ctx.url.searchParams.keys()].length > 0) {
    return badRequest(ctx, "invalid performance refresh filter");
  }
  const body = await parseJsonBody<Record<string, unknown>>(ctx.req, ctx.res);
  if (!body) return;
  if (!isRecord(body) || !hasOnlyKeys(body, ["repository"])) {
    return badRequest(ctx, "invalid performance refresh body");
  }
  const repository = body.repository === undefined ? undefined : repositoryFromValue(body.repository);
  if (body.repository !== undefined && !repository) return badRequest(ctx, "invalid repository");
  try {
    const result = await refreshContentPerformance(account.id, { repository: repository ?? undefined });
    sendJson(ctx.res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(ctx.res, 500, { ok: false, error: (error as Error).message });
  }
}

export function registerGrowthRoutes(router: AppRouter): void {
  router.get("/api/growth/workspaces", listWorkspaces);
  router.get("/api/growth/workspace/:owner/:repo", readWorkspace);
  router.get("/api/growth/settings", settings);
  router.on("PUT", "/api/growth/settings", settings);
  router.delete("/api/growth/settings", settings);
  router.get("/api/growth/profiles/:owner/:repo", profile);
  router.on("PUT", "/api/growth/profiles/:owner/:repo", profile);
  router.get("/api/growth/interventions", interventions);
  router.post("/api/growth/interventions", interventions);
  router.post("/api/growth/interventions/generate", generateInterventions);
  router.post("/api/growth/interventions/scan", scanInterventions);
  router.post("/api/growth/interventions/:id/recycle", recycleIntervention);
  router.on("PATCH", "/api/growth/interventions/:id", patchIntervention);
  router.get("/api/growth/assets", assets);
  router.post("/api/growth/assets", assets);
  router.get("/api/growth/assets/import-candidates", assetImportCandidates);
  router.post("/api/growth/assets/import", importAsset);
  router.post("/api/growth/assets/cards", createCardAsset);
  router.get("/api/growth/assets/:id/file", assetFile);
  router.get("/api/growth/plans", plans);
  router.post("/api/growth/plans/generate", generatePlan);
  router.post("/api/growth/plans/generate-multiple", generateMultiplePlans);
  router.post("/api/growth/plans/:id/regenerate", regeneratePlan);
  router.post("/api/growth/plans/:id/archive", archivePlan);
  router.get("/api/growth/calendar", unifiedCalendar);
  router.get("/api/growth/calendar.ics", exportCalendar);
  router.get("/api/growth/review", review);
  router.get("/api/growth/performance/summary", performanceSummary);
  router.get("/api/growth/performance", performance);
  router.post("/api/growth/performance/refresh", refreshPerformance);
  router.get("/api/growth/content", content);
  router.post("/api/growth/content", content);
  router.post("/api/growth/content/draft", draftContent);
  router.post("/api/growth/content/:id/draft", draftContentItem);
  router.on("PATCH", "/api/growth/content/:id", patchContent);
  router.post("/api/growth/content/:id/published", publishContent);
  router.delete("/api/growth/content/:id", removeContent);
}
