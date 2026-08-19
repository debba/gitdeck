import { describe, expect, it } from "vitest";
import { formatBytes, formatExactNumber, formatNumber, formatReadableDate, formatRelativeTime } from "../../src/utils/format";

describe("format utilities", () => {
  it("formats relative time using the provided clock", () => {
    const now = new Date("2026-04-22T12:00:00.000Z").getTime();

    expect(formatRelativeTime("2026-04-22T11:59:45.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-04-22T11:45:00.000Z", now)).toBe("15m ago");
    expect(formatRelativeTime("2026-04-22T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-04-12T12:00:00.000Z", now)).toBe("10d ago");
  });

  it("formats relative time in Italian", () => {
    const now = new Date("2026-04-22T12:00:00.000Z").getTime();

    expect(formatRelativeTime("2026-04-22T11:59:45.000Z", now, "it")).toBe("ora");
    expect(formatRelativeTime("2026-04-22T11:45:00.000Z", now, "it")).toBe("15 min fa");
    expect(formatRelativeTime("2026-04-22T09:00:00.000Z", now, "it")).toBe("3 h fa");
    expect(formatRelativeTime("2026-04-12T12:00:00.000Z", now, "it")).toBe("10 g fa");
  });

  it("formats relative time in additional supported languages", () => {
    const now = new Date("2026-04-22T12:00:00.000Z").getTime();

    expect(formatRelativeTime("2026-04-22T11:45:00.000Z", now, "fr")).toBe("il y a 15 min");
    expect(formatRelativeTime("2026-04-22T09:00:00.000Z", now, "es")).toBe("hace 3 h");
    expect(formatRelativeTime("2026-04-12T12:00:00.000Z", now, "de")).toBe("vor 10 T");
    expect(formatRelativeTime("2026-04-12T12:00:00.000Z", now, "zh")).toBe("10 天前");
  });

  it("formats compact numbers", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1_200)).toBe("1.2k");
    expect(formatNumber(2_000_000)).toBe("2M");
  });

  it("formats exact numbers", () => {
    expect(formatExactNumber(1_329)).toBe("1,329");
    expect(formatExactNumber(2_000_000)).toBe("2,000,000");
  });

  it("formats date-only values without timezone shifts", () => {
    expect(formatReadableDate("2026-08-19")).toBe("Aug 19, 2026");
    expect(formatReadableDate("not-a-date")).toBe("not-a-date");
  });

  it("formats byte values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});
