import type { SwrSource } from "../api/cache";
import type { DashboardResource, DashboardTab } from "./dataRequirements";

export interface DashboardLoadMetric {
  id: number;
  tab: DashboardTab;
  resources: DashboardResource[];
  fresh: boolean;
  startedAt: string;
  firstContentMs: number | null;
  totalMs: number;
  networkRequests: number;
  cacheHits: number;
  deduplicatedRequests: number;
  failures: number;
}

const MAX_METRICS = 50;
const metrics: DashboardLoadMetric[] = [];
let nextId = 1;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function beginDashboardLoad(tab: DashboardTab, resources: Set<DashboardResource>, fresh: boolean) {
  const id = nextId++;
  const started = now();
  const startedAt = new Date().toISOString();
  let firstContentMs: number | null = null;
  let networkRequests = 0;
  let cacheHits = 0;
  let deduplicatedRequests = 0;
  let failures = 0;
  let completed = 0;

  return {
    startResource(_resource: DashboardResource, source: SwrSource) {
      if (source === "network") networkRequests += 1;
      else if (source === "cache") cacheHits += 1;
      else deduplicatedRequests += 1;
    },
    finishResource(_resource: DashboardResource, ok: boolean) {
      const elapsed = Math.round((now() - started) * 10) / 10;
      if (firstContentMs === null && ok) firstContentMs = elapsed;
      if (!ok) failures += 1;
      completed += 1;
      if (completed !== resources.size) return;
      const metric: DashboardLoadMetric = {
        id,
        tab,
        resources: [...resources],
        fresh,
        startedAt,
        firstContentMs,
        totalMs: elapsed,
        networkRequests,
        cacheHits,
        deduplicatedRequests,
        failures,
      };
      metrics.push(metric);
      if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("gitdeck:dashboard-load", { detail: metric }));
        if (localStorage.getItem("gh-dash.diagnostics") === "1") {
          console.info("[gitdeck:load]", metric);
        }
      }
    },
  };
}

export function getDashboardLoadMetrics(): DashboardLoadMetric[] {
  return metrics.map((metric) => ({ ...metric, resources: [...metric.resources] }));
}

export function clearDashboardLoadMetrics(): void {
  metrics.length = 0;
  nextId = 1;
}
