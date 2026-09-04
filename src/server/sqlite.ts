import Database, { type Database as DatabaseType, type RunResult } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DATA_DIR } from "./config";

let database: DatabaseType | null = null;

/** Shared SQLite helper for small, server-side persisted features. */
export function getDatabase(path = `${DATA_DIR}/gitdeck.sqlite`): DatabaseType {
  if (database) return database;
  mkdirSync(dirname(path), { recursive: true });
  database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return database;
}

export function execute(sql: string): void {
  getDatabase().exec(sql);
}

export function run(sql: string, params: unknown[] = []): RunResult {
  return getDatabase().prepare(sql).run(...params);
}

export function get<T>(sql: string, params: unknown[] = []): T | undefined {
  return getDatabase().prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, params: unknown[] = []): T[] {
  return getDatabase().prepare(sql).all(...params) as T[];
}

/** Primarily useful for tests that need an isolated database. */
export function closeDatabase(): void {
  database?.close();
  database = null;
}
