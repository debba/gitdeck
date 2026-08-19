export interface ProviderOperationMetric {
  operation: string;
  calls: number;
  failures: number;
  totalDurationMs: number;
  averageDurationMs: number;
  lastDurationMs: number;
  lastCalledAt: string;
}

interface MutableMetric {
  calls: number;
  failures: number;
  totalDurationMs: number;
  lastDurationMs: number;
  lastCalledAt: string;
}

const startedAt = new Date().toISOString();
const operations = new Map<string, MutableMetric>();

export async function measureProviderCall<T>(operation: string, call: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let failed = false;
  try {
    return await call();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const duration = Math.round((performance.now() - started) * 10) / 10;
    const metric = operations.get(operation) ?? {
      calls: 0,
      failures: 0,
      totalDurationMs: 0,
      lastDurationMs: 0,
      lastCalledAt: "",
    };
    metric.calls += 1;
    metric.failures += failed ? 1 : 0;
    metric.totalDurationMs = Math.round((metric.totalDurationMs + duration) * 10) / 10;
    metric.lastDurationMs = duration;
    metric.lastCalledAt = new Date().toISOString();
    operations.set(operation, metric);
    if (process.env.GITDECK_DIAGNOSTICS === "1") {
      console.info(`[gitdeck:provider] ${operation} ${duration}ms ${failed ? "failed" : "ok"}`);
    }
  }
}

export function getProviderMetrics(): { ok: true; startedAt: string; operations: ProviderOperationMetric[] } {
  return {
    ok: true,
    startedAt,
    operations: [...operations.entries()].map(([operation, metric]) => ({
      operation,
      ...metric,
      averageDurationMs: metric.calls ? Math.round((metric.totalDurationMs / metric.calls) * 10) / 10 : 0,
    })).sort((a, b) => a.operation.localeCompare(b.operation)),
  };
}

export function resetProviderMetrics(): void {
  operations.clear();
}
