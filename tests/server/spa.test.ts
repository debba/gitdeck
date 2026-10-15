import { describe, expect, it } from "vitest";
import { isAppRoute } from "../../src/server/spa";

describe("SPA routes", () => {
  it.each([
    ["/growth", true],
    ["/growth/r/owner/repo/calendar", true],
    ["/growth/calendar.ics", false],
    ["/assets/application.js", false],
    ["/growth-old", false],
  ])("classifies %s as an app route: %s", (pathname, expected) => {
    expect(isAppRoute(pathname)).toBe(expected);
  });
});
