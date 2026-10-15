import { describe, expect, it } from "vitest";
import type { SnapshotEntry } from "../../../src/types/github";
import {
  calculateSnapshotAttribution,
  getAttributionDeadline,
  selectAttributionSnapshotBoundaries,
} from "../../../src/utils/growth/attribution";

const SNAPSHOTS: SnapshotEntry[] = [
  { date: "2026-09-01", stars: 100, forks: 20 },
  { date: "2026-09-03", stars: 108, forks: 24 },
  { date: "2026-09-08", stars: 104, forks: 19 },
];

describe("Growth snapshot attribution", () => {
  it("selects exact UTC-day boundaries and calculates signed 48-hour deltas", () => {
    const result = calculateSnapshotAttribution({
      publishedAt: "2026-09-01T00:00:00.000Z",
      window: "48h",
      snapshots: SNAPSHOTS,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });

    expect(result).toEqual({
      status: "measured",
      window: "48h",
      dueAt: "2026-09-03T00:00:00.000Z",
      baselineDate: "2026-09-01",
      targetDate: "2026-09-03",
      metrics: { starsDelta: 8, forksDelta: 4 },
    });
  });

  it("accepts snapshot jitter within one day and preserves negative deltas", () => {
    const result = calculateSnapshotAttribution({
      publishedAt: "2026-09-01T03:00:00.000Z",
      window: "7d",
      snapshots: [
        ...SNAPSHOTS.filter(({ date }) => date !== "2026-09-08"),
        { date: "2026-09-09", stars: 97, forks: 18 },
      ],
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "measured",
      dueAt: "2026-09-08T03:00:00.000Z",
      baselineDate: "2026-09-01",
      targetDate: "2026-09-09",
      metrics: { starsDelta: -3, forksDelta: -2 },
    });
  });

  it("uses UTC calendar dates for snapshots whose source records have no time", () => {
    const result = calculateSnapshotAttribution({
      publishedAt: "2026-09-01T20:00:00-04:00",
      window: "48h",
      snapshots: [
        { date: "2026-09-02", stars: 5, forks: 1 },
        { date: "2026-09-04", stars: 7, forks: 2 },
      ],
      now: new Date("2026-09-04T01:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "measured",
      baselineDate: "2026-09-02",
      targetDate: "2026-09-04",
      metrics: { starsDelta: 2, forksDelta: 1 },
    });
  });

  it("uses the nearest baseline and first target regardless of input order", () => {
    const boundaries = selectAttributionSnapshotBoundaries(
      "2026-09-02T10:00:00.000Z",
      "2026-09-04T10:00:00.000Z",
      [
        { date: "2026-09-06", stars: 9, forks: 9 },
        { date: "2026-09-05", stars: 8, forks: 8 },
        { date: "2026-09-02", stars: 5, forks: 5 },
        { date: "2026-09-01", stars: 1, forks: 1 },
      ],
      new Date("2026-09-06T00:00:00.000Z"),
    );

    expect(boundaries).toEqual({
      baseline: { date: "2026-09-02", stars: 5, forks: 5 },
      target: { date: "2026-09-05", stars: 8, forks: 8 },
    });
  });

  it("reports missing publication and not-yet-due windows as pending", () => {
    expect(calculateSnapshotAttribution({
      publishedAt: null,
      window: "48h",
      snapshots: SNAPSHOTS,
      now: new Date("2026-09-10T00:00:00.000Z"),
    })).toEqual({ status: "pending", window: "48h", dueAt: null, reason: "missing-publication" });

    expect(calculateSnapshotAttribution({
      publishedAt: "2026-09-01T12:00:00.000Z",
      window: "7d",
      snapshots: SNAPSHOTS,
      now: new Date("2026-09-08T11:59:59.999Z"),
    })).toEqual({
      status: "pending",
      window: "7d",
      dueAt: "2026-09-08T12:00:00.000Z",
      reason: "not-due",
    });
  });

  it("keeps due windows pending when either boundary is missing or stale", () => {
    const cases: SnapshotEntry[][] = [
      [{ date: "2026-09-03", stars: 10, forks: 2 }],
      [
        { date: "2026-08-30", stars: 5, forks: 1 },
        { date: "2026-09-03", stars: 10, forks: 2 },
      ],
      [{ date: "2026-09-01", stars: 5, forks: 1 }],
      [
        { date: "2026-09-01", stars: 5, forks: 1 },
        { date: "2026-09-05", stars: 10, forks: 2 },
      ],
    ];

    for (const snapshots of cases) {
      expect(calculateSnapshotAttribution({
        publishedAt: "2026-09-01T00:00:00.000Z",
        window: "48h",
        snapshots,
        now: new Date("2026-09-05T00:00:00.000Z"),
      })).toMatchObject({ status: "pending", reason: "snapshot-unavailable" });
    }
  });

  it("does not use a target snapshot dated after the injected current time", () => {
    expect(calculateSnapshotAttribution({
      publishedAt: "2026-09-01T12:00:00.000Z",
      window: "48h",
      snapshots: [
        { date: "2026-09-01", stars: 5, forks: 1 },
        { date: "2026-09-04", stars: 10, forks: 2 },
      ],
      now: new Date("2026-09-03T12:00:00.000Z"),
    })).toMatchObject({ status: "pending", reason: "snapshot-unavailable" });
  });

  it("calculates UTC deadlines from offset publication timestamps", () => {
    expect(getAttributionDeadline("2026-09-01T12:00:00+02:00", "48h"))
      .toBe("2026-09-03T10:00:00.000Z");
    expect(getAttributionDeadline("invalid", "7d")).toBeNull();
  });
});
