import { describe, expect, it } from "vitest";
import type { GrowthContentItem } from "../../../src/types/growth";
import { buildGrowthCalendarIcs } from "../../../src/utils/growth/ics";

function contentItem(overrides: Partial<GrowthContentItem> = {}): GrowthContentItem {
  return {
    id: "content-1",
    accountId: "private-account",
    repository: "acme/rocket",
    planId: null,
    interventionId: null,
    goalIds: [],
    channel: "x",
    format: "x-thread",
    pillar: "product",
    angle: "Release angle",
    title: "Rocket release",
    summary: "",
    body: "",
    threadPosts: [],
    media: [{ kind: "image", url: "https://example.com/image.png", alt: "Release" }],
    sources: ["https://example.com/releases/1"],
    status: "scheduled",
    scheduledFor: "2026-10-14T10:30:45.123+02:00",
    publishedAt: null,
    publishedUrl: null,
    generatedAt: null,
    generationVersion: 1,
    evergreen: 0,
    createdAt: "2026-09-04T08:00:00.000Z",
    updatedAt: "2026-09-04T09:00:00.000Z",
    ...overrides,
  };
}

function unfold(value: string): string {
  return value.replace(/\r\n /g, "");
}

describe("buildGrowthCalendarIcs", () => {
  it("builds stable UTC events, escapes text, and omits private account identifiers", () => {
    const ics = buildGrowthCalendarIcs([contentItem({
      title: "Launch, learn; repeat\\today\nNext",
      pillar: "product, news",
      publishedUrl: "https://social.example/posts/1",
    })]);
    const unfolded = unfold(ics);

    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(unfolded).toContain("UID:content-1@growth.gitdeck\r\n");
    expect(unfolded).toContain("DTSTAMP:20260904T080000Z\r\n");
    expect(unfolded).toContain("DTSTART:20261014T083045Z\r\n");
    expect(unfolded).toContain("SUMMARY:Launch\\, learn\\; repeat\\\\today\\nNext\r\n");
    expect(unfolded).toContain("DESCRIPTION:Repository: acme/rocket\\nChannel: x\\nPillar: product\\, news\r\n");
    expect(unfolded).toContain("URL:https://social.example/posts/1\r\n");
    expect(unfolded).not.toContain("private-account");
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("exports only scheduled items with valid dates in chronological order", () => {
    const ics = unfold(buildGrowthCalendarIcs([
      contentItem({ id: "later", title: "Later", scheduledFor: "2026-10-15T08:00:00.000Z" }),
      contentItem({ id: "draft", title: "Draft", status: "draft" }),
      contentItem({ id: "invalid", title: "Invalid", scheduledFor: "not-a-date" }),
      contentItem({ id: "first", title: "First", scheduledFor: "2026-10-14T08:00:00.000Z", publishedUrl: null }),
    ]));

    expect(ics).toContain("URL:https://example.com/releases/1\r\n");
    expect(ics).not.toContain("SUMMARY:Draft");
    expect(ics).not.toContain("SUMMARY:Invalid");
    expect(ics.indexOf("SUMMARY:First")).toBeLessThan(ics.indexOf("SUMMARY:Later"));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("folds every physical line to 75 UTF-8 octets without splitting characters", () => {
    const title = `Release ${"🚀caffè,".repeat(20)}`;
    const ics = buildGrowthCalendarIcs([contentItem({ title })]);
    const physicalLines = ics.split("\r\n").filter(Boolean);

    expect(physicalLines.every((line) => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
    expect(ics).not.toContain("�");
    expect(unfold(ics)).toContain(`SUMMARY:${title.replaceAll(",", "\\,")}\r\n`);
    expect(physicalLines.some((line) => line.startsWith(" "))).toBe(true);
  });
});
