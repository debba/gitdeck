import {
  GROWTH_CHANNELS,
  type BuildGrowthPlanSlotsInput,
  type GrowthChannel,
  type GrowthPillar,
  type GrowthPlanSlot,
  type GrowthPostingWindow,
} from "../../types/growth";
import type { GoalProposalFormat } from "../../types/goals";

const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;

const CHANNEL_FORMATS: Record<GrowthChannel, GoalProposalFormat> = {
  x: "x-thread",
  linkedin: "linkedin-post",
  mastodon: "mastodon-post",
  bluesky: "post",
  discussion: "discussion",
  blog: "doc",
};

interface ParsedDate {
  year: number;
  month: number;
  day: number;
  timestamp: number;
}

interface PendingSlot {
  key: string;
  channel: GrowthChannel;
  format: GoalProposalFormat;
  scheduledFor: string;
}

function parseDateOnly(value: string, field: string): ParsedDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`${field} must use YYYY-MM-DD format`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new RangeError(`${field} must be a valid calendar date`);
  }

  return { year, month, day, timestamp: date.getTime() };
}

function formatDateOnly(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoWeekday(timestamp: number): number {
  return new Date(timestamp).getUTCDay() || 7;
}

function validatePeriod(periodStart: string, periodEnd: string): {
  startTimestamp: number;
  weeks: number;
} {
  const start = parseDateOnly(periodStart, "periodStart");
  const end = parseDateOnly(periodEnd, "periodEnd");
  const inclusiveDays = (end.timestamp - start.timestamp) / DAY_MS + 1;

  if (
    isoWeekday(start.timestamp) !== 1
    || isoWeekday(end.timestamp) !== 7
    || !Number.isInteger(inclusiveDays)
    || inclusiveDays < 7
    || inclusiveDays > 28
    || inclusiveDays % 7 !== 0
  ) {
    throw new RangeError("plan period must contain one to four complete ISO weeks from Monday through Sunday");
  }

  return { startTimestamp: start.timestamp, weeks: inclusiveDays / 7 };
}

export interface GrowthPlanPeriod {
  periodStart: string;
  periodEnd: string;
}

/** Builds a complete one-to-four-week plan period from an ISO Monday. */
export function growthPlanPeriodFromStart(periodStart: string, weeks: number): GrowthPlanPeriod {
  const start = parseDateOnly(periodStart, "periodStart");
  if (isoWeekday(start.timestamp) !== 1 || !Number.isInteger(weeks) || weeks < 1 || weeks > 4) {
    throw new RangeError("plan period must contain one to four complete ISO weeks from Monday through Sunday");
  }
  const periodEnd = formatDateOnly(start.timestamp + weeks * WEEK_MS - DAY_MS);
  validatePeriod(periodStart, periodEnd);
  return { periodStart, periodEnd };
}

/** Returns the complete ISO week strictly following the week containing now. */
export function nextGrowthPlanPeriod(now = new Date(), weeks = 1): GrowthPlanPeriod {
  if (Number.isNaN(now.getTime())) throw new RangeError("now must be a valid date");
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const nextMonday = today + (8 - isoWeekday(today)) * DAY_MS;
  return growthPlanPeriodFromStart(formatDateOnly(nextMonday), weeks);
}

function createTimezoneFormatter(timezone: string): Intl.DateTimeFormat {
  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    throw new RangeError("timezone must be a valid IANA timezone");
  }
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new RangeError("timezone must be a valid IANA timezone");
  }
}

function timezoneOffsetAt(formatter: Intl.DateTimeFormat, timestamp: number): number {
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  ) - timestamp;
}

function localHourToUtc(
  localDate: string,
  hour: number,
  formatter: Intl.DateTimeFormat,
): string {
  const { year, month, day } = parseDateOnly(localDate, "posting date");
  const localTimestamp = Date.UTC(year, month - 1, day, hour);
  const firstCandidate = localTimestamp - timezoneOffsetAt(formatter, localTimestamp);
  const correctedCandidate = localTimestamp - timezoneOffsetAt(formatter, firstCandidate);
  return new Date(correctedCandidate).toISOString();
}

function validateChannels(input: BuildGrowthPlanSlotsInput): void {
  for (const channel of GROWTH_CHANNELS) {
    if (typeof input.channels[channel] !== "boolean") {
      throw new RangeError(`channels.${channel} must be a boolean`);
    }
    if (
      !Number.isInteger(input.cadence[channel])
      || input.cadence[channel] < 0
      || input.cadence[channel] > 14
    ) {
      throw new RangeError(`cadence.${channel} must be an integer from 0 through 14`);
    }
  }
}

function positivePillars(pillars: readonly GrowthPillar[]): GrowthPillar[] {
  const positive = pillars.filter(({ weight }) => Number.isFinite(weight) && weight > 0);
  if (positive.length === 0) throw new RangeError("at least one pillar must have a positive weight");
  return positive;
}

function normalizePostingWindows(
  postingWindows: readonly GrowthPostingWindow[],
): GrowthPostingWindow[] {
  const unique = new Map<string, GrowthPostingWindow>();
  for (const window of postingWindows) {
    if (!Number.isInteger(window.weekday) || window.weekday < 1 || window.weekday > 7) {
      throw new RangeError("posting window weekday must be an integer from 1 through 7");
    }
    if (!Number.isInteger(window.hour) || window.hour < 0 || window.hour > 23) {
      throw new RangeError("posting window hour must be an integer from 0 through 23");
    }
    unique.set(`${window.weekday}:${window.hour}`, { ...window });
  }
  return [...unique.values()].sort((left, right) => (
    left.weekday - right.weekday || left.hour - right.hour
  ));
}

function fallbackWindows(count: number): GrowthPostingWindow[] {
  return Array.from({ length: count }, (_, index) => ({
    weekday: Math.floor(index * 7 / count) + 1,
    hour: 10,
  }));
}

function selectWindows(
  postingWindows: readonly GrowthPostingWindow[],
  count: number,
): GrowthPostingWindow[] {
  if (postingWindows.length === 0) return fallbackWindows(count);
  if (count === 1) return [postingWindows[0]];

  return Array.from({ length: count }, (_, index) => (
    postingWindows[Math.round(index * (postingWindows.length - 1) / (count - 1))]
  ));
}

function assignWeightedPillars(
  slots: readonly PendingSlot[],
  pillars: readonly GrowthPillar[],
): GrowthPlanSlot[] {
  const totalWeight = pillars.reduce((sum, pillar) => sum + pillar.weight, 0);
  const balances = pillars.map(() => 0);

  return slots.map((slot) => {
    let selectedIndex = 0;
    for (let index = 0; index < pillars.length; index += 1) {
      balances[index] += pillars[index].weight;
      if (balances[index] > balances[selectedIndex]) selectedIndex = index;
    }
    balances[selectedIndex] -= totalWeight;

    return { ...slot, pillarId: pillars[selectedIndex].id };
  });
}

export function buildGrowthPlanSlots(input: BuildGrowthPlanSlotsInput): GrowthPlanSlot[] {
  const { startTimestamp, weeks } = validatePeriod(input.periodStart, input.periodEnd);
  validateChannels(input);
  const pillars = positivePillars(input.pillars);
  const postingWindows = normalizePostingWindows(input.postingWindows);
  const formatter = createTimezoneFormatter(input.timezone);
  const slots: PendingSlot[] = [];

  for (let weekIndex = 0; weekIndex < weeks; weekIndex += 1) {
    const weekStart = startTimestamp + weekIndex * WEEK_MS;
    const weekKey = formatDateOnly(weekStart);

    for (const channel of GROWTH_CHANNELS) {
      const count = input.channels[channel] ? input.cadence[channel] : 0;
      for (const [slotIndex, window] of selectWindows(postingWindows, count).entries()) {
        const localDate = formatDateOnly(weekStart + (window.weekday - 1) * DAY_MS);
        slots.push({
          key: `${weekKey}:${channel}:${String(slotIndex + 1).padStart(2, "0")}`,
          channel,
          format: CHANNEL_FORMATS[channel],
          scheduledFor: localHourToUtc(localDate, window.hour, formatter),
        });
      }
    }
  }

  slots.sort((left, right) => (
    left.scheduledFor.localeCompare(right.scheduledFor)
    || left.channel.localeCompare(right.channel)
    || left.key.localeCompare(right.key)
  ));
  return assignWeightedPillars(slots, pillars);
}
