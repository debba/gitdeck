import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteGoal } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import { Avatar } from "../common/Avatar";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { GoalIcon } from "../common/Icons";
import { GOAL_METRIC_DEFINITIONS, type GoalMetric, type RepositoryGoal } from "../../types/goals";
import type { GhRepo } from "../../types/github";
import { calculateGoalProgress, groupGoalsByRepository } from "../../utils/goals";
import { formatNumber } from "../../utils/format";
import { growthRepositoryPath } from "../../utils/growthRoutes";
import { GoalCreateModal } from "../modals/GoalCreateModal";
import { GoalsLoadingState } from "./GoalsLoadingState";

interface GoalsViewProps {
  goals: RepositoryGoal[];
  repos: GhRepo[];
  loading: boolean;
  onChange: () => Promise<void> | void;
  fixedRepository?: string;
  loadError?: string;
}

const metricLabels = new Map<GoalMetric, string>(GOAL_METRIC_DEFINITIONS.map((metric) => [metric.id, metric.label]));

export function GoalsView({ goals, repos, loading, onChange, fixedRepository, loadError = "" }: GoalsViewProps) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RepositoryGoal | null>(null);
  const scopedRepos = useMemo(
    () => fixedRepository ? repos.filter((repo) => repo.nameWithOwner === fixedRepository) : repos,
    [fixedRepository, repos],
  );
  const scopedGoals = useMemo(
    () => fixedRepository ? goals.filter((goal) => goal.repository === fixedRepository) : goals,
    [fixedRepository, goals],
  );
  const reposByName = useMemo(() => new Map(scopedRepos.map((repo) => [repo.nameWithOwner, repo])), [scopedRepos]);
  const groupedGoals = useMemo(() => groupGoalsByRepository(scopedGoals), [scopedGoals]);

  async function remove(id: string) {
    try {
      await deleteGoal(id);
      await onChange();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="goals-view">
      <section className="goal-create-card">
        <div className="goal-create-intro">
          <span className="goal-create-icon"><GoalIcon /></span>
          <div>
            <h2>{t("goals.createTitle")}</h2>
            <p>{t("goals.createDescription")}</p>
          </div>
        </div>
        <button className="btn primary goal-create-button" type="button" disabled={!scopedRepos.length} onClick={() => setCreateOpen(true)}>
          <GoalIcon />
          {t("goals.add")}
        </button>
      </section>

      {error || loadError ? <div className="error" role="alert">{error || loadError}</div> : null}
      {loading && !scopedGoals.length ? <GoalsLoadingState label={t("common.loadingEllipsis")} /> : null}
      {!scopedGoals.length && !loading && !loadError ? <div className="empty"><h3>{t("goals.emptyTitle")}</h3><p>{t("goals.emptyText")}</p></div> : null}
      <div className="goal-repository-list">
        {groupedGoals.map((group) => {
          const repo = reposByName.get(group.repository);
          const completedCount = group.goals.filter((goal) => calculateGoalProgress(goal).completed).length;
          return (
            <section className="goal-repository-card" key={group.repository}>
              <header className="goal-repository-hero">
                <div className="goal-repository-identity">
                  <Avatar login={repo?.owner.login ?? group.repository.split("/")[0]} avatarUrl={repo?.owner.avatarUrl} size={44} />
                  <div>
                    <span className="goal-repository-kicker"><i /> {t("goals.mission")}</span>
                    <h2>{group.repository}</h2>
                    <p>{repo?.description || t("repo.noDescription")}</p>
                  </div>
                </div>
                <div className="goal-repository-score">
                  <strong>{completedCount}<span>/{group.goals.length}</span></strong>
                  <small>{t("goals.completedMissions")}</small>
                </div>
              </header>

              <div className="goal-track-grid">
                {group.goals.map((goal) => {
                  const progress = calculateGoalProgress(goal);
                  return (
                    <article className={`goal-track${progress.completed ? " complete" : progress.overdue ? " overdue" : ""}`} key={goal.id}>
                      <header>
                        <span className="goal-metric">{metricLabels.get(goal.metric) ?? goal.metric}</span>
                        <button className="icon-btn" onClick={() => setDeleteTarget(goal)} aria-label={t("common.remove")} title={t("common.remove")}>×</button>
                      </header>
                      <div className="goal-track-main">
                        <div className="goal-progress-orbit" style={{ background: `conic-gradient(var(--goal-tone) ${progress.percentage}%, var(--panel-3) 0)` }}>
                          <div><strong>{progress.percentage}</strong><span>%</span></div>
                        </div>
                        <div className="goal-track-copy">
                          <div className="goal-values"><strong>{formatNumber(goal.currentValue)}</strong><span>/ {formatNumber(goal.targetValue)}</span></div>
                          <div className="goal-progress" role="progressbar" aria-valuenow={progress.percentage} aria-valuemin={0} aria-valuemax={100}>
                            <span style={{ width: `${progress.percentage}%` }} />
                          </div>
                          <div className="goal-meta">
                            <span>{progress.completed ? t("goals.completed") : t("goals.remaining", { count: formatNumber(progress.remaining) })}</span>
                            <span>{progress.overdue ? t("goals.overdue") : t("goals.daysLeft", { count: progress.daysRemaining })}</span>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="goal-growth-studio">
                <div className="goal-studio-heading">
                  <div><span>{t("goals.growthStudioEyebrow")}</span><h3>{t("goals.growthStudio")}</h3></div>
                  <p>{t("goals.growthStudioDescription")}</p>
                </div>
                <div className="goal-plan-grid">
                  <section className="goal-plan goal-interventions-link">
                    <header className="goal-plan-head">
                      <div><span>{t("growth.interventionsEyebrow")}</span><strong>{t("growth.missionsBacklogTitle")}</strong></div>
                      <Link className="btn primary" to={`${growthRepositoryPath(group.repository) ?? "/growth"}/interventions`}>
                        {t("growth.missionsOpenBacklog")}
                      </Link>
                    </header>
                    <p>{t("growth.missionsBacklogDescription")}</p>
                  </section>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <GoalCreateModal
        open={createOpen}
        repos={scopedRepos}
        fixedRepository={fixedRepository}
        onClose={() => setCreateOpen(false)}
        onCreated={onChange}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        kind={t("tabs.goals")}
        title={t("goals.deleteTitle")}
        message={<p>{t("goals.deleteMessage", {
          metric: deleteTarget ? metricLabels.get(deleteTarget.metric) ?? deleteTarget.metric : "",
          repo: deleteTarget?.repository ?? "",
        })}</p>}
        confirmLabel={t("common.remove")}
        danger
        icon={<GoalIcon />}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const id = deleteTarget?.id;
          setDeleteTarget(null);
          if (id) void remove(id);
        }}
      />
    </div>
  );
}
