import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { GhIssue, GhPullRequest, GhRepo, RepoCommit, SnapshotEntry } from "../../types/github";
import {
  GROWTH_ASSET_MIME_TYPES,
  MAX_GROWTH_ASSET_BYTES,
  type GrowthAssetMimeType,
  type GrowthMergedPullRequestSignal,
} from "../../types/growth";
import type { GoalContentSource, GoalMetric } from "../../types/goals";
import { calculateGoalProgress } from "../../utils/goals";
import { extractMediaUrls, extractWebPageSignal } from "../../utils/socialProposals";
import { getIssuesCached, getPullRequestsCached, getReposCached } from "../dashboardData";
import { getRepositoryContentSources, listGoals } from "../goalStore";
import { restApi } from "../githubClient";
import { getRepositorySnapshotHistory } from "../snapshots";

const README_EXCERPT_CHARS = 7000;

export interface GrowthReleaseSignal {
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
}

export interface GrowthReadmeSignal {
  excerpt: string;
  mediaUrls: string[];
}

export interface GrowthGoalSignal {
  id: string;
  metric: GoalMetric;
  current: number;
  target: number;
  deadline: string;
  createdAt: string;
  percentage: number;
  completed: boolean;
  overdue: boolean;
}

export interface GrowthRepositorySignals {
  generatedOn: string;
  repository: string;
  repositoryMetadata: GhRepo | null;
  openIssues: GhIssue[];
  openPullRequests: GhPullRequest[];
  mergedPullRequests: GrowthMergedPullRequestSignal[];
  releases: GrowthReleaseSignal[];
  readme: GrowthReadmeSignal | null;
  additionalSources: unknown[];
  recentCommits: RepoCommit[];
  starHistory: SnapshotEntry[];
  goals: GrowthGoalSignal[];
}

export async function fetchReleaseSignals(repository: string): Promise<GrowthReleaseSignal[]> {
  try {
    const result = await restApi<GrowthReleaseSignal[]>(`/repos/${repository}/releases?per_page=3`);
    return result.ok && Array.isArray(result.data) ? result.data.slice(0, 3) : [];
  } catch {
    return [];
  }
}

export async function fetchReadmeSignal(repository: string): Promise<GrowthReadmeSignal | null> {
  try {
    const result = await restApi<{ content?: string; encoding?: string; download_url?: string | null }>(`/repos/${repository}/readme`);
    if (!result.ok || !result.data?.content) return null;
    const text = result.data.encoding === "base64"
      ? Buffer.from(result.data.content, "base64").toString("utf-8")
      : result.data.content;
    return {
      excerpt: text.replace(/\r/g, "").trim().slice(0, README_EXCERPT_CHARS),
      mediaUrls: extractMediaUrls(text, result.data.download_url),
    };
  } catch {
    return null;
  }
}

function isPrivateIpv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6Words(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  const [leftValue, rightValue = ""] = address.split("::");
  const left = leftValue ? leftValue.split(":") : [];
  const right = rightValue ? rightValue.split(":") : [];
  const missing = 8 - left.length - right.length;
  const parts = address.includes("::") ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (parts.length !== 8) return null;
  return parts.map((part) => Number.parseInt(part || "0", 16));
}

function isPrivateAddress(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const dottedMapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedMapped) return isPrivateIpv4(dottedMapped);
  const words = ipv6Words(address);
  if (!words) return true;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
    ? `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
    : null;
  if (mapped) return isPrivateIpv4(mapped);
  return words.every((word) => word === 0)
    || words.slice(0, 7).every((word) => word === 0) && words[7] === 1
    || (words[0] & 0xfe00) === 0xfc00
    || (words[0] & 0xffc0) === 0xfe80
    || (words[0] & 0xff00) === 0xff00
    || words[0] === 0x2001 && words[1] === 0x0db8;
}

async function assertPublicWebsite(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsupported source URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("private source URL");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("private source URL");
}

export class PublicMediaTooLargeError extends Error {
  constructor() {
    super("asset exceeds the 25 MiB limit");
    this.name = "PublicMediaTooLargeError";
  }
}

export class UnsupportedPublicMediaTypeError extends Error {
  constructor() {
    super("unsupported asset content type");
    this.name = "UnsupportedPublicMediaTypeError";
  }
}

export interface PublicMediaFile {
  body: Buffer;
  contentType: GrowthAssetMimeType;
  length: number;
  finalUrl: string;
}

/** Reads allowlisted public media while validating DNS, redirects, type, and the byte limit. */
export async function readPublicMedia(value: string, maxBytes = MAX_GROWTH_ASSET_BYTES): Promise<PublicMediaFile> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_GROWTH_ASSET_BYTES) {
    throw new Error("invalid media byte limit");
  }
  let url = new URL(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicWebsite(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: GROWTH_ASSET_MIME_TYPES.join(","), "User-Agent": "GitDeck/1.0 media-reader" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("too many media redirects");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`media returned ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!GROWTH_ASSET_MIME_TYPES.includes(contentType as GrowthAssetMimeType)) {
      throw new UnsupportedPublicMediaTypeError();
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
      throw new PublicMediaTooLargeError();
    }
    if (!response.body) throw new Error("media body unavailable");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      length += chunk.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new PublicMediaTooLargeError();
      }
      chunks.push(Buffer.from(chunk));
    }
    if (length === 0) throw new Error("media body unavailable");
    return {
      body: Buffer.concat(chunks, length),
      contentType: contentType as GrowthAssetMimeType,
      length,
      finalUrl: url.toString(),
    };
  }
  throw new Error("media unavailable");
}

async function readBoundedText(response: Response, maxBytes = 600_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchWebsiteSignal(value: string): Promise<unknown> {
  try {
    let url = new URL(value);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await assertPublicWebsite(url);
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(7_000),
        headers: { Accept: "text/html,text/plain,image/*,video/*", "User-Agent": "GitDeck/1.0 source-reader" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new Error("too many source redirects");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`source returned ${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.startsWith("image/") || contentType.startsWith("video/")) {
        return { type: "website", url: value, title: null, excerpt: null, mediaUrls: [url.toString()] };
      }
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("unsupported source content");
      const page = extractWebPageSignal(await readBoundedText(response), url.toString());
      return { type: "website", url: value, title: page.title, excerpt: page.excerpt, mediaUrls: page.mediaUrls };
    }
  } catch (error) {
    return { type: "website", url: value, error: (error as Error).message };
  }
  return { type: "website", url: value, error: "source unavailable" };
}

export async function fetchAdditionalSourceSignals(sources: GoalContentSource[]): Promise<unknown[]> {
  return Promise.all(sources.map(async (source) => {
    if (source.type === "website") return fetchWebsiteSignal(source.value);
    const [readme, releases] = await Promise.all([
      fetchReadmeSignal(source.value),
      fetchReleaseSignals(source.value),
    ]);
    return {
      type: source.type,
      repository: source.value,
      readmeExcerpt: readme?.excerpt ?? null,
      mediaUrls: readme?.mediaUrls ?? [],
      releases: releases.map((release) => ({
        name: release.name || release.tag_name || null,
        url: release.html_url ?? null,
        publishedAt: release.published_at ?? null,
        notesExcerpt: release.body?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      })),
    };
  }));
}

async function fetchRecentCommits(repository: string): Promise<RepoCommit[]> {
  try {
    const result = await restApi<RepoCommit[]>(`/repos/${repository}/commits?per_page=20`);
    return result.ok && Array.isArray(result.data) ? result.data.slice(0, 20) : [];
  } catch {
    return [];
  }
}

interface PullRequestRestValue {
  number?: unknown;
  title?: unknown;
  html_url?: unknown;
  merged_at?: unknown;
  additions?: unknown;
  deletions?: unknown;
  changed_files?: unknown;
}

function mergedPullRequestFromRest(value: PullRequestRestValue): GrowthMergedPullRequestSignal | null {
  if (
    !Number.isSafeInteger(value.number)
    || (value.number as number) <= 0
    || typeof value.title !== "string"
    || !value.title.trim()
    || typeof value.html_url !== "string"
    || !value.html_url.trim()
    || typeof value.merged_at !== "string"
    || !value.merged_at.trim()
    || !Number.isSafeInteger(value.additions)
    || (value.additions as number) < 0
    || !Number.isSafeInteger(value.deletions)
    || (value.deletions as number) < 0
    || !Number.isSafeInteger(value.changed_files)
    || (value.changed_files as number) < 0
  ) return null;
  return {
    number: value.number as number,
    title: value.title.trim(),
    url: value.html_url.trim(),
    mergedAt: value.merged_at,
    additions: value.additions as number,
    deletions: value.deletions as number,
    changedFiles: value.changed_files as number,
  };
}

/** Fetches bounded merged pull-request details needed by deterministic opportunity rules. */
export async function fetchRecentlyMergedPullRequests(repository: string): Promise<GrowthMergedPullRequestSignal[]> {
  try {
    const result = await restApi<PullRequestRestValue[]>(
      `/repos/${repository}/pulls?state=closed&sort=updated&direction=desc&per_page=20`,
    );
    if (!result.ok || !Array.isArray(result.data)) return [];
    const merged = result.data
      .filter((pullRequest) => typeof pullRequest?.merged_at === "string" && Number.isSafeInteger(pullRequest.number))
      .slice(0, 20);
    const details = await Promise.all(merged.map(async (pullRequest) => {
      try {
        const detail = await restApi<PullRequestRestValue>(`/repos/${repository}/pulls/${pullRequest.number}`);
        return detail.ok && detail.data ? mergedPullRequestFromRest(detail.data) : null;
      } catch {
        return null;
      }
    }));
    return details.filter((pullRequest): pullRequest is GrowthMergedPullRequestSignal => pullRequest !== null);
  } catch {
    return [];
  }
}

/** Collects the account-scoped repository evidence shared by Growth Studio AI consumers. */
export async function collectRepositorySignals(
  accountId: string,
  repository: string,
  sources = getRepositoryContentSources(accountId, repository),
): Promise<GrowthRepositorySignals> {
  const repositoryGoals = listGoals(accountId).filter((goal) => goal.repository === repository);
  const [
    issuesResult,
    prsResult,
    reposResult,
    releases,
    readme,
    additionalSources,
    recentCommits,
    starHistory,
    mergedPullRequests,
  ] = await Promise.all([
    getIssuesCached(false),
    getPullRequestsCached(false),
    getReposCached(false),
    fetchReleaseSignals(repository),
    fetchReadmeSignal(repository),
    fetchAdditionalSourceSignals(sources),
    fetchRecentCommits(repository),
    getRepositorySnapshotHistory(repository),
    fetchRecentlyMergedPullRequests(repository),
  ]);
  const openIssues = issuesResult.ok
    ? issuesResult.issues.filter((item) => item.repository.nameWithOwner === repository)
    : [];
  const openPullRequests = prsResult.ok
    ? prsResult.pullRequests.filter((item) => item.repository.nameWithOwner === repository)
    : [];
  const repositoryMetadata = reposResult.ok
    ? reposResult.repos.find((item) => item.nameWithOwner === repository) ?? null
    : null;
  const goals = repositoryGoals.map((goal) => {
    const progress = calculateGoalProgress(goal);
    return {
      id: goal.id,
      metric: goal.metric,
      current: goal.currentValue,
      target: goal.targetValue,
      deadline: goal.deadline,
      createdAt: goal.createdAt,
      percentage: progress.percentage,
      completed: progress.completed,
      overdue: progress.overdue,
    };
  });

  return {
    generatedOn: new Date().toISOString().slice(0, 10),
    repository,
    repositoryMetadata,
    openIssues,
    openPullRequests,
    mergedPullRequests,
    releases,
    readme,
    additionalSources,
    recentCommits,
    starHistory,
    goals,
  };
}
