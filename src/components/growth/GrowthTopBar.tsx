import type { RefObject } from "react";
import appLogo from "../../assets/app-logo-mark.svg";
import { useI18n } from "../../i18n/I18nProvider";
import type { GhRepo } from "../../types/github";
import { AccountSwitcher } from "../AccountSwitcher";
import { RepositoryPicker } from "../common/RepositoryPicker";

export type GrowthTheme = "dark" | "light" | "auto";

interface GrowthTopBarProps {
  repos: GhRepo[];
  selectedRepository: string;
  repositoriesLoading: boolean;
  theme: GrowthTheme;
  authLogin: string | null;
  canLogout: boolean;
  navigationToggleRef: RefObject<HTMLButtonElement | null>;
  onOpenNavigation: () => void;
  onRepositoryChange: (repository: string) => void;
  onThemeChange: () => void;
  onAccountChange: () => void;
  onLogout: () => void;
}

export function GrowthTopBar({
  repos,
  selectedRepository,
  repositoriesLoading,
  theme,
  authLogin,
  canLogout,
  navigationToggleRef,
  onOpenNavigation,
  onRepositoryChange,
  onThemeChange,
  onAccountChange,
  onLogout,
}: GrowthTopBarProps) {
  const { t } = useI18n();
  const themeIcon = theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐";

  return (
    <header className="growth-topbar">
      <div className="growth-brand">
        <button
          ref={navigationToggleRef}
          className="growth-navigation-toggle"
          type="button"
          aria-label={t("growth.openNavigation")}
          title={t("growth.openNavigation")}
          onClick={onOpenNavigation}
        >
          <MenuIcon />
        </button>
        <span className="growth-brand-logo" aria-hidden="true">
          <img src={appLogo} alt="" />
        </span>
        <span className="growth-brand-copy">
          <strong>{t("growth.productName")}</strong>
          <small>{t("growth.productTagline")}</small>
        </span>
      </div>

      <div className="growth-repository-control">
        <span className="growth-repository-label">{t("growth.repository")}</span>
        <RepositoryPicker
          repos={repos}
          value={selectedRepository}
          placeholder={repositoriesLoading ? t("growth.loadingRepositories") : t("growth.selectRepository")}
          onChange={onRepositoryChange}
        />
      </div>

      <div className="growth-topbar-actions">
        <button
          className="btn growth-theme-toggle"
          type="button"
          aria-label={t("theme.toggle")}
          title={`${t("theme.toggle")} · ${t(`theme.${theme}`)}`}
          onClick={onThemeChange}
        >
          <span aria-hidden="true">{themeIcon}</span>
          <span className="label">{t(`theme.${theme}`)}</span>
        </button>
        <AccountSwitcher
          authLogin={authLogin}
          canLogout={canLogout}
          onAccountChange={onAccountChange}
          onSignOut={onLogout}
        />
      </div>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
