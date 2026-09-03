import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createGoal, deleteGoal, generateGoalAdvice } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import { Avatar } from "../common/Avatar";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { RepositoryPicker } from "../common/RepositoryPicker";
import { GoalIcon } from "../common/Icons";
import { GoalProposalsModal } from "../modals/GoalProposalsModal";
import { GOAL_METRIC_DEFINITIONS, type GoalMetric, type GoalProposal, type RepositoryGoal } from "../../types/goals";
import type { GhRepo } from "../../types/github";
import { calculateGoalProgress, groupGoalsByRepository } from "../../utils/goals";
import { formatNumber } from "../../utils/format";
import { GoalsLoadingState } from "./GoalsLoadingState";

interface GoalsViewProps {
  goals: RepositoryGoal[];
  repos: GhRepo[];
  loading: boolean;
  onChange: () => Promise<void> | void;
}

const metricLabels = new Map<GoalMetric, string>(GOAL_METRIC_DEFINITIONS.map((metric) => [metric.id, metric.label]));

function currentRepoValue(repo: GhRepo | undefined, metric: GoalMetric): number {
  if (metric === "stars") return repo?.stargazerCount ?? 0;
  if (metric === "forks") return repo?.forkCount ?? 0;
  return 0;
}

export function GoalsView({ goals, repos, loading, onChange }: GoalsViewProps) {
  const { t } = useI18n();
  const [repository, setRepository] = useState("");
  const [metric, setMetric] = useState<GoalMetric>("stars");
  const [targetValue, setTargetValue] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [advisingId, setAdvisingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RepositoryGoal | null>(null);
  const [proposalTarget, setProposalTarget] = useState<{ goalId: string; index: number } | null>(null);
  // Proposals fetched while the modal is open, so reopening it shows them without a round-trip.
  const [proposalCache, setProposalCache] = useState<Record<string, { proposals: GoalProposal[]; generatedAt: string }>>({});
  const navigate = useNavigate();
  const reposByName = useMemo(() => new Map(repos.map((repo) => [repo.nameWithOwner, repo])), [repos]);
  const groupedGoals = useMemo(() => groupGoalsByRepository(goals), [goals]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await createGoal({
        repository,
        metric,
        targetValue: Number(targetValue),
        currentValue: currentRepoValue(reposByName.get(repository), metric),
        deadline,
      });
      setTargetValue("");
      setDeadline("");
      await onChange();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteGoal(id);
      await onChange();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function advise(id: string) {
    setAdvisingId(id);
    setError("");
    try {
      await generateGoalAdvice(id);
      await onChange();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setAdvisingId(null);
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
        <form className="goal-form" onSubmit={(event) => void submit(event)}>
          <label>
            {t("goals.repository")}
            <RepositoryPicker repos={repos} value={repository} placeholder={t("goals.searchRepository")} onChange={setRepository} />
          </label>
          <label>
            {t("goals.metric")}
            <select value={metric} onChange={(event) => setMetric(event.target.value as GoalMetric)}>
              {GOAL_METRIC_DEFINITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            {t("goals.target")}
            <input type="number" min="1" step="1" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} required />
          </label>
          <label>
            {t("goals.deadline")}
            <input type="date" min={new Date().toISOString().slice(0, 10)} value={deadline} onChange={(event) => setDeadline(event.target.value)} required />
          </label>
          <button className="btn primary" type="submit" disabled={saving || !repository || !repos.length}>{saving ? t("common.loading") : t("goals.add")}</button>
        </form>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {loading && !goals.length ? <GoalsLoadingState label={t("common.loadingEllipsis")} /> : null}
      {!goals.length && !loading ? <div className="empty"><h3>{t("goals.emptyTitle")}</h3><p>{t("goals.emptyText")}</p></div> : null}
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
                  {group.goals.map((goal) => (
                    <section className="goal-plan" key={goal.id}>
                      <header className="goal-plan-head">
                        <div><span>{metricLabels.get(goal.metric) ?? goal.metric}</span><strong>{t("goals.aiPlan")}</strong></div>
                        <button className="btn ghost" disabled={advisingId === goal.id} onClick={() => void advise(goal.id)}>{advisingId === goal.id ? t("common.loading") : goal.suggestions.length ? t("goals.refreshAdvice") : t("goals.generateAdvice")}</button>
                      </header>
                      {!goal.aiEnabled ? <p className="goal-ai-note">{t("goals.aiFallback")}</p> : null}
                      <div className="goal-suggestion-list">
                        {goal.suggestions.map((suggestion, index) => {
                          const hasProposals = Boolean(suggestion.proposals?.length || proposalCache[`${goal.id}:${index}`]);
                          return (
                            <article className="goal-suggestion" key={`${suggestion.title}-${index}`}>
                              <span>{suggestion.category}</span>
                              <strong>{suggestion.title}</strong>
                              <button
                                className={`goal-suggestion-proposals ${hasProposals ? "has-proposals" : ""}`}
                                type="button"
                                title={t("goals.proposalsOpen")}
                                aria-label={`${t("goals.proposalsOpen")}: ${suggestion.title}`}
                                onClick={() => setProposalTarget({ goalId: goal.id, index })}
                              >
                                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" /><circle cx="12" cy="12" r="3" /></svg>
                                <span>{t("goals.proposals")}</span>
                              </button>
                              <p>{suggestion.action}</p>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
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
      {proposalTarget ? (() => {
        const goal = goals.find((entry) => entry.id === proposalTarget.goalId);
        const suggestion = goal?.suggestions[proposalTarget.index];
        if (!goal || !suggestion) return null;
        const cached = proposalCache[`${goal.id}:${proposalTarget.index}`];
        return (
          <GoalProposalsModal
            goal={goal}
            suggestion={cached ? { ...suggestion, proposals: cached.proposals, proposalsGeneratedAt: cached.generatedAt } : suggestion}
            suggestionIndex={proposalTarget.index}
            onClose={() => setProposalTarget(null)}
            onOpenPreferences={() => { setProposalTarget(null); navigate("/preferences#preferences-ai"); }}
            onProposals={(proposals, generatedAt) => setProposalCache((prev) => ({ ...prev, [`${goal.id}:${proposalTarget.index}`]: { proposals, generatedAt } }))}
          />
        );
      })() : null}
    </div>
  );
}
