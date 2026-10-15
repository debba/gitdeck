import type { GrowthPlanSlot } from "../../types/growth";
import {
  calendarDateInTimezone,
  rescheduleGrowthCalendarInstant,
  shiftCalendarDate,
} from "./calendar";

export interface RepositoryGrowthPlanSlots {
  repository: string;
  timezone: string;
  slots: readonly GrowthPlanSlot[];
}

export interface DeconflictedGrowthPlanSlots {
  repositories: Array<{
    repository: string;
    timezone: string;
    slots: GrowthPlanSlot[];
  }>;
  deconflictedItemCount: number;
  remainingCollisionCount: number;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" })
    || left.localeCompare(right, "en");
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function periodDates(periodStart: string, periodEnd: string): string[] {
  if (!validDate(periodStart) || !validDate(periodEnd)) {
    throw new RangeError("plan period must use valid YYYY-MM-DD dates");
  }
  const dates: string[] = [];
  for (let date = periodStart; date <= periodEnd && dates.length <= 28; date = shiftCalendarDate(date, 1)) {
    dates.push(date);
  }
  if (
    dates.length < 7
    || dates.length > 28
    || dates.length % 7 !== 0
    || dates[dates.length - 1] !== periodEnd
    || new Date(`${periodStart}T00:00:00.000Z`).getUTCDay() !== 1
    || new Date(`${periodEnd}T00:00:00.000Z`).getUTCDay() !== 0
  ) {
    throw new RangeError("plan period must contain one to four complete ISO weeks from Monday through Sunday");
  }
  return dates;
}

function nearestFreeDate(
  originalDate: string,
  dates: readonly string[],
  occupied: ReadonlySet<string>,
): string | null {
  const originalIndex = dates.indexOf(originalDate);
  if (originalIndex < 0) throw new RangeError("plan slot must stay inside the requested period");
  for (let distance = 1; distance < dates.length; distance += 1) {
    const forward = dates[originalIndex + distance];
    if (forward && !occupied.has(forward)) return forward;
    const backward = dates[originalIndex - distance];
    if (backward && !occupied.has(backward)) return backward;
  }
  return null;
}

/** Staggers same-pillar local dates in stable repository and slot order. */
export function deconflictGrowthPlanSlots(
  input: readonly RepositoryGrowthPlanSlots[],
  periodStart: string,
  periodEnd: string,
): DeconflictedGrowthPlanSlots {
  const dates = periodDates(periodStart, periodEnd);
  const repositories = input
    .map((entry) => ({
      repository: entry.repository,
      timezone: entry.timezone,
      slots: entry.slots.map((slot) => ({ ...slot })),
    }))
    .sort((left, right) => compareText(left.repository, right.repository));
  const occupiedByPillar = new Map<string, Set<string>>();
  let deconflictedItemCount = 0;
  let remainingCollisionCount = 0;

  for (const repository of repositories) {
    const stableSlots = repository.slots
      .map((slot, index) => ({ slot, index }))
      .sort((left, right) => (
        left.slot.key.localeCompare(right.slot.key)
        || left.slot.scheduledFor.localeCompare(right.slot.scheduledFor)
        || left.index - right.index
      ));

    for (const { slot, index } of stableSlots) {
      const originalDate = calendarDateInTimezone(slot.scheduledFor, repository.timezone);
      if (!dates.includes(originalDate)) {
        throw new RangeError("plan slot must stay inside the requested period");
      }
      const occupied = occupiedByPillar.get(slot.pillarId) ?? new Set<string>();
      if (!occupiedByPillar.has(slot.pillarId)) occupiedByPillar.set(slot.pillarId, occupied);
      if (!occupied.has(originalDate)) {
        occupied.add(originalDate);
        continue;
      }

      const targetDate = nearestFreeDate(originalDate, dates, occupied);
      if (!targetDate) {
        remainingCollisionCount += 1;
        continue;
      }
      repository.slots[index] = {
        ...slot,
        scheduledFor: rescheduleGrowthCalendarInstant(
          slot.scheduledFor,
          targetDate,
          repository.timezone,
        ),
      };
      occupied.add(targetDate);
      deconflictedItemCount += 1;
    }
  }

  return { repositories, deconflictedItemCount, remainingCollisionCount };
}
