import type { GhRepo, RepoInsight } from "../../types/github";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { useI18n } from "../../i18n/I18nProvider";

interface InsightsViewProps {
  insights: RepoInsight[];
  reposByName: Map<string, GhRepo>;
  onRepoClick: (repo: GhRepo) => void;
  emptyTitleKey?: "insights.emptyTitle" | "alerts.emptyTitle";
  emptyTextKey?: "insights.emptyText" | "alerts.emptyText";
}

export function InsightsView({
  insights,
  reposByName,
  onRepoClick,
  emptyTitleKey = "insights.emptyTitle",
  emptyTextKey = "insights.emptyText",
}: InsightsViewProps) {
  const { language, t } = useI18n();
  if (!insights.length) {
    return <div className="empty"><div className="big">{t(emptyTitleKey)}</div><div>{t(emptyTextKey)}</div></div>;
  }

  return (
    <div className="insights-list">
      {insights.map((insight) => {
        const repo = reposByName.get(insight.repo);
        if (!repo) return null;
        return (
          <article className="insight-card" key={insight.repo} onClick={() => onRepoClick(repo)} onKeyDown={(event) => event.key === "Enter" && onRepoClick(repo)} tabIndex={0}>
            <div className="insight-head">
              <div>
                <strong>{insight.repo}</strong>
                <span>{t("insights.health", { score: insight.healthScore, label: insight.healthLabel })}</span>
              </div>
              <div className={`health-pill ${insight.healthLabel}`}>{insight.healthLabel}</div>
            </div>
            <div className="insight-meta">
              <span>{t("insights.openIssues", { count: insight.issueCount })}</span>
              <span>{t("insights.stale", { count: insight.staleIssueCount })}</span>
              <span>{t("insights.views", { count: formatNumber(insight.viewsCount) })}</span>
              <span>{t("insights.downloads", { count: formatNumber(insight.totalDownloads) })}</span>
              {insight.securityAlertsCount > 0 ? <span>{t("insights.securityAlerts", { count: formatNumber(insight.securityAlertsCount) })}</span> : insight.vulnerabilityAlertsStatus === "disabled" ? <span>{t("insights.securityAlertsOff")}</span> : null}
              <span>{t("repo.pushed", { time: repo.pushedAt ? formatRelativeTime(repo.pushedAt, Date.now(), language) : "-" })}</span>
            </div>
            {insight.securityAlertsUnavailable || insight.vulnerabilityAlertsStatus === "unknown" ? (
              <div className="insight-section">
                <h4>{t("insights.securityStatus")}</h4>
                <p>{insight.securityAlertsUnavailable ? t("insights.securityUnavailable") : t("insights.securityAlertsUnknown")}</p>
              </div>
            ) : null}
            {insight.alerts.length ? (
              <div className="insight-section">
                <h4>{t("insights.alerts")}</h4>
                {insight.alerts.map((item) => <p key={item}>{item}</p>)}
              </div>
            ) : null}
            {insight.opportunities.length ? (
              <div className="insight-section">
                <h4>{t("insights.opportunities")}</h4>
                {insight.opportunities.map((item) => <p key={item}>{item}</p>)}
              </div>
            ) : null}
            {insight.correlations.length ? (
              <div className="insight-section">
                <h4>{t("insights.correlation")}</h4>
                {insight.correlations.map((item) => <p key={item}>{item}</p>)}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
