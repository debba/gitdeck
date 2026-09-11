import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchGrowthWorkspaceSummary } from "../../api/growth";
import { useGoals } from "../../hooks/useGoals";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import type { GhRepo } from "../../types/github";
import {
  GROWTH_CONTENT_ITEM_STATUSES,
  GROWTH_INTERVENTION_STATUSES,
  type GrowthContentItemStatus,
  type GrowthInterventionStatus,
  type GrowthWorkspaceSummary,
} from "../../types/growth";
import { GOAL_METRIC_DEFINITIONS, type GoalMetric } from "../../types/goals";
import { formatNumber } from "../../utils/format";
import { growthRepositoryPath } from "../../utils/growthRoutes";
import { buildGrowthWorkspaceGoalSummary } from "../../utils/growthWorkspace";
import { Avatar } from "../common/Avatar";

interface GrowthWorkspaceOverviewProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
  repos: GhRepo[];
}

const metricLabels = new Map<GoalMetric, string>(
  GOAL_METRIC_DEFINITIONS.map((metric) => [metric.id, metric.label]),
);

const interventionStatusLabels: Record<GrowthInterventionStatus, TranslationKey> = {
  proposed: "growth.status.proposed",
  accepted: "growth.status.accepted",
  dismissed: "growth.status.dismissed",
  done: "growth.status.done",
};

const contentStatusLabels: Record<GrowthContentItemStatus, TranslationKey> = {
  idea: "growth.status.idea",
  draft: "growth.status.draft",
  ready: "growth.status.ready",
  scheduled: "growth.status.scheduled",
  published: "growth.status.published",
  skipped: "growth.status.skipped",
};

export function GrowthWorkspaceOverview({
  accountId,
  enabled,
  repository,
  repos,
}: GrowthWorkspaceOverviewProps) {
  const { language, t } = useI18n();
  const { goals, loading: goalsLoading, error: goalsError } = useGoals({ accountId, enabled, repository });
  const [summary, setSummary] = useState<GrowthWorkspaceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(enabled);
  const [summaryError, setSummaryError] = useState("");
  const repo = useMemo(
    () => repos.find((candidate) => candidate.nameWithOwner === repository) ?? null,
    [repos, repository],
  );
  const goalSummary = useMemo(() => buildGrowthWorkspaceGoalSummary(goals), [goals]);
  const workspaceBase = growthRepositoryPath(repository) ?? "/growth";
  const owner = repo?.owner.login ?? repository.split("/")[0];

  useEffect(() => {
    setSummary(null);
    setSummaryError("");
    if (!enabled || !repository) {
      setSummaryLoading(false);
      return;
    }

    const controller = new AbortController();
    setSummaryLoading(true);
    void fetchGrowthWorkspaceSummary(repository, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSummary(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && (error as Error).name !== "AbortError") {
          setSummaryError((error as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });

    return () => controller.abort();
  }, [accountId, enabled, repository]);

  return (
    <section className="growth-overview">
      <header className="growth-overview-hero">
        <div className="growth-overview-identity">
          <Avatar login={owner} avatarUrl={repo?.owner.avatarUrl} size={54} />
          <div>
            <span>{t("growth.overviewEyebrow")}</span>
            <h1>{repository}</h1>
            <p>{repo?.description || t("growth.noRepositoryDescription")}</p>
          </div>
        </div>
        {repo ? (
          <dl className="growth-overview-repo-stats">
            <div><dt>{t("growth.overviewStars")}</dt><dd>{formatNumber(repo.stargazerCount)}</dd></div>
            <div><dt>{t("growth.overviewForks")}</dt><dd>{formatNumber(repo.forkCount)}</dd></div>
            <div><dt>{t("growth.overviewLanguage")}</dt><dd>{repo.primaryLanguage?.name ?? t("common.unavailable")}</dd></div>
          </dl>
        ) : null}
      </header>

      {goalsError ? (
        <div className="growth-overview-error" role="alert">
          {t("growth.goalsLoadError", { message: goalsError })}
        </div>
      ) : null}
      {summaryError ? (
        <div className="growth-overview-error" role="alert">
          {t("growth.summaryLoadError", { message: summaryError })}
        </div>
      ) : null}

      <div className="growth-overview-grid">
        <section className="growth-overview-card growth-overview-missions">
          <header className="growth-overview-card-heading">
            <div>
              <span>{t("growth.overviewProgressEyebrow")}</span>
              <h2>{t("growth.overviewMissionsTitle")}</h2>
            </div>
            {!goalsLoading ? (
              <strong>{t("growth.overviewMissionsSummary", {
                completed: goalSummary.completed,
                count: goalSummary.goals.length,
              })}</strong>
            ) : null}
          </header>

          {goalsLoading ? (
            <p className="growth-overview-loading">{t("growth.overviewLoadingMissions")}</p>
          ) : goalSummary.goals.length ? (
            <div className="growth-overview-goal-list">
              {goalSummary.goals.map(({ goal, progress }) => (
                <article className={`growth-overview-goal${progress.completed ? " complete" : progress.overdue ? " overdue" : ""}`} key={goal.id}>
                  <div className="growth-overview-goal-heading">
                    <strong>{metricLabels.get(goal.metric) ?? goal.metric}</strong>
                    <span>{progress.percentage}%</span>
                  </div>
                  <div className="growth-overview-progress" role="progressbar" aria-valuenow={progress.percentage} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${progress.percentage}%` }} />
                  </div>
                  <div className="growth-overview-goal-meta">
                    <span>{formatNumber(goal.currentValue)} / {formatNumber(goal.targetValue)}</span>
                    <span>{progress.completed
                      ? t("goals.completed")
                      : progress.overdue
                        ? t("goals.overdue")
                        : t("goals.daysLeft", { count: progress.daysRemaining })}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="growth-overview-empty">
              <p>{t("growth.overviewNoMissions")}</p>
              <Link className="btn primary" to={`${workspaceBase}/missions`}>{t("growth.overviewCreateMission")}</Link>
            </div>
          )}
        </section>

        <section className="growth-overview-card growth-overview-status-card">
          <header className="growth-overview-card-heading">
            <div><span>{t("growth.overviewBacklogEyebrow")}</span><h2>{t("growth.overviewInterventionsTitle")}</h2></div>
          </header>
          <StatusCounters
            statuses={GROWTH_INTERVENTION_STATUSES}
            labels={interventionStatusLabels}
            values={summary?.interventionsByStatus}
            loading={summaryLoading}
          />
        </section>

        <section className="growth-overview-card growth-overview-status-card">
          <header className="growth-overview-card-heading">
            <div><span>{t("growth.overviewEditorialEyebrow")}</span><h2>{t("growth.overviewContentTitle")}</h2></div>
          </header>
          <StatusCounters
            statuses={GROWTH_CONTENT_ITEM_STATUSES}
            labels={contentStatusLabels}
            values={summary?.contentItemsByStatus}
            loading={summaryLoading}
          />
        </section>

        <section className="growth-overview-card growth-overview-next">
          <header className="growth-overview-card-heading">
            <div><span>{t("growth.overviewScheduleEyebrow")}</span><h2>{t("growth.overviewNextSevenDays")}</h2></div>
          </header>
          {summaryLoading ? (
            <p className="growth-overview-loading">{t("growth.overviewLoadingSummary")}</p>
          ) : summary?.nextSevenDays.length ? (
            <div className="growth-overview-next-list">
              {summary.nextSevenDays.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.title}</strong><span>{item.channel}</span></div>
                  {item.scheduledFor ? (
                    <time dateTime={item.scheduledFor}>
                      {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.scheduledFor))}
                    </time>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="growth-overview-next-empty">{t("growth.overviewNextEmpty")}</p>
          )}
        </section>
      </div>

      <section className="growth-overview-actions">
        <div><span>{t("growth.overviewActionsEyebrow")}</span><h2>{t("growth.overviewActionsTitle")}</h2><p>{t("growth.overviewActionsDescription")}</p></div>
        <nav aria-label={t("growth.overviewActionsTitle")}>
          <Link className="btn primary" to={`${workspaceBase}/missions`}>{t("growth.missions")}</Link>
          <Link className="btn" to={`${workspaceBase}/interventions`}>{t("growth.interventions")}</Link>
          <Link className="btn" to={`${workspaceBase}/calendar`}>{t("growth.calendar")}</Link>
          <Link className="btn" to={`${workspaceBase}/library`}>{t("growth.library")}</Link>
        </nav>
      </section>
    </section>
  );
}

interface StatusCountersProps<Status extends string> {
  statuses: readonly Status[];
  labels: Record<Status, TranslationKey>;
  values: Record<Status, number> | undefined;
  loading: boolean;
}

function StatusCounters<Status extends string>({ statuses, labels, values, loading }: StatusCountersProps<Status>) {
  const { t } = useI18n();
  return (
    <dl className="growth-overview-counters" aria-busy={loading}>
      {statuses.map((status) => (
        <div key={status}>
          <dt>{t(labels[status])}</dt>
          <dd>{loading ? "…" : values?.[status] ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}
