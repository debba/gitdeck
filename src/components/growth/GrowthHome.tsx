import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { fetchGrowthWorkspaces } from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import { useGoals } from "../../hooks/useGoals";
import type { GhRepo } from "../../types/github";
import type { GrowthWorkspaceSummary } from "../../types/growth";
import { buildGrowthHomeSummary } from "../../utils/growthHome";
import { growthRepositoryPath } from "../../utils/growthRoutes";
import { Avatar } from "../common/Avatar";
import { RepositoryPicker } from "../common/RepositoryPicker";
import { GoalsLoadingState } from "../views/GoalsLoadingState";

interface GrowthHomeProps {
  accountId: string | null;
  enabled: boolean;
  repos: GhRepo[];
  repositoriesLoading: boolean;
  onSelectRepository: (repository: string) => void;
}

export function GrowthHome({
  accountId,
  enabled,
  repos,
  repositoriesLoading,
  onSelectRepository,
}: GrowthHomeProps) {
  const { t } = useI18n();
  const { goals, loading: goalsLoading, error: goalsError } = useGoals({ accountId, enabled });
  const [workspaceSummaries, setWorkspaceSummaries] = useState<GrowthWorkspaceSummary[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(enabled);
  const [workspacesError, setWorkspacesError] = useState("");

  useEffect(() => {
    setWorkspaceSummaries([]);
    setWorkspacesError("");
    if (!enabled || !accountId) {
      setWorkspacesLoading(false);
      return;
    }
    const controller = new AbortController();
    setWorkspacesLoading(true);
    void fetchGrowthWorkspaces(controller.signal)
      .then((workspaces) => {
        if (!controller.signal.aborted) {
          setWorkspaceSummaries(workspaces);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && (error as Error).name !== "AbortError") {
          setWorkspacesError((error as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspacesLoading(false);
      });
    return () => controller.abort();
  }, [accountId, enabled]);

  const summary = useMemo(
    () => buildGrowthHomeSummary(goals, repos, workspaceSummaries),
    [goals, repos, workspaceSummaries],
  );
  const loading = repositoriesLoading || goalsLoading || workspacesLoading;

  return (
    <section className="growth-home">
      <header className="growth-home-hero">
        <div className="growth-home-intro">
          <span>{t("growth.homeEyebrow")}</span>
          <h1>{t("growth.homeTitle")}</h1>
          <p>{t("growth.homeDescription")}</p>
        </div>
        {!loading ? (
          <dl className="growth-home-stats">
            <div><dt>{t("growth.homeWorkspaces")}</dt><dd>{summary.workspaces.length}</dd></div>
            <div><dt>{t("growth.homeMissions")}</dt><dd>{summary.totalGoals}</dd></div>
            <div><dt>{t("growth.homeCompleted")}</dt><dd>{summary.completedGoals}</dd></div>
            <div><dt>{t("growth.homeProposed")}</dt><dd>{summary.workflowTotals.proposedInterventions}</dd></div>
            <div><dt>{t("growth.homeAccepted")}</dt><dd>{summary.workflowTotals.acceptedInterventions}</dd></div>
            <div><dt>{t("growth.homeDrafts")}</dt><dd>{summary.workflowTotals.draftContent}</dd></div>
            <div><dt>{t("growth.homeReady")}</dt><dd>{summary.workflowTotals.readyContent}</dd></div>
            <div><dt>{t("growth.homeNextSevenDays")}</dt><dd>{summary.workflowTotals.nextSevenDays}</dd></div>
          </dl>
        ) : null}
      </header>

      <nav className="growth-home-shortcuts" aria-label={t("growth.homeShortcuts")}>
        <Link className="btn primary" to="/growth/calendar">{t("growth.unifiedCalendar")}</Link>
        <Link className="btn" to="/growth/review">{t("growth.review")}</Link>
        <Link className="btn" to="/growth/settings">{t("growth.settings")}</Link>
      </nav>

      {loading ? (
        <div className="growth-home-loading">
          <GoalsLoadingState label={t("growth.homeLoading")} />
        </div>
      ) : (
        <>
          {goalsError ? <div className="growth-home-error" role="alert">{t("growth.goalsLoadError", { message: goalsError })}</div> : null}
          {workspacesError ? <div className="growth-home-error" role="alert">{t("growth.summaryLoadError", { message: workspacesError })}</div> : null}

          {summary.workspaces.length ? (
            <div className="growth-home-section">
              <div className="growth-home-section-heading">
                <div>
                  <h2>{t("growth.activeRepositories")}</h2>
                  <p>{t("growth.activeRepositoriesDescription")}</p>
                </div>
                <span>{summary.workspaces.length}</span>
              </div>
              <div className="growth-home-grid">
                {summary.workspaces.map((workspace) => {
                  const owner = workspace.repo?.owner.login ?? workspace.repository.split("/")[0];
                  const workspacePath = growthRepositoryPath(workspace.repository) ?? "/growth";
                  const missionsPath = growthRepositoryPath(workspace.repository, "missions") ?? "/growth";
                  return (
                    <article
                      className="growth-home-card"
                      key={workspace.repository}
                      style={{ "--workspace-color": workspace.color } as CSSProperties}
                    >
                      <div className="growth-home-card-identity">
                        <span className="growth-home-card-color" aria-hidden="true" />
                        <Avatar login={owner} avatarUrl={workspace.repo?.owner.avatarUrl} size={46} />
                        <div>
                          <h3>{workspace.repository}</h3>
                          <p>{workspace.repo?.description || t("growth.noRepositoryDescription")}</p>
                        </div>
                      </div>
                      <div className="growth-home-card-progress">
                        <span>{t("growth.missionsCount", { count: workspace.goals.length })}</span>
                        <strong>{workspace.completedGoals}<small>/{workspace.goals.length}</small></strong>
                        <span>{t("growth.completedMissionsCount")}</span>
                      </div>
                      <dl className="growth-home-card-workflow">
                        <div><dt>{t("growth.homeProposed")}</dt><dd>{workspace.interventionsByStatus.proposed}</dd></div>
                        <div><dt>{t("growth.homeAccepted")}</dt><dd>{workspace.interventionsByStatus.accepted}</dd></div>
                        <div><dt>{t("growth.homeDrafts")}</dt><dd>{workspace.contentItemsByStatus.draft}</dd></div>
                        <div><dt>{t("growth.homeReady")}</dt><dd>{workspace.contentItemsByStatus.ready}</dd></div>
                        <div><dt>{t("growth.homeNextSevenDays")}</dt><dd>{workspace.nextSevenDays.length}</dd></div>
                      </dl>
                      <div className="growth-home-card-actions">
                        <Link className="btn primary" to={workspacePath}>{t("growth.openWorkspace")}</Link>
                        <Link className="btn" to={missionsPath}>{t("growth.openMissions")}</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : !goalsError && !workspacesError ? (
            <div className="growth-home-empty">
              <span aria-hidden="true"><TargetIcon /></span>
              <div>
                <h2>{t("growth.homeEmptyTitle")}</h2>
                <p>{t("growth.homeEmptyDescription")}</p>
              </div>
              <a className="btn primary" href="#growth-start-repository">{t("growth.chooseRepository")}</a>
            </div>
          ) : null}

          <div className="growth-home-start" id="growth-start-repository">
            <div>
              <span>{t("growth.startRepositoryEyebrow")}</span>
              <h2>{t("growth.startRepositoryTitle")}</h2>
              <p>{t("growth.startRepositoryDescription")}</p>
            </div>
            {summary.starterRepositories.length ? (
              <RepositoryPicker
                repos={summary.starterRepositories}
                value=""
                placeholder={t("growth.startRepositoryPlaceholder")}
                onChange={(repository) => {
                  if (repository) onSelectRepository(repository);
                }}
              />
            ) : (
              <p className="growth-home-all-active">
                {repos.length ? t("growth.allRepositoriesActive") : t("growth.noRepositoriesAvailable")}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="m15 9 6-6M17 3h4v4" />
    </svg>
  );
}
