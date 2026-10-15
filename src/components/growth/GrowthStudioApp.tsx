import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  AuthRequiredClientError,
  fetchAuthStatus,
  fetchRepos,
  logoutAuth,
  type AuthMode,
} from "../../api/github";
import { invalidate as invalidateClientCache } from "../../api/cache";
import { useAccounts } from "../../contexts/AccountContext";
import { useI18n } from "../../i18n/I18nProvider";
import { useGoals } from "../../hooks/useGoals";
import type { GhRepo } from "../../types/github";
import {
  growthRepositorySwitchPath,
  parseGrowthWorkspacePath,
} from "../../utils/growthRoutes";
import { AuthGate } from "../AuthGate";
import { GoalsView } from "../views/GoalsView";
import { GrowthHome } from "./GrowthHome";
import { GrowthInterventions } from "./GrowthInterventions";
import { GrowthLibrary } from "./GrowthLibrary";
import { GrowthReview } from "./GrowthReview";
import { GrowthSettings } from "./GrowthSettings";
import { GrowthSidebar } from "./GrowthSidebar";
import { GrowthTopBar, type GrowthTheme } from "./GrowthTopBar";
import { GrowthWorkspaceOverview } from "./GrowthWorkspaceOverview";
import { GrowthCalendar } from "./calendar/GrowthCalendar";
import { GrowthUnifiedCalendar } from "./calendar/GrowthUnifiedCalendar";

type AuthState = "checking" | "anonymous" | "authenticated";
type GrowthPanelKey =
  | "growth.home"
  | "growth.unifiedCalendar"
  | "growth.review"
  | "growth.settings"
  | "growth.overview"
  | "growth.missions"
  | "growth.interventions"
  | "growth.calendar"
  | "growth.library";

const DASHBOARD_BODY_CLASSES = [
  "filters-open",
  "route-preferences",
  "tab-inbox",
  "tab-issues",
  "tab-prs",
  "tab-repos",
  "tab-kanban",
  "tab-insights",
  "tab-alerts",
  "tab-ci",
  "tab-digests",
];

function initialTheme(): GrowthTheme {
  const stored = localStorage.getItem("gh-dash.theme");
  return stored === "light" || stored === "auto" ? stored : "dark";
}

export function GrowthStudioApp() {
  const { t } = useI18n();
  const { active: activeAccount, loading: accountsLoading, refresh: refreshAccounts } = useAccounts();
  const location = useLocation();
  const navigate = useNavigate();
  const workspaceRoute = parseGrowthWorkspacePath(location.pathname);
  const selectedRepository = workspaceRoute?.repository ?? "";
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authLogin, setAuthLogin] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("device");
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [repositoryError, setRepositoryError] = useState("");
  const [repositoryLoadKey, setRepositoryLoadKey] = useState(0);
  const [theme, setTheme] = useState<GrowthTheme>(initialTheme);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationToggleRef = useRef<HTMLButtonElement>(null);

  const closeNavigation = useCallback(() => {
    if (!navigationOpen) return;
    setNavigationOpen(false);
    requestAnimationFrame(() => navigationToggleRef.current?.focus());
  }, [navigationOpen]);

  useEffect(() => {
    document.body.classList.add("mode-growth");
    document.body.classList.remove(...DASHBOARD_BODY_CLASSES);
    return () => {
      document.body.classList.remove("mode-growth");
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetchAuthStatus()
      .then((status) => {
        if (!mounted) return;
        setAuthMode(status.mode);
        if (status.authenticated) {
          setAuthLogin(status.login);
          setAuthState("authenticated");
        } else {
          setAuthState("anonymous");
        }
      })
      .catch(() => {
        if (mounted) setAuthState("anonymous");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("gh-dash.theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!navigationOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeNavigation();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeNavigation, navigationOpen]);

  useEffect(() => {
    if (authState !== "authenticated" || accountsLoading) return;
    const controller = new AbortController();
    setRepos([]);
    setRepositoryError("");
    setRepositoriesLoading(true);
    void fetchRepos(false, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRepos(data.repos);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof AuthRequiredClientError) {
          setAuthLogin(null);
          setAuthState("anonymous");
          return;
        }
        if ((error as Error).name !== "AbortError") setRepositoryError((error as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRepositoriesLoading(false);
      });
    return () => controller.abort();
  }, [authState, accountsLoading, activeAccount?.id, repositoryLoadKey]);

  function handleRepositoryChange(repository: string) {
    if (!repository) return;
    const destination = growthRepositorySwitchPath(repository, location.pathname);
    if (destination) navigate(destination);
  }

  function handleAccountChange() {
    setRepos([]);
    setRepositoryError("");
    setRepositoryLoadKey((key) => key + 1);
    navigate("/growth");
  }

  async function handleLogout() {
    setRepos([]);
    setRepositoryError("");
    try {
      await logoutAuth();
    } catch {
      // The local shell still returns to authentication when logout fails.
    }
    invalidateClientCache();
    setAuthLogin(null);
    setAuthState("anonymous");
    navigate("/growth", { replace: true });
  }

  if (authState === "checking") {
    return (
      <div className="auth-gate">
        <div className="auth-card"><p className="auth-status">{t("common.loadingEllipsis")}</p></div>
      </div>
    );
  }

  if (authState === "anonymous") {
    return (
      <AuthGate
        onAuthenticated={(login) => {
          setAuthLogin(login);
          setAuthState("authenticated");
          void refreshAccounts();
        }}
      />
    );
  }

  return (
    <div className={`growth-shell${navigationOpen ? " navigation-open" : ""}`}>
      <GrowthTopBar
        repos={repos}
        selectedRepository={selectedRepository}
        repositoriesLoading={repositoriesLoading}
        theme={theme}
        authLogin={authLogin}
        canLogout={authMode === "device"}
        navigationToggleRef={navigationToggleRef}
        onOpenNavigation={() => setNavigationOpen(true)}
        onRepositoryChange={handleRepositoryChange}
        onThemeChange={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "auto" : "dark")}
        onAccountChange={handleAccountChange}
        onLogout={() => void handleLogout()}
      />
      <button
        className="growth-sidebar-backdrop"
        type="button"
        aria-label={t("growth.closeNavigation")}
        onClick={closeNavigation}
      />
      <div className="growth-shell-layout">
        <GrowthSidebar
          open={navigationOpen}
          selectedRepository={selectedRepository}
          onNavigate={closeNavigation}
        />
        <main className="growth-main">
          {repositoryError ? (
            <div className="growth-error" role="alert">
              {t("growth.repositoryLoadError", { message: repositoryError })}
            </div>
          ) : null}
          <Routes>
            <Route
              path="/growth"
              element={(
                <GrowthHome
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                  repos={repos}
                  repositoriesLoading={repositoriesLoading}
                  onSelectRepository={handleRepositoryChange}
                />
              )}
            />
            <Route
              path="/growth/calendar"
              element={(
                <GrowthUnifiedCalendar
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                />
              )}
            />
            <Route
              path="/growth/review"
              element={(
                <GrowthReview
                  key={`${activeAccount?.id ?? "authenticated"}:global`}
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                />
              )}
            />
            <Route
              path="/growth/settings"
              element={(
                <GrowthSettings
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                />
              )}
            />
            <Route
              path="/growth/r/:owner/:repo"
              element={selectedRepository ? (
                <GrowthWorkspaceOverview
                  key={`${activeAccount?.id ?? "authenticated"}:${selectedRepository}`}
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                  repository={selectedRepository}
                  repos={repos}
                />
              ) : <Navigate to="/growth" replace />}
            />
            <Route
              path="/growth/r/:owner/:repo/missions"
              element={(
                <WorkspaceMissions
                  key={`${activeAccount?.id ?? "authenticated"}:${selectedRepository}`}
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                  repository={selectedRepository}
                  repos={repos}
                />
              )}
            />
            <Route
              path="/growth/r/:owner/:repo/interventions"
              element={selectedRepository ? (
                <GrowthInterventions
                  key={`${activeAccount?.id ?? "authenticated"}:${selectedRepository}`}
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                  repository={selectedRepository}
                />
              ) : <Navigate to="/growth" replace />}
            />
            <Route
              path="/growth/r/:owner/:repo/calendar"
              element={selectedRepository ? (
                <GrowthCalendar
                  key={`${activeAccount?.id ?? "authenticated"}:${selectedRepository}`}
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                  repository={selectedRepository}
                />
              ) : <Navigate to="/growth" replace />}
            />
            <Route
              path="/growth/r/:owner/:repo/library"
              element={selectedRepository ? (
                <GrowthLibrary
                  key={`${activeAccount?.id ?? "authenticated"}:${selectedRepository}`}
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                  repository={selectedRepository}
                  repos={repos}
                />
              ) : <Navigate to="/growth" replace />}
            />
            <Route
              path="/growth/r/:owner/:repo/review"
              element={selectedRepository ? (
                <GrowthReview
                  key={`${activeAccount?.id ?? "authenticated"}:${selectedRepository}`}
                  accountId={activeAccount?.id ?? null}
                  enabled={!accountsLoading}
                  repository={selectedRepository}
                />
              ) : <Navigate to="/growth" replace />}
            />
            <Route path="*" element={<Navigate to="/growth" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

interface WorkspaceMissionsProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
  repos: GhRepo[];
}

function WorkspaceMissions({ accountId, enabled, repository, repos }: WorkspaceMissionsProps) {
  const { t } = useI18n();
  const { goals, loading, error, refresh } = useGoals({ accountId, enabled, repository });
  const scopedRepos = useMemo(
    () => repos.filter((repo) => repo.nameWithOwner === repository),
    [repository, repos],
  );

  if (!repository) return <Navigate to="/growth" replace />;

  return (
    <GoalsView
      goals={goals}
      repos={scopedRepos}
      loading={loading}
      loadError={error ? t("growth.goalsLoadError", { message: error }) : ""}
      fixedRepository={repository}
      onChange={refresh}
    />
  );
}

function GrowthPlaceholder({ titleKey, repository }: { titleKey: GrowthPanelKey; repository?: string }) {
  const { t } = useI18n();
  return (
    <section className="growth-placeholder">
      <span className="growth-placeholder-eyebrow">
        {repository ? t("growth.repositoryWorkspace") : t("growth.growthStudio")}
      </span>
      <h1>{t(titleKey)}</h1>
      {repository ? <p className="growth-placeholder-repository">{repository}</p> : null}
      <p>{t("growth.placeholderDescription")}</p>
    </section>
  );
}
