import { randomUUID } from "node:crypto";
import type { GoalContentSource, GoalMetric, GoalProposal, GoalSuggestion, RepositoryGoal } from "../types/goals";
import { all, get, getDatabase, run } from "./sqlite";

interface GoalRow {
  id: string;
  account_id: string;
  repository: string;
  metric: GoalMetric;
  target_value: number;
  current_value: number;
  deadline: string;
  created_at: string;
  updated_at: string;
  suggestions: string;
  suggestions_generated_at: string | null;
}

function ensureSchema(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS repository_goals (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      metric TEXT NOT NULL,
      target_value INTEGER NOT NULL CHECK(target_value > 0),
      current_value INTEGER NOT NULL DEFAULT 0 CHECK(current_value >= 0),
      deadline TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      suggestions TEXT NOT NULL DEFAULT '[]',
      suggestions_generated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS repository_goals_account_deadline
      ON repository_goals(account_id, deadline);
    CREATE TABLE IF NOT EXISTS repository_content_sources (
      account_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, repository)
    );
  `);
}

function fromRow(row: GoalRow): Omit<RepositoryGoal, "aiEnabled"> {
  let suggestions: GoalSuggestion[] = [];
  try { suggestions = JSON.parse(row.suggestions) as GoalSuggestion[]; } catch { /* ignore invalid legacy data */ }
  return {
    id: row.id,
    accountId: row.account_id,
    repository: row.repository,
    metric: row.metric,
    targetValue: row.target_value,
    currentValue: row.current_value,
    deadline: row.deadline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suggestions,
    suggestionsGeneratedAt: row.suggestions_generated_at,
  };
}

export function listGoals(accountId: string): Array<Omit<RepositoryGoal, "aiEnabled">> {
  ensureSchema();
  return all<GoalRow>("SELECT * FROM repository_goals WHERE account_id = ? ORDER BY deadline, created_at", [accountId]).map(fromRow);
}

export function findGoal(accountId: string, id: string): Omit<RepositoryGoal, "aiEnabled"> | null {
  ensureSchema();
  const row = get<GoalRow>("SELECT * FROM repository_goals WHERE account_id = ? AND id = ?", [accountId, id]);
  return row ? fromRow(row) : null;
}

export function createGoal(input: {
  accountId: string;
  repository: string;
  metric: GoalMetric;
  targetValue: number;
  currentValue?: number;
  deadline: string;
}): Omit<RepositoryGoal, "aiEnabled"> {
  ensureSchema();
  const id = randomUUID();
  const now = new Date().toISOString();
  run(
    `INSERT INTO repository_goals
      (id, account_id, repository, metric, target_value, current_value, deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.accountId, input.repository, input.metric, input.targetValue, input.currentValue ?? 0, input.deadline, now, now],
  );
  return findGoal(input.accountId, id)!;
}

export function updateGoalCurrentValue(accountId: string, id: string, currentValue: number): void {
  ensureSchema();
  run("UPDATE repository_goals SET current_value = ?, updated_at = ? WHERE account_id = ? AND id = ?", [currentValue, new Date().toISOString(), accountId, id]);
}

/** Returns the shared source library used by every goal and post for a repository. */
export function getRepositoryContentSources(accountId: string, repository: string): GoalContentSource[] {
  ensureSchema();
  const row = get<{ sources: string }>(
    "SELECT sources FROM repository_content_sources WHERE account_id = ? AND repository = ?",
    [accountId, repository],
  );
  if (!row) return [];
  try {
    const sources = JSON.parse(row.sources) as unknown;
    return Array.isArray(sources) ? sources as GoalContentSource[] : [];
  } catch {
    return [];
  }
}

/** Replaces a repository's fixed source library. Inputs are normalized by the route. */
export function saveRepositoryContentSources(accountId: string, repository: string, sources: GoalContentSource[]): void {
  ensureSchema();
  run(
    `INSERT INTO repository_content_sources (account_id, repository, sources, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, repository) DO UPDATE SET sources = excluded.sources, updated_at = excluded.updated_at`,
    [accountId, repository, JSON.stringify(sources), new Date().toISOString()],
  );
}

export function saveGoalSuggestions(accountId: string, id: string, suggestions: GoalSuggestion[]): void {
  ensureSchema();
  const now = new Date().toISOString();
  run("UPDATE repository_goals SET suggestions = ?, suggestions_generated_at = ?, updated_at = ? WHERE account_id = ? AND id = ?", [JSON.stringify(suggestions), now, now, accountId, id]);
}

/** Attaches generated proposals to one suggestion; other suggestions are left untouched. */
export function saveGoalProposals(accountId: string, id: string, index: number, proposals: GoalProposal[], proposalsVersion: number): GoalSuggestion | null {
  const goal = findGoal(accountId, id);
  const suggestion = goal?.suggestions[index];
  if (!goal || !suggestion) return null;
  const now = new Date().toISOString();
  const updated: GoalSuggestion = { ...suggestion, proposals, proposalsGeneratedAt: now, proposalsVersion };
  const suggestions = goal.suggestions.map((entry, position) => (position === index ? updated : entry));
  run("UPDATE repository_goals SET suggestions = ?, updated_at = ? WHERE account_id = ? AND id = ?", [JSON.stringify(suggestions), now, accountId, id]);
  return updated;
}

export function deleteGoal(accountId: string, id: string): boolean {
  ensureSchema();
  return run("DELETE FROM repository_goals WHERE account_id = ? AND id = ?", [accountId, id]).changes > 0;
}
