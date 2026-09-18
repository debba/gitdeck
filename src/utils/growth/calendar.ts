import type { GrowthContentItem } from "../../types/growth";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface GrowthCalendarDay {
  date: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
}

export interface GrowthCalendarMonthGrid {
  selectedDate: string;
  monthStart: string;
  rangeStart: string;
  rangeEnd: string;
  days: GrowthCalendarDay[];
}

export interface GrowthCalendarWeekGrid {
  selectedDate: string;
  rangeStart: string;
  rangeEnd: string;
  days: GrowthCalendarDay[];
}

export const GROWTH_QUEUE_SECTIONS = [
  "needsDraft",
  "draft",
  "ready",
  "scheduled",
  "published",
] as const;
export type GrowthQueueSection = (typeof GROWTH_QUEUE_SECTIONS)[number];
export type GrowthQueueGroups = Record<GrowthQueueSection, GrowthContentItem[]>;

interface DateParts {
  year: number;
  month: number;
  day: number;
  timestamp: number;
}

function parseDateKey(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
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
  ) return null;
  return { year, month, day, timestamp: date.getTime() };
}

function formatDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function shiftCalendarDate(date: string, days: number): string {
  const parsed = parseDateKey(date);
  if (!parsed) throw new RangeError("date must be a valid YYYY-MM-DD calendar date");
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  return formatDateKey(parsed.timestamp + days * DAY_MS);
}

function createTimezoneFormatter(timezone: string, includeTime = false): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(includeTime ? {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      } : {}),
    });
  } catch {
    throw new RangeError("timezone must be a valid IANA timezone");
  }
}

function formatterParts(formatter: Intl.DateTimeFormat, instant: Date): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

function timezoneOffsetAt(formatter: Intl.DateTimeFormat, timestamp: number): number {
  const wholeSecond = Math.floor(timestamp / 1_000) * 1_000;
  const parts = formatterParts(formatter, new Date(wholeSecond));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - wholeSecond;
}

function localDateTimeToUtc(
  date: string,
  time: { hour: number; minute: number; second: number; millisecond: number },
  timezone: string,
): number {
  const parsed = parseDateKey(date);
  if (!parsed) throw new RangeError("date must be a valid YYYY-MM-DD calendar date");
  const formatter = createTimezoneFormatter(timezone, true);
  const localTimestamp = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    time.hour,
    time.minute,
    time.second,
    time.millisecond,
  );
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(timezoneOffsetAt(formatter, localTimestamp + hours * 60 * 60 * 1_000));
  }
  const exactCandidates = [...offsets]
    .map((offset) => localTimestamp - offset)
    .filter((candidate) => {
      const parts = formatterParts(formatter, new Date(candidate));
      return parts.year === parsed.year
        && parts.month === parsed.month
        && parts.day === parsed.day
        && parts.hour === time.hour
        && parts.minute === time.minute
        && parts.second === time.second;
    });
  if (exactCandidates.length > 0) return Math.max(...exactCandidates);

  // A local time inside a daylight-saving gap is normalized forward by the gap.
  const offsetBefore = timezoneOffsetAt(formatter, localTimestamp - DAY_MS);
  return localTimestamp - offsetBefore;
}

function localMidnightToUtc(date: string, timezone: string): number {
  const parsed = parseDateKey(date);
  if (!parsed) throw new RangeError("date must be a valid YYYY-MM-DD calendar date");
  const formatter = createTimezoneFormatter(timezone, true);
  const localTimestamp = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const firstCandidate = localTimestamp - timezoneOffsetAt(formatter, localTimestamp);
  return localTimestamp - timezoneOffsetAt(formatter, firstCandidate);
}

export function normalizeCalendarDate(value: string | null | undefined, fallback: string): string {
  if (value && parseDateKey(value)) return value;
  if (parseDateKey(fallback)) return fallback;
  throw new RangeError("fallback must be a valid YYYY-MM-DD calendar date");
}

export function calendarDateInTimezone(instant: string | Date, timezone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError("instant must be a valid date");
  const parts = formatterParts(createTimezoneFormatter(timezone), date);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function buildGrowthCalendarMonth(selectedDate: string): GrowthCalendarMonthGrid {
  const selected = parseDateKey(selectedDate);
  if (!selected) throw new RangeError("selectedDate must be a valid YYYY-MM-DD calendar date");
  const monthTimestamp = Date.UTC(selected.year, selected.month - 1, 1);
  const monthStart = formatDateKey(monthTimestamp);
  const mondayOffset = (new Date(monthTimestamp).getUTCDay() + 6) % 7;
  const rangeStart = formatDateKey(monthTimestamp - mondayOffset * DAY_MS);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = shiftCalendarDate(rangeStart, index);
    const parsed = parseDateKey(date)!;
    return {
      date,
      dayOfMonth: parsed.day,
      inCurrentMonth: parsed.month === selected.month && parsed.year === selected.year,
    };
  });

  return {
    selectedDate,
    monthStart,
    rangeStart,
    rangeEnd: days[days.length - 1].date,
    days,
  };
}

export function buildGrowthCalendarWeek(selectedDate: string): GrowthCalendarWeekGrid {
  const selected = parseDateKey(selectedDate);
  if (!selected) throw new RangeError("selectedDate must be a valid YYYY-MM-DD calendar date");
  const mondayOffset = (new Date(selected.timestamp).getUTCDay() + 6) % 7;
  const rangeStart = shiftCalendarDate(selectedDate, -mondayOffset);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftCalendarDate(rangeStart, index);
    return {
      date,
      dayOfMonth: parseDateKey(date)!.day,
      inCurrentMonth: true,
    };
  });
  return {
    selectedDate,
    rangeStart,
    rangeEnd: days[days.length - 1].date,
    days,
  };
}

export function shiftCalendarMonth(date: string, offset: number): string {
  const parsed = parseDateKey(date);
  if (!parsed) throw new RangeError("date must be a valid YYYY-MM-DD calendar date");
  if (!Number.isInteger(offset)) throw new RangeError("offset must be an integer");
  const targetMonth = new Date(0);
  targetMonth.setUTCHours(0, 0, 0, 0);
  targetMonth.setUTCFullYear(parsed.year, parsed.month - 1 + offset, 1);
  const lastDay = new Date(Date.UTC(
    targetMonth.getUTCFullYear(),
    targetMonth.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  targetMonth.setUTCDate(Math.min(parsed.day, lastDay));
  return formatDateKey(targetMonth.getTime());
}

export function shiftCalendarWeek(date: string, offset: number): string {
  if (!Number.isInteger(offset)) throw new RangeError("offset must be an integer");
  return shiftCalendarDate(date, offset * 7);
}

export function growthCalendarUtcRange(
  grid: Pick<GrowthCalendarMonthGrid | GrowthCalendarWeekGrid, "rangeStart" | "rangeEnd">,
  timezone: string,
): { scheduledFrom: string; scheduledTo: string } {
  const scheduledFrom = localMidnightToUtc(grid.rangeStart, timezone);
  const endExclusive = localMidnightToUtc(shiftCalendarDate(grid.rangeEnd, 1), timezone);
  return {
    scheduledFrom: new Date(scheduledFrom).toISOString(),
    scheduledTo: new Date(endExclusive - 1).toISOString(),
  };
}

export function rescheduleGrowthCalendarInstant(
  scheduledFor: string,
  targetDate: string,
  timezone: string,
): string {
  const instant = new Date(scheduledFor);
  if (Number.isNaN(instant.getTime())) throw new RangeError("scheduledFor must be a valid date");
  const localTime = formatterParts(createTimezoneFormatter(timezone, true), instant);
  return new Date(localDateTimeToUtc(targetDate, {
    hour: localTime.hour,
    minute: localTime.minute,
    second: localTime.second,
    millisecond: instant.getUTCMilliseconds(),
  }, timezone)).toISOString();
}

export function rescheduleGrowthCalendarItem(
  item: GrowthContentItem,
  targetDate: string,
  timezone: string,
): GrowthContentItem {
  if (!item.scheduledFor) throw new RangeError("item must have a scheduled date");
  return {
    ...item,
    scheduledFor: rescheduleGrowthCalendarInstant(item.scheduledFor, targetDate, timezone),
  };
}

export function groupGrowthQueueItems(
  items: readonly GrowthContentItem[],
  week: Pick<GrowthCalendarWeekGrid, "rangeStart" | "rangeEnd">,
  timezone: string,
): GrowthQueueGroups {
  const groups: GrowthQueueGroups = {
    needsDraft: [],
    draft: [],
    ready: [],
    scheduled: [],
    published: [],
  };
  for (const item of items) {
    if (!item.scheduledFor || item.status === "skipped") continue;
    let localDate: string;
    try {
      localDate = calendarDateInTimezone(item.scheduledFor, timezone);
    } catch {
      continue;
    }
    if (localDate < week.rangeStart || localDate > week.rangeEnd) continue;
    const section = item.status === "idea" ? "needsDraft" : item.status;
    groups[section].push(item);
  }
  for (const entries of Object.values(groups)) {
    entries.sort((left, right) => (
      left.scheduledFor!.localeCompare(right.scheduledFor!)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ));
  }
  return groups;
}

export function groupGrowthCalendarItems(
  items: readonly GrowthContentItem[],
  timezone: string,
): Map<string, GrowthContentItem[]> {
  const grouped = new Map<string, GrowthContentItem[]>();
  for (const item of items) {
    if (!item.scheduledFor || item.status === "skipped") continue;
    let date: string;
    try {
      date = calendarDateInTimezone(item.scheduledFor, timezone);
    } catch {
      continue;
    }
    grouped.set(date, [...(grouped.get(date) ?? []), item]);
  }
  for (const entries of grouped.values()) {
    entries.sort((left, right) => (
      left.scheduledFor!.localeCompare(right.scheduledFor!)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ));
  }
  return grouped;
}
