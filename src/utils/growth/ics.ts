import type { GrowthContentItem } from "../../types/growth";

const encoder = new TextEncoder();
const FIRST_LINE_LIMIT = 75;
const CONTINUATION_LINE_LIMIT = 74;

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldLine(line: string): string {
  const parts: string[] = [];
  let part = "";
  let partBytes = 0;
  let limit = FIRST_LINE_LIMIT;

  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength;
    if (part && partBytes + characterBytes > limit) {
      parts.push(part);
      part = "";
      partBytes = 0;
      limit = CONTINUATION_LINE_LIMIT;
    }
    part += character;
    partBytes += characterBytes;
  }
  parts.push(part);
  return parts.join("\r\n ");
}

function utcCalendarDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function eventLines(item: GrowthContentItem, scheduledFor: string): string[] {
  const dtstamp = utcCalendarDateTime(item.createdAt)
    ?? utcCalendarDateTime(item.updatedAt)
    ?? scheduledFor;
  const title = item.title.trim() || item.angle.trim() || "Scheduled content";
  const description = [
    `Repository: ${item.repository}`,
    `Channel: ${item.channel}`,
    `Pillar: ${item.pillar.trim() || "Unassigned"}`,
  ].join("\n");
  const url = httpUrl(item.publishedUrl)
    ?? item.sources.map((source) => httpUrl(source)).find((source): source is string => source !== null)
    ?? null;

  return [
    "BEGIN:VEVENT",
    `UID:${encodeURIComponent(item.id)}@growth.gitdeck`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${scheduledFor}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(url ? [`URL:${url}`] : []),
    "END:VEVENT",
  ];
}

export function buildGrowthCalendarIcs(items: readonly GrowthContentItem[]): string {
  const events = items
    .flatMap((item) => {
      if (item.status !== "scheduled") return [];
      const scheduledFor = utcCalendarDateTime(item.scheduledFor);
      return scheduledFor ? [{ item, scheduledFor }] : [];
    })
    .sort((left, right) => (
      left.scheduledFor.localeCompare(right.scheduledFor)
      || left.item.repository.localeCompare(right.item.repository)
      || left.item.id.localeCompare(right.item.id)
    ));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GitDeck//Growth Studio//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flatMap(({ item, scheduledFor }) => eventLines(item, scheduledFor)),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
