import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GhRepo, SnapshotEntry } from "../types/github";
import { DATA_DIR, SNAPSHOTS_PATH } from "./config";

const MAX_HISTORY_DAYS = 90;
const HISTORY_RESPONSE_DAYS = 30;

type SnapshotsFile = Record<string, SnapshotEntry[]>;

let snapshotsCache: SnapshotsFile | null = null;
let snapshotsLoadPromise: Promise<SnapshotsFile> | null = null;

async function loadSnapshots(): Promise<SnapshotsFile> {
  if (snapshotsCache) return snapshotsCache;
  if (snapshotsLoadPromise) return snapshotsLoadPromise;
  snapshotsLoadPromise = (async () => {
    try {
      const raw = await readFile(SNAPSHOTS_PATH, "utf-8");
      snapshotsCache = JSON.parse(raw) as SnapshotsFile;
    } catch {
      snapshotsCache = {};
    }
    return snapshotsCache;
  })();
  return snapshotsLoadPromise;
}

async function saveSnapshots(): Promise<void> {
  if (!snapshotsCache) return;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SNAPSHOTS_PATH, JSON.stringify(snapshotsCache));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function recordSnapshots(repos: GhRepo[]): Promise<void> {
  const snapshot = await loadSnapshots();
  const today = todayIso();
  let dirty = false;

  for (const repo of repos) {
    const key = repo.nameWithOwner;
    if (!snapshot[key]) snapshot[key] = [];
    const list = snapshot[key];
    const last = list[list.length - 1];
    if (last && last.date === today) {
      if (last.stars !== repo.stargazerCount || last.forks !== repo.forkCount) {
        last.stars = repo.stargazerCount;
        last.forks = repo.forkCount;
        dirty = true;
      }
    } else {
      list.push({ date: today, stars: repo.stargazerCount, forks: repo.forkCount });
      if (list.length > MAX_HISTORY_DAYS) list.splice(0, list.length - MAX_HISTORY_DAYS);
      dirty = true;
    }
  }

  if (dirty) await saveSnapshots();
}

export async function attachHistory(repos: GhRepo[]): Promise<void> {
  const snapshot = await loadSnapshots();
  for (const repo of repos) {
    const history = snapshot[repo.nameWithOwner];
    if (history?.length) repo.history = history.slice(-HISTORY_RESPONSE_DAYS);
  }
}
