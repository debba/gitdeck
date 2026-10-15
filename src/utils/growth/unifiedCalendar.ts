import {
  GROWTH_CHANNELS,
  GROWTH_CONTENT_ITEM_STATUSES,
  type GrowthContentChannel,
  type GrowthContentItem,
  type GrowthContentItemStatus,
  type GrowthProfile,
  type GrowthUnifiedCalendar,
  type GrowthUnifiedCalendarRepository,
} from "../../types/growth";
import { calendarDateInTimezone, shiftCalendarDate } from "./calendar";
import { createDefaultGrowthProfile } from "./profileDefaults";

const PILLAR_FILTER_SEPARATOR = "::";
const MAX_POSITIVE_TIMEZONE_OFFSET_HOURS = 14;
const MAX_NEGATIVE_TIMEZONE_OFFSET_HOURS = 12;
const HOUR_MS = 60 * 60 * 1_000;
const GROWTH_CONTENT_CHANNELS: readonly GrowthContentChannel[] = [...GROWTH_CHANNELS, "other"];
const GROWTH_UNIFIED_CALENDAR_STATUSES: readonly GrowthContentItemStatus[] = GROWTH_CONTENT_ITEM_STATUSES.filter(
  (status) => status !== "skipped",
);

export interface GrowthUnifiedCalendarFilterState {
  repository: string;
  channel: GrowthContentChannel | "";
  pillar: string;
  status: GrowthContentItemStatus | "";
}

export interface GrowthUnifiedCalendarPillarOption {
  value: string;
  repository: string;
  id: string;
  label: string;
}

export interface GrowthUnifiedCalendarFilterOptions {
  repositories: string[];
  channels: GrowthContentChannel[];
  pillars: GrowthUnifiedCalendarPillarOption[];
  statuses: GrowthContentItemStatus[];
}

export interface GrowthUnifiedCalendarItemPresentation {
  repository: string;
  color: string;
  timezone: string;
  pillarLabel: string;
}

export interface GrowthUnifiedCalendarView {
  itemsByDate: Map<string, GrowthContentItem[]>;
  itemPresentations: Map<string, GrowthUnifiedCalendarItemPresentation>;
  itemCount: number;
}

export const EMPTY_GROWTH_UNIFIED_CALENDAR_FILTERS: GrowthUnifiedCalendarFilterState = {
  repository: "",
  channel: "",
  pillar: "",
  status: "",
};

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" })
    || left.localeCompare(right, "en");
}

function compareContentItems(left: GrowthContentItem, right: GrowthContentItem): number {
  const leftTime = Date.parse(left.scheduledFor!);
  const rightTime = Date.parse(right.scheduledFor!);
  return leftTime - rightTime
    || left.scheduledFor!.localeCompare(right.scheduledFor!)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

function repositoryModel(
  repository: string,
  profile: GrowthProfile,
  contentItems: GrowthContentItem[],
): GrowthUnifiedCalendarRepository {
  return {
    repository,
    color: profile.color,
    timezone: profile.timezone,
    postingWindows: profile.postingWindows.map((window) => ({ ...window })),
    pillarLabels: profile.pillars.map(({ id, label }) => ({ id, label })),
    contentItems: contentItems.sort(compareContentItems),
  };
}

/** Builds a stable account-scoped calendar model without collapsing repository-local calendars. */
export function buildGrowthUnifiedCalendar(
  accountId: string,
  contentItems: readonly GrowthContentItem[],
  persistedProfiles: readonly GrowthProfile[],
): GrowthUnifiedCalendar {
  const profiles = new Map(
    persistedProfiles
      .filter((profile) => profile.accountId === accountId)
      .map((profile) => [profile.repository, profile]),
  );
  const itemsByRepository = new Map<string, GrowthContentItem[]>();

  for (const item of contentItems) {
    if (
      item.accountId !== accountId
      || item.status === "skipped"
      || item.scheduledFor === null
      || Number.isNaN(Date.parse(item.scheduledFor))
    ) continue;
    const repositoryItems = itemsByRepository.get(item.repository);
    if (repositoryItems) repositoryItems.push(item);
    else itemsByRepository.set(item.repository, [item]);
  }

  const repositories = new Set([...profiles.keys(), ...itemsByRepository.keys()]);
  return {
    repositories: [...repositories]
      .sort(compareText)
      .map((repository) => repositoryModel(
        repository,
        profiles.get(repository) ?? createDefaultGrowthProfile(accountId, repository),
        itemsByRepository.get(repository) ?? [],
      )),
  };
}

export function growthUnifiedPillarFilterValue(repository: string, pillarId: string): string {
  return `${repository}${PILLAR_FILTER_SEPARATOR}${pillarId}`;
}

export function readGrowthUnifiedCalendarFilters(search: string): GrowthUnifiedCalendarFilterState {
  const query = new URLSearchParams(search);
  const channel = query.get("channel") ?? "";
  const status = query.get("status") ?? "";
  return {
    repository: query.get("repository") ?? "",
    channel: GROWTH_CONTENT_CHANNELS.includes(channel as GrowthContentChannel)
      ? channel as GrowthContentChannel
      : "",
    pillar: query.get("pillar") ?? "",
    status: GROWTH_UNIFIED_CALENDAR_STATUSES.includes(status as GrowthContentItemStatus)
      ? status as GrowthContentItemStatus
      : "",
  };
}

export function writeGrowthUnifiedCalendarFilters(
  query: URLSearchParams,
  filters: GrowthUnifiedCalendarFilterState,
): URLSearchParams {
  const next = new URLSearchParams(query);
  for (const key of ["repository", "channel", "pillar", "status"] as const) {
    next.delete(key);
    if (filters[key]) next.set(key, filters[key]);
  }
  return next;
}

/** Returns the widest UTC window that can map to the rendered local calendar dates. */
export function growthUnifiedCalendarUtcRange(
  range: { rangeStart: string; rangeEnd: string },
): { scheduledFrom: string; scheduledTo: string } {
  const start = Date.parse(`${range.rangeStart}T00:00:00.000Z`);
  const endExclusive = Date.parse(`${shiftCalendarDate(range.rangeEnd, 1)}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(endExclusive)) {
    throw new RangeError("calendar range must contain valid dates");
  }
  return {
    scheduledFrom: new Date(start - MAX_POSITIVE_TIMEZONE_OFFSET_HOURS * HOUR_MS).toISOString(),
    scheduledTo: new Date(endExclusive + MAX_NEGATIVE_TIMEZONE_OFFSET_HOURS * HOUR_MS - 1).toISOString(),
  };
}

export function growthUnifiedCalendarFilterOptions(
  calendar: GrowthUnifiedCalendar,
): GrowthUnifiedCalendarFilterOptions {
  const channelSet = new Set<GrowthContentChannel>();
  const statusSet = new Set<GrowthContentItemStatus>();
  const pillars: GrowthUnifiedCalendarPillarOption[] = [];
  for (const repository of calendar.repositories) {
    for (const pillar of repository.pillarLabels) {
      pillars.push({
        value: growthUnifiedPillarFilterValue(repository.repository, pillar.id),
        repository: repository.repository,
        id: pillar.id,
        label: pillar.label,
      });
    }
    for (const item of repository.contentItems) {
      channelSet.add(item.channel);
      statusSet.add(item.status);
    }
  }
  return {
    repositories: calendar.repositories.map(({ repository }) => repository),
    channels: GROWTH_CONTENT_CHANNELS.filter((channel) => channelSet.has(channel)),
    pillars,
    statuses: GROWTH_UNIFIED_CALENDAR_STATUSES.filter((status) => statusSet.has(status)),
  };
}

export function filterGrowthUnifiedCalendar(
  calendar: GrowthUnifiedCalendar,
  filters: GrowthUnifiedCalendarFilterState,
  visibleRange: { rangeStart: string; rangeEnd: string },
): GrowthUnifiedCalendarView {
  const itemsByDate = new Map<string, GrowthContentItem[]>();
  const itemPresentations = new Map<string, GrowthUnifiedCalendarItemPresentation>();
  let itemCount = 0;

  for (const repository of calendar.repositories) {
    if (filters.repository && repository.repository !== filters.repository) continue;
    const pillarLabels = new Map(repository.pillarLabels.map(({ id, label }) => [id, label]));
    for (const item of repository.contentItems) {
      if (filters.channel && item.channel !== filters.channel) continue;
      if (filters.status && item.status !== filters.status) continue;
      if (
        filters.pillar
        && growthUnifiedPillarFilterValue(repository.repository, item.pillar) !== filters.pillar
      ) continue;

      let localDate: string;
      try {
        localDate = calendarDateInTimezone(item.scheduledFor!, repository.timezone);
      } catch {
        continue;
      }
      if (localDate < visibleRange.rangeStart || localDate > visibleRange.rangeEnd) continue;
      const entries = itemsByDate.get(localDate);
      if (entries) entries.push(item);
      else itemsByDate.set(localDate, [item]);
      itemPresentations.set(item.id, {
        repository: repository.repository,
        color: repository.color,
        timezone: repository.timezone,
        pillarLabel: item.pillar ? pillarLabels.get(item.pillar) ?? item.pillar : "",
      });
      itemCount += 1;
    }
  }

  for (const entries of itemsByDate.values()) {
    entries.sort((left, right) => compareContentItems(left, right)
      || compareText(left.repository, right.repository));
  }
  return { itemsByDate, itemPresentations, itemCount };
}
