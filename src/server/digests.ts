import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DailyRepoDigest, GhIssue, GhRepo } from "../types/github";
import { buildDailyDigestEntries, buildDailyDigestRecord, buildPeriodDigestEntries, type DailyDigestRecord, type DigestPeriod } from "../utils/digests";
import { DATA_DIR, DIGESTS_PATH } from "./config";
import { sendJsonCacheable } from "./http";
import { fetchRepoSecuritySummary } from "./securityAlerts";
import { maybeGenerateOpenAIDigest } from "./openaiDigest";

const MAX_DIGEST_DAYS = 120;

let digestsCache: DailyDigestRecord[] | null = null;
let digestsLoadPromise: Promise<DailyDigestRecord[]> | null = null;

async function loadDigests(): Promise<DailyDigestRecord[]> {
  if (digestsCache) return digestsCache;
  if (digestsLoadPromise) return digestsLoadPromise;
  digestsLoadPromise = (async () => {
    try {
      const raw = await readFile(DIGESTS_PATH, "utf-8");
      digestsCache = JSON.parse(raw) as DailyDigestRecord[];
    } catch {
      digestsCache = [];
    }
    return digestsCache;
  })();
  return digestsLoadPromise;
}

async function saveDigests(): Promise<void> {
  if (!digestsCache) return;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DIGESTS_PATH, JSON.stringify(digestsCache));
}

export async function recordDailyDigest(repos: GhRepo[], issues: GhIssue[]): Promise<void> {
  const activeRepos = repos.filter((repo) => !repo.isArchived);
  const digests = await loadDigests();
  const securityEntries = await Promise.all(
    activeRepos.map(async (repo) => {
      try {
        const summary = await fetchRepoSecuritySummary(repo.nameWithOwner);
        return [repo.nameWithOwner, summary] as const;
      } catch {
        return [repo.nameWithOwner, { dependabotOpen: 0, codeScanningOpen: 0, totalOpen: 0, latestUpdatedAt: null, unavailable: true }] as const;
      }
    }),
  );
  const today = buildDailyDigestRecord(activeRepos, issues, Date.now(), new Map(securityEntries.map(([repo, summary]) => [repo, summary])));
  const existing = digests.find((entry) => entry.date === today.date);
  if (existing) {
    Object.assign(existing, today);
  } else {
    digests.push(today);
    digests.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (digests.length > MAX_DIGEST_DAYS) digests.splice(0, digests.length - MAX_DIGEST_DAYS);
  }
  await saveDigests();
}

function parsePeriod(value: string | null): DigestPeriod {
  if (value === "week" || value === "month") return value;
  return "day";
}

export async function handleDailyDigests(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const records = await loadDigests();
  const latest = records[records.length - 1];
  if (latest && !latest.ai) {
    try {
      latest.ai = await maybeGenerateOpenAIDigest(latest);
      await saveDigests();
    } catch {
      // AI enrichment is optional and should never break digest delivery.
    }
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const period = parsePeriod(url.searchParams.get("period"));
  const digests = buildPeriodDigestEntries(records, period);
  sendJsonCacheable(req, res, 200, {
    ok: true,
    period,
    generatedAt: digests[0]?.date ?? "",
    digests,
  });
}

export async function getLatestRepoDigest(repo: string): Promise<DailyRepoDigest | null> {
  const records = await loadDigests();
  const entries = buildDailyDigestEntries(records);
  const latest = entries[0];
  if (!latest) return null;
  const repoDigest = latest.repos.find((entry) => entry.repo === repo);
  if (!repoDigest) return null;
  if (!repoDigest.ai) {
    try {
      repoDigest.ai = await maybeGenerateOpenAIDigest(repoDigest);
    } catch {
      repoDigest.ai = null;
    }
  }
  return repoDigest;
}
