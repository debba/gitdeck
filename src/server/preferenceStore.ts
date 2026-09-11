import { get, getDatabase, run } from "./sqlite";

interface PreferenceRow {
  value: string;
}

function ensureSchema(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope, key)
    )
  `);
}

/**
 * Tiny JSON preference store. New features can persist any serialisable value
 * without adding another file or schema migration.
 */
export function setPreference<T>(scope: string, key: string, value: T): void {
  ensureSchema();
  run(
    `INSERT INTO preferences (scope, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [scope, key, JSON.stringify(value), new Date().toISOString()],
  );
}

export function getPreference<T>(scope: string, key: string, fallback: T): T {
  ensureSchema();
  const row = get<PreferenceRow>("SELECT value FROM preferences WHERE scope = ? AND key = ?", [scope, key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function deletePreference(scope: string, key: string): void {
  ensureSchema();
  run("DELETE FROM preferences WHERE scope = ? AND key = ?", [scope, key]);
}
