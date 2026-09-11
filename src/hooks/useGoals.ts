import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGoals } from "../api/github";
import type { RepositoryGoal } from "../types/goals";

interface UseGoalsOptions {
  accountId: string | null;
  enabled: boolean;
  /** Omit the repository to load goals across the active account. */
  repository?: string;
}

export interface GoalsState {
  goals: RepositoryGoal[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

/** Loads repository-scoped or account-wide goals and cancels stale requests. */
export function useGoals({ accountId, enabled, repository }: UseGoalsOptions): GoalsState {
  const shouldLoad = enabled && repository !== "";
  const [goals, setGoals] = useState<RepositoryGoal[]>([]);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const requestKey = JSON.stringify([accountId, repository ?? "*"]);

  const refresh = useCallback(async () => {
    if (!shouldLoad) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const result = await fetchGoals(controller.signal);
      if (!controller.signal.aborted && requestRef.current === controller) {
        setGoals(repository === undefined
          ? result.goals
          : result.goals.filter((goal) => goal.repository === repository));
      }
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError" && requestRef.current === controller) {
        setError((cause as Error).message);
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoadedKey(requestKey);
        setLoading(false);
      }
    }
  }, [repository, requestKey, shouldLoad]);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setGoals([]);
    setError("");
    if (!shouldLoad) {
      setLoading(false);
      return;
    }

    void refresh();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [refresh, shouldLoad]);

  return {
    goals,
    loading: loading || Boolean(shouldLoad && loadedKey !== requestKey),
    error,
    refresh,
  };
}
