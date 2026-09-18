import type {
  GrowthUnifiedCalendar,
  GrowthUnifiedCalendarFilters,
} from "../../types/growth";
import { parseUtcIsoDateTime } from "../../utils/growth/performanceSummary";
import { buildGrowthUnifiedCalendar } from "../../utils/growth/unifiedCalendar";
import {
  getGrowthProfile,
  listContentItems,
  listPersistedGrowthProfileRepositories,
} from "./store";

function normalizedRange(filters: GrowthUnifiedCalendarFilters): GrowthUnifiedCalendarFilters {
  const from = parseUtcIsoDateTime(filters.scheduledFrom);
  const to = parseUtcIsoDateTime(filters.scheduledTo);
  if (from === null || to === null || from > to) {
    throw new RangeError("invalid unified calendar date range");
  }
  return {
    scheduledFrom: new Date(from).toISOString(),
    scheduledTo: new Date(to).toISOString(),
  };
}

/** Reads only persisted, account-owned calendar data inside an inclusive UTC range. */
export function getGrowthUnifiedCalendar(
  accountId: string,
  filters: GrowthUnifiedCalendarFilters,
): GrowthUnifiedCalendar {
  const range = normalizedRange(filters);
  const contentItems = listContentItems(accountId, range);
  const profiles = listPersistedGrowthProfileRepositories(accountId)
    .map((repository) => getGrowthProfile(accountId, repository));
  return buildGrowthUnifiedCalendar(accountId, contentItems, profiles);
}
