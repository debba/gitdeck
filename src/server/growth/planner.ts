import type {
  CreateGrowthContentItemInput,
  CreateGrowthContentPlanInput,
  GenerateGrowthContentPlanInput,
  GenerateMultipleGrowthContentPlansInput,
  GrowthContentItem,
  GrowthContentPlan,
  GrowthPlanSlot,
  GrowthPlanAssignment,
  GrowthPlanEvidence,
} from "../../types/growth";
import { normalizeGrowthPlanAssignments } from "../../utils/growth/planAssignments";
import { deconflictGrowthPlanSlots } from "../../utils/growth/planDeconfliction";
import { buildGrowthPlanSlots } from "../../utils/growth/planSlots";
import { parseRepositoryName } from "../../utils/repository";
import { AiNotConfiguredError, generateStructured } from "../ai/client";
import { isAiConfigured } from "../ai/settings";
import {
  createContentPlanWithItems,
  createMultipleContentPlansWithItems,
  getContentPlan,
  getGrowthProfile,
  hasOverlappingActiveContentPlan,
  replaceContentPlanWithItems,
  ActivePlanOverlapError,
} from "./store";
import { getPerformanceAdjustedPillars } from "./performance";
import { collectRepositorySignals, type GrowthRepositorySignals } from "./signals";

export const GROWTH_PLANNER_GENERATION_VERSION = 1;

export interface GeneratedGrowthContentPlan {
  plan: GrowthContentPlan;
  contentItems: GrowthContentItem[];
  aiEnabled: boolean;
  usedFallback: boolean;
  weightsAdjusted: boolean;
}

export interface RegeneratedGrowthContentPlan extends GeneratedGrowthContentPlan {
  sourcePlan: GrowthContentPlan;
  affectedContentItems: GrowthContentItem[];
}

export interface GeneratedMultipleGrowthContentPlans {
  plans: GeneratedGrowthContentPlan[];
  deconflictedItemCount: number;
  remainingCollisionCount: number;
}

interface PreparedGrowthContentPlan {
  planInput: CreateGrowthContentPlanInput;
  itemInputs: Array<Omit<CreateGrowthContentItemInput, "accountId" | "repository" | "planId">>;
  aiEnabled: boolean;
  usedFallback: boolean;
  weightsAdjusted: boolean;
}

interface GrowthPlanPreparationContext {
  input: GenerateGrowthContentPlanInput;
  profile: ReturnType<typeof getGrowthProfile>;
  slots: GrowthPlanSlot[];
  weightsAdjusted: boolean;
}

interface PlannerAnswer {
  assignments?: GrowthPlanAssignment[];
}

function additionalEvidence(sources: readonly unknown[]): GrowthPlanEvidence[] {
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return [];
    const record = source as Record<string, unknown>;
    const label = typeof record.title === "string"
      ? record.title
      : typeof record.repository === "string"
        ? record.repository
        : "Additional project source";
    const directUrl = typeof record.url === "string"
      ? record.url
      : typeof record.repository === "string"
        ? `https://github.com/${record.repository}`
        : null;
    const releases = Array.isArray(record.releases) ? record.releases : [];
    return [
      { label, url: directUrl },
      ...releases.flatMap((release) => {
        if (!release || typeof release !== "object" || Array.isArray(release)) return [];
        const item = release as Record<string, unknown>;
        return [{
          label: typeof item.name === "string" ? item.name : "Project release",
          url: typeof item.url === "string" ? item.url : null,
        }];
      }),
    ];
  });
}

function planEvidence(signals: GrowthRepositorySignals): GrowthPlanEvidence[] {
  return [
    {
      label: signals.repositoryMetadata?.description || signals.repository,
      url: signals.repositoryMetadata?.url ?? `https://github.com/${signals.repository}`,
    },
    ...signals.releases.map((release) => ({
      label: release.name || release.tag_name || "Repository release",
      url: release.html_url ?? null,
    })),
    ...signals.recentCommits.slice(0, 10).map((commit) => ({
      label: commit.commit.message.split("\n")[0] || "Repository update",
      url: commit.html_url,
    })),
    ...signals.openIssues.slice(0, 10).map((issue) => ({ label: issue.title, url: issue.url })),
    ...signals.openPullRequests.slice(0, 6).map((pullRequest) => ({
      label: pullRequest.title,
      url: pullRequest.url,
    })),
    ...additionalEvidence(signals.additionalSources),
  ];
}

function plannerContext(signals: GrowthRepositorySignals, evidence: GrowthPlanEvidence[]): Record<string, unknown> {
  return {
    generatedOn: signals.generatedOn,
    repository: signals.repository,
    repositoryMetadata: signals.repositoryMetadata ? {
      description: signals.repositoryMetadata.description,
      primaryLanguage: signals.repositoryMetadata.primaryLanguage?.name ?? null,
      stars: signals.repositoryMetadata.stargazerCount,
      forks: signals.repositoryMetadata.forkCount,
      url: signals.repositoryMetadata.url,
    } : null,
    releases: signals.releases.map((release) => ({
      name: release.name || release.tag_name || null,
      url: release.html_url ?? null,
      publishedAt: release.published_at ?? null,
      notesExcerpt: release.body?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
    })),
    recentCommits: signals.recentCommits.slice(0, 10).map((commit) => ({
      message: commit.commit.message.split("\n")[0],
      url: commit.html_url,
      authoredAt: commit.commit.author?.date ?? null,
    })),
    openIssues: signals.openIssues.slice(0, 10).map((issue) => ({
      title: issue.title,
      url: issue.url,
      updatedAt: issue.updatedAt,
    })),
    openPullRequests: signals.openPullRequests.slice(0, 6).map((pullRequest) => ({
      title: pullRequest.title,
      url: pullRequest.url,
      updatedAt: pullRequest.updatedAt,
      isDraft: pullRequest.isDraft,
    })),
    readmeExcerpt: signals.readme?.excerpt ?? null,
    starHistory: signals.starHistory,
    goals: signals.goals,
    additionalSources: signals.additionalSources,
    allowedEvidence: evidence,
  };
}

async function requestAssignments(
  input: GenerateGrowthContentPlanInput,
  slots: ReturnType<typeof buildGrowthPlanSlots>,
  profile: ReturnType<typeof getGrowthProfile>,
  signals: GrowthRepositorySignals,
  evidence: GrowthPlanEvidence[],
): Promise<unknown> {
  const result = await generateStructured<PlannerAnswer>({
    instructions: [
      "Act as an ethical open-source editorial planner.",
      "Return one assignment for every supplied slot, keyed by its exact slotKey.",
      "Confirm a positive-weight pillar from the supplied profile, write a concise one-line evidence-led angle and CTA, and cite only HTTP or HTTPS URLs present in allowedEvidence.",
      "Use only supplied facts, do not imply unfinished work has shipped, and do not draft the final post.",
      "Return JSON only.",
    ].join(" "),
    input: JSON.stringify({
      repository: input.repository,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      profile: {
        language: profile.language,
        voice: profile.voice,
        audience: profile.audience,
        pillars: profile.pillars,
        hashtags: profile.hashtags,
        avoid: profile.avoid,
      },
      slots,
      evidence: plannerContext(signals, evidence),
    }),
    schemaName: "growth_editorial_plan",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        assignments: {
          type: "array",
          minItems: 0,
          maxItems: slots.length,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              slotKey: { type: "string" },
              pillarId: { type: "string" },
              angle: { type: "string" },
              sources: { type: "array", items: { type: "string", format: "uri" } },
              cta: { type: "string" },
            },
            required: ["slotKey", "pillarId", "angle", "sources", "cta"],
          },
        },
      },
      required: ["assignments"],
    },
    maxOutputTokens: Math.min(16_000, Math.max(1_200, slots.length * 140)),
  });
  return result.data.assignments;
}

function buildGrowthPlanPreparationContext(
  accountId: string,
  input: GenerateGrowthContentPlanInput,
  excludePlanId?: string,
): GrowthPlanPreparationContext {
  const profile = getGrowthProfile(accountId, input.repository);
  const weightAdjustment = getPerformanceAdjustedPillars(
    accountId,
    input.repository,
    profile.pillars,
    input.periodStart,
  );
  const planningProfile = { ...profile, pillars: weightAdjustment.pillars };
  const slots = buildGrowthPlanSlots({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    channels: planningProfile.channels,
    cadence: planningProfile.cadence,
    pillars: planningProfile.pillars,
    postingWindows: planningProfile.postingWindows,
    timezone: planningProfile.timezone,
  });
  if (hasOverlappingActiveContentPlan(
    accountId,
    input.repository,
    input.periodStart,
    input.periodEnd,
    excludePlanId,
  )) {
    throw new ActivePlanOverlapError();
  }
  return {
    input,
    profile: planningProfile,
    slots,
    weightsAdjusted: weightAdjustment.weightsAdjusted,
  };
}

async function assignGrowthPlan(
  accountId: string,
  context: GrowthPlanPreparationContext,
  preserveSlotPillars = false,
): Promise<PreparedGrowthContentPlan> {
  const { input, profile, slots, weightsAdjusted } = context;
  const signals = await collectRepositorySignals(accountId, input.repository);
  const evidence = planEvidence(signals);
  const aiEnabled = isAiConfigured();
  let candidates: unknown = [];
  if (aiEnabled && slots.length > 0) {
    try {
      candidates = await requestAssignments(input, slots, profile, signals, evidence);
    } catch (error) {
      if (!(error instanceof AiNotConfiguredError)) throw error;
    }
  }
  const normalized = normalizeGrowthPlanAssignments(
    input.repository,
    slots,
    profile.pillars,
    evidence,
    candidates,
  );
  const generatedAt = new Date().toISOString();
  return {
    planInput: {
      accountId,
      repository: input.repository,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      cadence: profile.cadence,
      pillars: profile.pillars,
      status: "active",
      generatedAt,
    },
    itemInputs: slots.map((slot, index) => {
      const assignment = normalized.assignments[index];
      return {
        channel: slot.channel,
        format: slot.format,
        goalIds: [],
        pillar: preserveSlotPillars ? slot.pillarId : assignment.pillarId,
        angle: assignment.angle,
        title: "",
        summary: assignment.cta,
        body: "",
        threadPosts: [],
        media: [],
        sources: assignment.sources,
        status: "idea" as const,
        scheduledFor: slot.scheduledFor,
        generatedAt,
        generationVersion: GROWTH_PLANNER_GENERATION_VERSION,
        evergreen: 0 as const,
      };
    }),
    aiEnabled,
    usedFallback: !aiEnabled || normalized.usedFallback,
    weightsAdjusted,
  };
}

async function prepareGrowthContentPlan(
  accountId: string,
  input: GenerateGrowthContentPlanInput,
  excludePlanId?: string,
): Promise<PreparedGrowthContentPlan> {
  return assignGrowthPlan(
    accountId,
    buildGrowthPlanPreparationContext(accountId, input, excludePlanId),
  );
}

/** Builds, enriches, and atomically persists one repository editorial plan. */
export async function generateGrowthContentPlan(
  accountId: string,
  input: GenerateGrowthContentPlanInput,
): Promise<GeneratedGrowthContentPlan> {
  const prepared = await prepareGrowthContentPlan(accountId, input);
  const created = createContentPlanWithItems(prepared.planInput, prepared.itemInputs);
  return {
    ...created,
    aiEnabled: prepared.aiEnabled,
    usedFallback: prepared.usedFallback,
    weightsAdjusted: prepared.weightsAdjusted,
  };
}

/** Prepares every repository before atomically persisting a deconflicted plan set. */
export async function generateMultipleGrowthContentPlans(
  accountId: string,
  input: GenerateMultipleGrowthContentPlansInput,
): Promise<GeneratedMultipleGrowthContentPlans> {
  if (!Array.isArray(input.repositories) || input.repositories.length < 2 || input.repositories.length > 10) {
    throw new RangeError("multi-repository planning requires two through ten repositories");
  }
  if (input.repositories.some((repository) => typeof repository !== "string")) {
    throw new RangeError("invalid repository");
  }
  const repositories = input.repositories.map((repository) => repository.trim());
  if (repositories.some((repository) => !parseRepositoryName(repository))) {
    throw new RangeError("invalid repository");
  }
  const normalizedRepositories = repositories.map((repository) => repository.toLocaleLowerCase("en"));
  if (new Set(normalizedRepositories).size !== repositories.length) {
    throw new RangeError("multi-repository planning requires distinct repositories");
  }

  const contexts = repositories
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }) || left.localeCompare(right, "en"))
    .map((repository) => buildGrowthPlanPreparationContext(accountId, {
      repository,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    }));
  const deconflicted = deconflictGrowthPlanSlots(
    contexts.map((context) => ({
      repository: context.input.repository,
      timezone: context.profile.timezone,
      slots: context.slots,
    })),
    input.periodStart,
    input.periodEnd,
  );
  const deconflictedByRepository = new Map(
    deconflicted.repositories.map(({ repository, slots }) => [repository, slots]),
  );
  const prepared: PreparedGrowthContentPlan[] = [];
  for (const context of contexts) {
    prepared.push(await assignGrowthPlan(accountId, {
      ...context,
      slots: deconflictedByRepository.get(context.input.repository) ?? context.slots,
    }, true));
  }

  const created = createMultipleContentPlansWithItems(accountId, prepared.map(({ planInput, itemInputs }) => ({
    planInput,
    itemInputs,
  })));
  return {
    plans: created.map((result, index) => ({
      ...result,
      aiEnabled: prepared[index].aiEnabled,
      usedFallback: prepared[index].usedFallback,
      weightsAdjusted: prepared[index].weightsAdjusted,
    })),
    deconflictedItemCount: deconflicted.deconflictedItemCount,
    remainingCollisionCount: deconflicted.remainingCollisionCount,
  };
}

/** Builds a replacement before atomically archiving and superseding the source plan. */
export async function regenerateGrowthContentPlan(
  accountId: string,
  sourcePlanId: string,
): Promise<RegeneratedGrowthContentPlan | null> {
  const source = getContentPlan(accountId, sourcePlanId);
  if (!source) return null;
  const prepared = await prepareGrowthContentPlan(accountId, {
    repository: source.repository,
    periodStart: source.periodStart,
    periodEnd: source.periodEnd,
  }, source.id);
  const replaced = replaceContentPlanWithItems(
    accountId,
    source.id,
    prepared.planInput,
    prepared.itemInputs,
  );
  return replaced ? {
    ...replaced,
    aiEnabled: prepared.aiEnabled,
    usedFallback: prepared.usedFallback,
    weightsAdjusted: prepared.weightsAdjusted,
  } : null;
}
