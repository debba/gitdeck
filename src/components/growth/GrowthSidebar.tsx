import { useEffect, useRef, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider";
import { growthRepositoryPath } from "../../utils/growthRoutes";

interface GrowthSidebarProps {
  open: boolean;
  selectedRepository: string;
  onNavigate: () => void;
}

interface NavigationItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function GrowthSidebar({ open, selectedRepository, onNavigate }: GrowthSidebarProps) {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);
  const workspaceBase = selectedRepository ? growthRepositoryPath(selectedRepository) : null;

  const globalItems: NavigationItem[] = [
    { to: "/growth", label: t("growth.home"), icon: <HomeIcon />, end: true },
    { to: "/growth/calendar", label: t("growth.unifiedCalendar"), icon: <CalendarIcon /> },
    { to: "/growth/review", label: t("growth.review"), icon: <ReviewIcon /> },
    { to: "/growth/settings", label: t("growth.settings"), icon: <SettingsIcon /> },
  ];

  const workspaceItems: NavigationItem[] = workspaceBase ? [
    { to: workspaceBase, label: t("growth.overview"), icon: <OverviewIcon />, end: true },
    { to: `${workspaceBase}/missions`, label: t("growth.missions"), icon: <MissionsIcon /> },
    { to: `${workspaceBase}/interventions`, label: t("growth.interventions"), icon: <InterventionsIcon /> },
    { to: `${workspaceBase}/calendar`, label: t("growth.calendar"), icon: <CalendarIcon /> },
    { to: `${workspaceBase}/library`, label: t("growth.library"), icon: <LibraryIcon /> },
    { to: `${workspaceBase}/review`, label: t("growth.review"), icon: <ReviewIcon /> },
  ] : [];

  return (
    <aside className="growth-sidebar" aria-label={t("growth.navigation")}>
      <div className="growth-sidebar-header">
        <span>{t("growth.navigation")}</span>
        <button ref={closeButtonRef} type="button" aria-label={t("growth.closeNavigation")} onClick={onNavigate}>×</button>
      </div>
      <nav className="growth-navigation" aria-label={t("growth.globalNavigation")}>
        {globalItems.map((item) => <GrowthNavLink key={item.to} item={item} onNavigate={onNavigate} />)}
      </nav>

      <div className="growth-sidebar-workspace">
        <div className="growth-sidebar-section-title">
          <span>{t("growth.workspace")}</span>
          {selectedRepository ? <strong title={selectedRepository}>{selectedRepository}</strong> : null}
        </div>
        {workspaceItems.length ? (
          <nav className="growth-navigation" aria-label={t("growth.repositoryNavigation")}>
            {workspaceItems.map((item) => <GrowthNavLink key={item.to} item={item} onNavigate={onNavigate} />)}
          </nav>
        ) : (
          <p className="growth-sidebar-empty">{t("growth.noRepositorySelected")}</p>
        )}
      </div>
    </aside>
  );
}

function GrowthNavLink({ item, onNavigate }: { item: NavigationItem; onNavigate: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `growth-navigation-link${isActive ? " active" : ""}`}
      onClick={onNavigate}
    >
      <span className="growth-navigation-icon" aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function HomeIcon() {
  return <Icon><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></Icon>;
}

function CalendarIcon() {
  return <Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon>;
}

function ReviewIcon() {
  return <Icon><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /></Icon>;
}

function SettingsIcon() {
  return <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21h-4v-.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3v-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 4.2l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3h4v.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21v4h-.05A1.7 1.7 0 0 0 19.4 15Z" /></Icon>;
}

function OverviewIcon() {
  return <Icon><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icon>;
}

function MissionsIcon() {
  return <Icon><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m15 9 6-6M17 3h4v4" /></Icon>;
}

function InterventionsIcon() {
  return <Icon><path d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="8" /></Icon>;
}

function LibraryIcon() {
  return <Icon><path d="M4 4h5v16H4zM10 4h5v16h-5zM16 5l4-1 3 15-4 1z" /></Icon>;
}
