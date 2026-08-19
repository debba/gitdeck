const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const etagStore = new Map<string, string>();

export type SwrSource = "cache" | "inflight" | "network";

export interface SwrResult<T> {
  cached: T | null;
  fresh: boolean;
  source: SwrSource;
  promise: Promise<T>;
}

export interface SwrOptions {
  ttlMs?: number;
  fresh?: boolean;
  signal?: AbortSignal;
}

export function peek<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  return entry ? entry.value : null;
}

export function isFresh(key: string): boolean {
  const entry = store.get(key);
  return Boolean(entry && entry.expiresAt > Date.now());
}

export function set<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidate(key?: string): void {
  if (key === undefined) {
    store.clear();
    etagStore.clear();
    return;
  }
  store.delete(key);
  etagStore.delete(key);
}

export function getEtag(key: string): string | undefined {
  return etagStore.get(key);
}

export function setEtag(key: string, etag: string): void {
  etagStore.set(key, etag);
}

export function swr<T>(
  key: string,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  options: SwrOptions = {},
): SwrResult<T> {
  const { ttlMs = DEFAULT_TTL_MS, fresh = false, signal } = options;
  const cached = peek<T>(key);

  if (!fresh && cached !== null && isFresh(key)) {
    return { cached, fresh: true, source: "cache", promise: Promise.resolve(cached) };
  }

  if (!fresh) {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return { cached, fresh: false, source: "inflight", promise: existing };
  }

  const promise = runFetch();
  if (!fresh) inflight.set(key, promise);
  return { cached, fresh: false, source: "network", promise };

  async function runFetch(): Promise<T> {
    try {
      const value = await fetcher(signal);
      if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      set(key, value, ttlMs);
      return value;
    } finally {
      if (inflight.get(key) === promise) inflight.delete(key);
    }
  }
}
