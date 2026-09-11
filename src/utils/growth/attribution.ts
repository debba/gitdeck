import type { SnapshotEntry } from "../../types/github";
import type {
  GrowthAttributionPendingReason,
  GrowthPerformanceMetrics,
  GrowthPerformanceWindow,
} from "../../types/growth";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DURATION_MS: Record<GrowthPerformanceWindow, number> = {
  "48h": 2 * DAY_MS,
  "7d": 7 * DAY_MS,
};

export interface GrowthAttributionSnapshotBoundaries {
  baseline: SnapshotEntry;
  target: SnapshotEntry;
}

export type GrowthSnapshotAttribution = {
  status: "pending";
  window: GrowthPerformanceWindow;
  dueAt: string | null;
  reason: GrowthAttributionPendingReason;
} | {
  status: "measured";
  window: GrowthPerformanceWindow;
  dueAt: string;
  baselineDate: string;
  targetDate: string;
  metrics: Pick<Required<GrowthPerformanceMetrics>, "starsDelta" | "forksDelta">;
};

function parsePublication(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function snapshotTimestamp(snapshot: SnapshotEntry): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)) return null;
  const timestamp = Date.parse(`${snapshot.date}T00:00:00.000Z`);
  if (
    Number.isNaN(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== snapshot.date
    || !Number.isFinite(snapshot.stars)
    || !Number.isFinite(snapshot.forks)
  ) return null;
  return timestamp;
}

export function getAttributionDeadline(
  publishedAt: string | null,
  window: GrowthPerformanceWindow,
): string | null {
  const publishedTimestamp = parsePublication(publishedAt);
  return publishedTimestamp === null
    ? null
    : new Date(publishedTimestamp + WINDOW_DURATION_MS[window]).toISOString();
}

/** Selects the bounded daily snapshots around publication and one due window. */
export function selectAttributionSnapshotBoundaries(
  publishedAt: string,
  dueAt: string,
  snapshots: readonly SnapshotEntry[],
  now: Date,
): GrowthAttributionSnapshotBoundaries | null {
  const publishedTimestamp = parsePublication(publishedAt);
  const dueTimestamp = Date.parse(dueAt);
  const nowTimestamp = now.getTime();
  if (
    publishedTimestamp === null
    || Number.isNaN(dueTimestamp)
    || Number.isNaN(nowTimestamp)
    || nowTimestamp < dueTimestamp
  ) return null;
  const publishedDay = Date.parse(`${new Date(publishedTimestamp).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const dueDay = Date.parse(`${new Date(dueTimestamp).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const nowDay = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

  const ordered = snapshots
    .flatMap((snapshot) => {
      const timestamp = snapshotTimestamp(snapshot);
      return timestamp === null || timestamp > nowDay ? [] : [{ snapshot, timestamp }];
    })
    .sort((left, right) => left.timestamp - right.timestamp);
  const baseline = [...ordered].reverse().find(({ timestamp }) => timestamp <= publishedDay);
  const target = ordered.find(({ timestamp }) => timestamp >= dueDay);
  if (
    !baseline
    || !target
    || publishedDay - baseline.timestamp > DAY_MS
    || target.timestamp - dueDay > DAY_MS
  ) return null;
  return {
    baseline: { ...baseline.snapshot },
    target: { ...target.snapshot },
  };
}

/** Calculates one signed snapshot attribution result without reading server state. */
export function calculateSnapshotAttribution(input: {
  publishedAt: string | null;
  window: GrowthPerformanceWindow;
  snapshots: readonly SnapshotEntry[];
  now: Date;
}): GrowthSnapshotAttribution {
  const dueAt = getAttributionDeadline(input.publishedAt, input.window);
  if (dueAt === null) {
    return { status: "pending", window: input.window, dueAt: null, reason: "missing-publication" };
  }
  const nowTimestamp = input.now.getTime();
  if (Number.isNaN(nowTimestamp)) throw new RangeError("invalid attribution time");
  if (nowTimestamp < Date.parse(dueAt)) {
    return { status: "pending", window: input.window, dueAt, reason: "not-due" };
  }
  const boundaries = selectAttributionSnapshotBoundaries(
    input.publishedAt!,
    dueAt,
    input.snapshots,
    input.now,
  );
  if (!boundaries) {
    return { status: "pending", window: input.window, dueAt, reason: "snapshot-unavailable" };
  }
  return {
    status: "measured",
    window: input.window,
    dueAt,
    baselineDate: boundaries.baseline.date,
    targetDate: boundaries.target.date,
    metrics: {
      starsDelta: boundaries.target.stars - boundaries.baseline.stars,
      forksDelta: boundaries.target.forks - boundaries.baseline.forks,
    },
  };
}
