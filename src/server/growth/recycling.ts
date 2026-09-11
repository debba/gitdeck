import type { GrowthContentItem } from "../../types/growth";
import { recycleEvergreenIntervention } from "./store";

export interface GrowthRecycleResult {
  contentItem: GrowthContentItem;
  duplicate: boolean;
}

export class EvergreenRecycleUnavailableError extends Error {
  constructor() {
    super("Evergreen intervention is unavailable or no longer eligible.");
    this.name = "EvergreenRecycleUnavailableError";
  }
}

/** Recycles one eligible account-owned evergreen opportunity without mutating its source. */
export function recycleEvergreenContent(
  accountId: string,
  interventionId: string,
  now = new Date(),
): GrowthRecycleResult {
  if (!accountId.trim() || !interventionId.trim() || Number.isNaN(now.getTime())) {
    throw new EvergreenRecycleUnavailableError();
  }
  const result = recycleEvergreenIntervention(accountId, interventionId, now);
  if (!result) throw new EvergreenRecycleUnavailableError();
  return result;
}
