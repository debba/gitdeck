import type { GoalProposalFormat } from "./goals";

export const GROWTH_CHANNELS = [
  "x",
  "linkedin",
  "mastodon",
  "bluesky",
  "discussion",
  "blog",
] as const;
export type GrowthChannel = (typeof GROWTH_CHANNELS)[number];
export type GrowthContentChannel = GrowthChannel | "other";

export interface GrowthPillar {
  id: string;
  label: string;
  weight: number;
  description: string;
}

export interface GrowthPostingWindow {
  /** ISO weekday, from Monday (1) through Sunday (7). */
  weekday: number;
  /** Local hour in the profile timezone, from 0 through 23. */
  hour: number;
}

export type GrowthChannelSelection = Record<GrowthChannel, boolean>;
export type GrowthCadence = Record<GrowthChannel, number>;

export interface GrowthProfile {
  accountId: string;
  repository: string;
  language: string;
  voice: string;
  audience: string;
  channels: GrowthChannelSelection;
  cadence: GrowthCadence;
  pillars: GrowthPillar[];
  hashtags: string[];
  avoid: string;
  timezone: string;
  postingWindows: GrowthPostingWindow[];
  color: string;
  updatedAt: string;
}

export type GrowthProfileInput = Omit<GrowthProfile, "accountId" | "repository" | "updatedAt">;

export interface GrowthSettings {
  timezone: string;
  cadence: GrowthCadence;
  pillars: GrowthPillar[];
}

export interface GrowthSettingsData {
  ok: true;
  settings: GrowthSettings;
}

export interface GrowthPlanSlot {
  key: string;
  channel: GrowthChannel;
  format: GoalProposalFormat;
  pillarId: string;
  scheduledFor: string;
}

export interface GrowthPlanAssignment {
  slotKey: string;
  pillarId: string;
  angle: string;
  sources: string[];
  cta: string;
}

export interface GrowthPlanEvidence {
  label: string;
  url: string | null;
}

export interface BuildGrowthPlanSlotsInput {
  periodStart: string;
  periodEnd: string;
  channels: GrowthChannelSelection;
  cadence: GrowthCadence;
  pillars: readonly GrowthPillar[];
  postingWindows: readonly GrowthPostingWindow[];
  timezone: string;
}

export const GROWTH_INTERVENTION_STATUSES = ["proposed", "accepted", "dismissed", "done"] as const;
export type GrowthInterventionStatus = (typeof GROWTH_INTERVENTION_STATUSES)[number];
export type GrowthInterventionCategory = "product" | "community" | "engineering" | "marketing";
export type GrowthInterventionOrigin = "ai" | "rule" | "manual";

export interface GrowthIntervention {
  id: string;
  accountId: string;
  repository: string;
  goalId: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
  origin: GrowthInterventionOrigin;
  ruleKey: string | null;
  dedupeKey: string;
  status: GrowthInterventionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGrowthInterventionInput {
  accountId: string;
  repository: string;
  goalId?: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
  origin: GrowthInterventionOrigin;
  ruleKey?: string | null;
  dedupeKey: string;
  status?: GrowthInterventionStatus;
}

export interface GrowthInterventionFilters {
  repository?: string;
  goalId?: string | null;
  status?: GrowthInterventionStatus;
}

export interface UpsertGrowthRuleInterventionInput {
  accountId: string;
  repository: string;
  goalId?: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
  ruleKey: string;
}

export type UpdateGrowthInterventionInput = Partial<Pick<
  GrowthIntervention,
  "goalId" | "category" | "title" | "action" | "dedupeKey" | "status"
>>;

export type GrowthContentPlanStatus = "draft" | "active" | "archived";

export interface GrowthContentPlan {
  id: string;
  accountId: string;
  repository: string;
  periodStart: string;
  periodEnd: string;
  cadence: GrowthCadence;
  pillars: GrowthPillar[];
  status: GrowthContentPlanStatus;
  generatedAt: string;
  createdAt: string;
}

export interface CreateGrowthContentPlanInput {
  accountId: string;
  repository: string;
  periodStart: string;
  periodEnd: string;
  cadence: GrowthCadence;
  pillars: GrowthPillar[];
  status?: Exclude<GrowthContentPlanStatus, "archived">;
  generatedAt?: string;
}

export interface GenerateGrowthContentPlanInput {
  repository: string;
  periodStart: string;
  periodEnd: string;
}

export interface GenerateMultipleGrowthContentPlansInput {
  repositories: string[];
  periodStart: string;
  periodEnd: string;
}

export const GROWTH_CONTENT_ITEM_STATUSES = [
  "idea",
  "draft",
  "ready",
  "scheduled",
  "published",
  "skipped",
] as const;
export type GrowthContentItemStatus = (typeof GROWTH_CONTENT_ITEM_STATUSES)[number];

export interface GrowthContentMedia {
  assetId?: string;
  url?: string;
  kind: "image" | "video";
  alt: string;
  caption?: string;
}

export interface GrowthContentItem {
  id: string;
  accountId: string;
  repository: string;
  planId: string | null;
  interventionId: string | null;
  goalIds: string[];
  channel: GrowthContentChannel;
  format: GoalProposalFormat;
  pillar: string;
  angle: string;
  title: string;
  summary: string;
  body: string;
  threadPosts: string[];
  media: GrowthContentMedia[];
  sources: string[];
  status: GrowthContentItemStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  generatedAt: string | null;
  generationVersion: number;
  evergreen: 0 | 1;
  createdAt: string;
  updatedAt: string;
}

export type CreateGrowthContentItemInput = Pick<
  GrowthContentItem,
  "accountId" | "repository" | "channel" | "format"
> & Partial<Pick<
  GrowthContentItem,
  | "planId"
  | "interventionId"
  | "goalIds"
  | "pillar"
  | "angle"
  | "title"
  | "summary"
  | "body"
  | "threadPosts"
  | "media"
  | "sources"
  | "status"
  | "scheduledFor"
  | "publishedAt"
  | "publishedUrl"
  | "generatedAt"
  | "generationVersion"
  | "evergreen"
>>;

export type UpdateGrowthContentItemInput = Partial<Pick<
  GrowthContentItem,
  | "planId"
  | "interventionId"
  | "goalIds"
  | "channel"
  | "format"
  | "pillar"
  | "angle"
  | "title"
  | "summary"
  | "body"
  | "threadPosts"
  | "media"
  | "sources"
  | "status"
  | "scheduledFor"
  | "publishedAt"
  | "publishedUrl"
  | "generatedAt"
  | "generationVersion"
  | "evergreen"
>>;

export interface GrowthContentItemFilters {
  repository?: string;
  status?: GrowthContentItemStatus;
  scheduledFrom?: string;
  scheduledTo?: string;
}

export interface GrowthUnifiedCalendarFilters {
  scheduledFrom: string;
  scheduledTo: string;
}

export interface GrowthUnifiedCalendarPillarLabel {
  id: string;
  label: string;
}

export interface GrowthUnifiedCalendarRepository {
  repository: string;
  color: string;
  timezone: string;
  postingWindows: GrowthPostingWindow[];
  pillarLabels: GrowthUnifiedCalendarPillarLabel[];
  contentItems: GrowthContentItem[];
}

export interface GrowthUnifiedCalendar {
  repositories: GrowthUnifiedCalendarRepository[];
}

export interface GrowthUnifiedCalendarData {
  ok: true;
  calendar: GrowthUnifiedCalendar;
}

export const GROWTH_CARD_TEMPLATES = [
  "release",
  "milestone",
  "stats",
  "quote",
  "whats-new",
] as const;
export type GrowthCardTemplate = (typeof GROWTH_CARD_TEMPLATES)[number];

export interface GrowthReleaseCardData {
  version: string;
  highlights: string[];
}

export interface GrowthMilestoneCardData {
  value: number;
  label: string;
  detail: string;
}

export interface GrowthStatsCardData {
  stats: Array<{ label: string; value: number }>;
}

export interface GrowthQuoteCardData {
  quote: string;
  attribution: string;
}

export interface GrowthWhatsNewCardData {
  items: string[];
}

export interface GrowthCardDataByTemplate {
  release: GrowthReleaseCardData;
  milestone: GrowthMilestoneCardData;
  stats: GrowthStatsCardData;
  quote: GrowthQuoteCardData;
  "whats-new": GrowthWhatsNewCardData;
}

export type GrowthCardData = GrowthCardDataByTemplate[GrowthCardTemplate];
export type CreateGrowthCardInput = {
  [Template in GrowthCardTemplate]: {
    repository: string;
    template: Template;
    title: string;
    alt: string;
    data: GrowthCardDataByTemplate[Template];
  };
}[GrowthCardTemplate];

export type GrowthAssetKind = "image" | "video";
export type GrowthAssetOrigin = "upload" | "readme" | "website" | "generated";
export type GrowthAssetImportOrigin = Extract<GrowthAssetOrigin, "readme" | "website">;
export const MAX_GROWTH_ASSET_BYTES = 25 * 1024 * 1024;
export const GROWTH_ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
] as const;
export type GrowthAssetMimeType = (typeof GROWTH_ASSET_MIME_TYPES)[number];

export interface GrowthAsset {
  id: string;
  accountId: string;
  repository: string;
  kind: GrowthAssetKind;
  origin: GrowthAssetOrigin;
  path: string | null;
  url: string | null;
  title: string;
  alt: string;
  width: number | null;
  height: number | null;
  cardTemplate: string | null;
  cardData: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateGrowthAssetInput {
  accountId: string;
  repository: string;
  kind: GrowthAssetKind;
  origin: GrowthAssetOrigin;
  path?: string | null;
  url?: string | null;
  title: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  cardTemplate?: string | null;
  cardData?: Record<string, unknown> | null;
}

/** Asset metadata safe to return to a browser. Stored filesystem paths are omitted. */
export type GrowthAssetMetadata = Omit<GrowthAsset, "path">;

export interface GrowthAssetsData {
  ok: true;
  assets: GrowthAssetMetadata[];
}

export interface GrowthAssetImportCandidate {
  origin: GrowthAssetImportOrigin;
  source: string;
  url: string;
  title: string;
  alt: string;
}

export interface GrowthAssetImportCandidatesData {
  ok: true;
  candidates: GrowthAssetImportCandidate[];
}

export interface ImportGrowthAssetInput {
  repository: string;
  origin: GrowthAssetImportOrigin;
  url: string;
  title: string;
  alt: string;
}

export interface GrowthAssetData {
  ok: true;
  asset: GrowthAssetMetadata;
}

export interface GrowthImportedAssetData extends GrowthAssetData {
  duplicate: boolean;
}

export interface UploadGrowthAssetInput {
  repository: string;
  file: Blob;
  filename: string;
  title: string;
  alt: string;
  width?: number;
  height?: number;
}

export const GROWTH_PERFORMANCE_WINDOWS = ["48h", "7d"] as const;
export type GrowthPerformanceWindow = (typeof GROWTH_PERFORMANCE_WINDOWS)[number];

export interface GrowthPerformanceMetrics {
  starsDelta?: number;
  forksDelta?: number;
  closedPrsDelta?: number;
  releaseDownloadsDelta?: number;
  [metric: string]: number | undefined;
}

export interface GrowthContentPerformance {
  accountId: string;
  contentId: string;
  window: GrowthPerformanceWindow;
  measuredAt: string;
  metrics: GrowthPerformanceMetrics;
}

export type UpsertGrowthContentPerformanceInput = Omit<GrowthContentPerformance, "accountId">;

export interface GrowthContentPerformanceFilters {
  repository?: string;
  contentId?: string;
  window?: GrowthPerformanceWindow;
}

export type GrowthAttributionPendingReason =
  | "missing-publication"
  | "not-due"
  | "snapshot-unavailable";

export interface GrowthPendingAttribution {
  contentId: string;
  window: GrowthPerformanceWindow;
  dueAt: string | null;
  reason: GrowthAttributionPendingReason;
}

export interface GrowthContentPerformanceData {
  ok: true;
  performance: GrowthContentPerformance[];
}

export interface GrowthContentPerformanceRefreshData extends GrowthContentPerformanceData {
  pending: GrowthPendingAttribution[];
  refreshedAt: string;
}

export const GROWTH_PERFORMANCE_METRIC_KEYS = [
  "starsDelta",
  "forksDelta",
  "closedPrsDelta",
  "releaseDownloadsDelta",
] as const;
export type GrowthPerformanceMetricKey = (typeof GROWTH_PERFORMANCE_METRIC_KEYS)[number];
export type GrowthPerformanceMetricTotals = Required<Pick<
  GrowthPerformanceMetrics,
  GrowthPerformanceMetricKey
>> & Record<string, number>;

/** Collision-safe grouping key that display consumers can replace with localized copy. */
export const GROWTH_UNASSIGNED_PILLAR_KEY = "__unassigned__" as const;

export interface GrowthPerformanceGroupSummary {
  key: string;
  measuredItems: number;
  metrics: GrowthPerformanceMetricTotals;
}

export interface GrowthPerformanceWindowSummary {
  window: GrowthPerformanceWindow;
  measuredItems: number;
  metrics: GrowthPerformanceMetricTotals;
  channels: GrowthPerformanceGroupSummary[];
  pillars: GrowthPerformanceGroupSummary[];
}

export interface GrowthPerformanceSummary {
  windows: GrowthPerformanceWindowSummary[];
}

export interface GrowthPerformanceSummaryFilters {
  repository?: string;
  from?: string;
  to?: string;
}

export interface GrowthPerformanceSummaryData {
  ok: true;
  summary: GrowthPerformanceSummary;
}

export interface GrowthReviewPeriod {
  start: string;
  end: string;
}

export interface GrowthReviewContentItem {
  id: string;
  repository: string;
  title: string;
  channel: GrowthContentChannel;
  pillar: string;
  status: GrowthContentItemStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
}

export interface GrowthReviewPublishedItem extends GrowthReviewContentItem {
  performance: Array<{
    window: GrowthPerformanceWindow;
    measuredAt: string;
    metrics: GrowthPerformanceMetricTotals;
  }>;
}

export interface GrowthReviewFinding {
  dimension: "channel" | "pillar";
  window: GrowthPerformanceWindow;
  key: string;
  measuredItems: number;
  metrics: GrowthPerformanceMetricTotals;
  direction: "positive" | "neutral" | "negative";
}

export type GrowthReviewRecommendationKind =
  | "recover-missed"
  | "repeat-channel"
  | "reinforce-pillar"
  | "prepare-upcoming"
  | "advance-intervention"
  | "measure-results"
  | "build-baseline";

export interface GrowthReviewRecommendation {
  id: string;
  kind: GrowthReviewRecommendationKind;
  title: string;
  action: string;
  repository: string | null;
}

export interface GrowthWeeklyReview {
  generatedAt: string;
  repository: string | null;
  reviewPeriod: GrowthReviewPeriod;
  upcomingPeriod: GrowthReviewPeriod;
  publishedItems: GrowthReviewPublishedItem[];
  missedItems: GrowthReviewContentItem[];
  upcomingItems: GrowthReviewContentItem[];
  performance: GrowthPerformanceSummary;
  channelFindings: GrowthReviewFinding[];
  pillarFindings: GrowthReviewFinding[];
  recommendations: GrowthReviewRecommendation[];
  narrative: string;
  empty: boolean;
  aiEnabled: boolean;
  usedFallback: boolean;
}

export interface GrowthReviewFilters {
  repository?: string;
}

export interface GrowthReviewData {
  ok: true;
  review: GrowthWeeklyReview;
}

export interface GrowthWorkspaceSummary {
  repository: string;
  color: string;
  interventionsByStatus: Record<GrowthInterventionStatus, number>;
  contentItemsByStatus: Record<GrowthContentItemStatus, number>;
  nextSevenDays: GrowthContentItem[];
}

export interface GrowthWorkspacesData {
  ok: true;
  workspaces: GrowthWorkspaceSummary[];
}

export interface GrowthWorkspaceData {
  ok: true;
  workspace: GrowthWorkspaceSummary;
}

export interface GrowthProfileData {
  ok: true;
  profile: GrowthProfile;
}

export interface GrowthInterventionsData {
  ok: true;
  interventions: GrowthIntervention[];
}

export interface GrowthInterventionData {
  ok: true;
  intervention: GrowthIntervention;
}

export interface GrowthGeneratedInterventionsData extends GrowthInterventionsData {
  aiEnabled: boolean;
}

export interface GrowthScannedInterventionsData extends GrowthInterventionsData {
  scannedAt: string;
}

export interface GrowthMergedPullRequestSignal {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface GrowthOpportunity {
  ruleKey: string;
  goalId: string | null;
  category: GrowthInterventionCategory;
  title: string;
  action: string;
}

export interface GrowthContentPlansData {
  ok: true;
  plans: GrowthContentPlan[];
}

export interface GrowthGeneratedContentPlanData {
  ok: true;
  plan: GrowthContentPlan;
  contentItems: GrowthContentItem[];
  aiEnabled: boolean;
  usedFallback: boolean;
  weightsAdjusted: boolean;
}

export type GrowthGeneratedContentPlanResult = Omit<GrowthGeneratedContentPlanData, "ok">;

export interface GrowthGeneratedMultipleContentPlansData {
  ok: true;
  plans: GrowthGeneratedContentPlanResult[];
  deconflictedItemCount: number;
  remainingCollisionCount: number;
}

export interface GrowthArchivedContentPlanData {
  ok: true;
  plan: GrowthContentPlan;
  contentItems: GrowthContentItem[];
}

export interface GrowthRegeneratedContentPlanData extends GrowthGeneratedContentPlanData {
  sourcePlan: GrowthContentPlan;
  affectedContentItems: GrowthContentItem[];
}

export interface GrowthContentItemsData {
  ok: true;
  contentItems: GrowthContentItem[];
}

export interface GrowthContentItemData {
  ok: true;
  contentItem: GrowthContentItem;
}

export interface GrowthRecycledContentData extends GrowthContentItemData {
  duplicate: boolean;
}

export interface GrowthDraftContentData extends GrowthContentItemsData {
  cached: boolean;
}

export interface GrowthDraftContentItemData extends GrowthContentItemData {
  aiEnabled: boolean;
  usedFallback: boolean;
  cached: boolean;
  mediaRequired: boolean;
}
