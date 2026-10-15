import {
  GROWTH_PERFORMANCE_WINDOWS,
  type GrowthContentPerformance,
  type GrowthPendingAttribution,
} from "../../types/growth";
import {
  calculateSnapshotAttribution,
  getAttributionDeadline,
} from "../../utils/growth/attribution";
import { getRepositorySnapshotHistory } from "../snapshots";
import {
  listContentItems,
  listContentPerformance,
  upsertContentPerformance,
} from "./store";

export interface RefreshContentPerformanceOptions {
  repository?: string;
  now?: Date;
}

export interface RefreshContentPerformanceResult {
  performance: GrowthContentPerformance[];
  pending: GrowthPendingAttribution[];
  refreshedAt: string;
}

/** Refreshes due snapshot attribution while retaining incomplete and previously measured work. */
export async function refreshContentPerformance(
  accountId: string,
  options: RefreshContentPerformanceOptions = {},
): Promise<RefreshContentPerformanceResult> {
  const now = options.now ?? new Date();
  const nowTimestamp = now.getTime();
  if (Number.isNaN(nowTimestamp)) throw new RangeError("invalid attribution time");
  const refreshedAt = now.toISOString();
  const contentItems = listContentItems(accountId, {
    repository: options.repository,
    status: "published",
  });
  const repositories = new Map<string, typeof contentItems>();
  for (const item of contentItems) {
    const items = repositories.get(item.repository) ?? [];
    items.push(item);
    repositories.set(item.repository, items);
  }

  const pending: GrowthPendingAttribution[] = [];
  for (const [repository, items] of repositories) {
    const hasDueWindow = items.some((item) => GROWTH_PERFORMANCE_WINDOWS.some((window) => {
      const deadline = getAttributionDeadline(item.publishedAt, window);
      return deadline !== null && Date.parse(deadline) <= nowTimestamp;
    }));
    const snapshots = hasDueWindow ? await getRepositorySnapshotHistory(repository) : [];

    for (const item of items) {
      for (const window of GROWTH_PERFORMANCE_WINDOWS) {
        const attribution = calculateSnapshotAttribution({
          publishedAt: item.publishedAt,
          window,
          snapshots,
          now,
        });
        if (attribution.status === "pending") {
          pending.push({
            contentId: item.id,
            window,
            dueAt: attribution.dueAt,
            reason: attribution.reason,
          });
          continue;
        }
        upsertContentPerformance(accountId, {
          contentId: item.id,
          window,
          measuredAt: refreshedAt,
          metrics: attribution.metrics,
        });
      }
    }
  }

  return {
    performance: listContentPerformance(accountId, { repository: options.repository }),
    pending,
    refreshedAt,
  };
}
