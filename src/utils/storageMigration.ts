const LEGACY_STORAGE_PREFIX = "gh-dash.";
const STORAGE_PREFIX = "gitdeck.";

/** Moves browser preferences and caches to the Gitdeck namespace without overwriting newer values. */
export function migrateLegacyStorage(storage?: Storage): void {
  try {
    const target = storage ?? window.localStorage;
    // Snapshot the keys because removing an entry changes Storage's indexes.
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index));
    for (const key of keys) {
      if (!key?.startsWith(LEGACY_STORAGE_PREFIX)) continue;
      const value = target.getItem(key);
      if (value === null) continue;
      const nextKey = STORAGE_PREFIX + key.slice(LEGACY_STORAGE_PREFIX.length);
      if (target.getItem(nextKey) === null) target.setItem(nextKey, value);
      // Remove the old key only after its value is safely stored or superseded.
      target.removeItem(key);
    }
  } catch {
    // Storage may be unavailable or full. Preserve unmigrated values and retry on the next load.
  }
}
