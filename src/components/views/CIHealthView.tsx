import { useMemo, useState } from "react";
import type { GhRepo, RepoCIHealth } from "../../types/github";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { useI18n } from "../../i18n/I18nProvider";

type SortKey = "health_asc" | "health_desc" | "failures_desc" | "runs_desc" | "recent_failure" | "name_asc";

interface CIHealthViewProps {
  data: RepoCIHealth[];
  reposByName: Map<string, GhRepo>;
  onRepoClick: (repo: GhRepo) => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

function healthLabel(rate: number, totalDecided: number): string {
  if (totalDecided === 0) return "no data";
  if (rate >= 0.95) return "strong";
  if (rate >= 0.75) return "watch";
  return "risky";
}

export function CIHealthView({ data, reposByName, onRepoClick }: CIHealthViewProps) {
  const { language, t } = useI18n();
  const [sort, setSort] = useState<SortKey>("health_asc");

  const sorted = useMemo(() => {
    const list = [...data];
    list.sort((a, b) => {
      switch (sort) {
        case "health_asc":
          return a.successRate - b.successRate || b.failureCount - a.failureCount;
        case "health_desc":
          return b.successRate - a.successRate || a.failureCount - b.failureCount;
        case "failures_desc":
          return b.failureCount - a.failureCount;
        case "runs_desc":
          return b.totalRuns - a.totalRuns;
        case "recent_failure": {
          const ax = a.lastFailure ? Date.parse(a.lastFailure.createdAt) : 0;
          const bx = b.lastFailure ? Date.parse(b.lastFailure.createdAt) : 0;
          return bx - ax;
        }
        case "name_asc":
          return a.repo.localeCompare(b.repo);
      }
    });
    return list;
  }, [data, sort]);

  if (!data.length) {
    return (
      <div className="empty">
        <div className="big">{t("ci.noActivity")}</div>
        <div>{t("ci.noActivityText")}</div>
      </div>
    );
  }

  return (
    <div className="view-ci-health">
      <div className="toolbar">
        <span className="count-chip">{t("ci.repositoriesCount", { count: sorted.length })}</span>
        <div className="spacer" />
        <label htmlFor="ci-sort">{t("common.sort")}</label>
        <select id="ci-sort" className="sort" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
          <option value="health_asc">{t("sort.mostAtRisk")}</option>
          <option value="health_desc">{t("sort.bestHealth")}</option>
          <option value="failures_desc">{t("sort.mostFailures")}</option>
          <option value="recent_failure">{t("sort.recentFailureFirst")}</option>
          <option value="runs_desc">{t("sort.mostRuns")}</option>
          <option value="name_asc">{t("sort.nameAZ")}</option>
        </select>
      </div>
      <div className="ci-table" role="table">
        <div className="ci-row ci-row-head" role="row">
          <div role="columnheader">{t("stats.repositories")}</div>
          <div role="columnheader">{t("ci.successRate")}</div>
          <div role="columnheader">{t("ci.runs")}</div>
          <div role="columnheader">{t("ci.avgDuration")}</div>
          <div role="columnheader">{t("ci.lastRun")}</div>
          <div role="columnheader">{t("ci.lastFailure")}</div>
        </div>
        {sorted.map((entry) => {
          const repo = reposByName.get(entry.repo);
          const decided = entry.successCount + entry.failureCount;
          const ratePct = decided ? Math.round(entry.successRate * 100) : 0;
          const label = healthLabel(entry.successRate, decided);
          return (
            <div className="ci-row" role="row" key={entry.repo}>
              <div role="cell" className="ci-repo" data-label={t("stats.repositories")}>
                <span className={`ci-health-dot ci-health-${label}`} aria-hidden="true" />
                <button
                  type="button"
                  className="ci-repo-link"
                  onClick={() => repo && onRepoClick(repo)}
                  disabled={!repo}
                  title={entry.repo}
                >
                  {entry.repo}
                </button>
              </div>
              <div role="cell" className="ci-rate" data-label={t("ci.successRate")}>
                <div className="ci-rate-top">
                  <span className={`ci-rate-pct ci-rate-${label}`}>
                    {decided ? `${ratePct}%` : "—"}
                  </span>
                  <span className="ci-rate-counts">
                    <span className="ci-count ci-count-ok">{entry.successCount}✓</span>
                    <span className="ci-count ci-count-fail">{entry.failureCount}✗</span>
                    {entry.cancelledCount ? <span className="ci-count">{entry.cancelledCount}⊘</span> : null}
                  </span>
                </div>
                <div className={`ci-bar ci-bar-${label}`}>
                  <div className="ci-bar-fill" style={{ width: `${decided ? ratePct : 0}%` }} />
                </div>
              </div>
              <div role="cell" data-label={t("ci.runs")}>{formatNumber(entry.totalRuns)}</div>
              <div role="cell" data-label={t("ci.avgDuration")}>{formatDuration(entry.avgDurationSec)}</div>
              <div role="cell" className="ci-last" data-label={t("ci.lastRun")}>
                {entry.lastRun ? (
                  <a href={entry.lastRun.url} target="_blank" rel="noopener noreferrer">
                    <span className={`ci-conclusion ${entry.lastRun.conclusion ?? entry.lastRun.status}`}>
                      {entry.lastRun.conclusion ?? entry.lastRun.status}
                    </span>
                    <span className="ci-when">{formatRelativeTime(entry.lastRun.createdAt, Date.now(), language)}</span>
                  </a>
                ) : "—"}
              </div>
              <div role="cell" className="ci-last" data-label={t("ci.lastFailure")}>
                {entry.lastFailure ? (
                  <a href={entry.lastFailure.url} target="_blank" rel="noopener noreferrer">
                    <span className="ci-workflow">{entry.lastFailure.workflowName}</span>
                    <span className="ci-when">{formatRelativeTime(entry.lastFailure.createdAt, Date.now(), language)}</span>
                  </a>
                ) : <span className="ci-none">—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
