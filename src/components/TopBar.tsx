import { useEffect, useRef, useState } from "react";
import appLogo from "../assets/app-logo-mark.svg";
import { useI18n } from "../i18n/I18nProvider";
import type { Language } from "../utils/i18n";
import { AccountSwitcher } from "./AccountSwitcher";

type Theme = "dark" | "light" | "auto";
type TextSize = "small" | "normal" | "large";

interface TopBarProps {
  subtitle: string;
  lastUpdated: string;
  loading: boolean;
  theme: Theme;
  textSize: TextSize;
  hideArchivedNoise: boolean;
  authLogin: string | null;
  owners: string[];
  githubAvatars?: boolean;
  onThemeChange: (theme: Theme) => void;
  onTextSizeChange: (textSize: TextSize) => void;
  onHideArchivedNoiseChange: (hideArchivedNoise: boolean) => void;
  onRefresh: () => void;
  onOpenFilters: () => void;
  onOpenPalette: () => void;
  onLogout: () => void;
  canLogout?: boolean;
}

export function TopBar({
  subtitle,
  lastUpdated,
  loading,
  theme,
  textSize,
  hideArchivedNoise,
  authLogin,
  owners,
  githubAvatars = true,
  onThemeChange,
  onTextSizeChange,
  onHideArchivedNoiseChange,
  onRefresh,
  onOpenFilters,
  onOpenPalette,
  onLogout,
  canLogout = true,
}: TopBarProps) {
  const { language, languages, setLanguage, t } = useI18n();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const preferencesRef = useRef<HTMLDivElement | null>(null);
  // Orgs are all owners except the user's own login
  const orgs = owners.filter((o) => o !== authLogin);

  useEffect(() => {
    if (!preferencesOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!preferencesRef.current?.contains(event.target as Node)) setPreferencesOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPreferencesOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [preferencesOpen]);

  return (
    <div className="topbar">
      <div className="brand">
        {/* Wrapper for logo + org badges. Logo keeps its original overflow:hidden for border-radius. */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div className="logo">
            <img src={authLogin && githubAvatars ? `https://github.com/${authLogin}.png?size=80` : appLogo} alt="" referrerPolicy="no-referrer" />
          </div>
          {/* Org badges: positioned relative to wrapper, outside logo's overflow:hidden */}
          {githubAvatars && orgs.length > 0 && orgs.slice(0, 3).map((org, i) => (
            <img key={org} src={`https://github.com/${org}.png?size=40`} alt={org} title={org} loading="lazy" referrerPolicy="no-referrer"
              style={{ position: "absolute", bottom: -4, right: -4 + i * 8, width: 20, height: 20, borderRadius: "50%", objectFit: "contain", objectPosition: "55% center", zIndex: 3 - i, border: "1px solid var(--border-soft)", background: "color-mix(in srgb, var(--panel) 85%, transparent)" }} />
          ))}
        </div>
        <div className="texts">
          <h1>{t("app.title")}</h1>
          <div className="sub">{subtitle}</div>
        </div>
      </div>
      <div className="spacer" />
      <div className="topbar-actions">
        <span className="meta">{lastUpdated}</span>
        <AccountSwitcher />
        <button className="btn search-btn" aria-label={t("common.searchShortcut")} title={t("common.searchShortcut")} onClick={onOpenPalette}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <span className="label">{t("common.search")}</span>
          <kbd className="kbd kbd--sm">⌘K</kbd>
        </button>
        <div className="preferences-menu" ref={preferencesRef}>
          <button
            className={`btn preferences-btn ${preferencesOpen ? "active" : ""}`}
            type="button"
            aria-label={t("preferences.label")}
            aria-expanded={preferencesOpen}
            title={t("preferences.label")}
            onClick={() => setPreferencesOpen((open) => !open)}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 1 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.09 1.65V21a2.1 2.1 0 1 1-4.2 0v-.08a1.8 1.8 0 0 0-1.12-1.65 1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.1 13H2a2.1 2.1 0 1 1 0-4.2h.08a1.8 1.8 0 0 0 1.65-1.12 1.8 1.8 0 0 0-.36-2l-.05-.05a2.1 2.1 0 1 1 2.97-2.97l.05.05a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 9.5 1.9V2a2.1 2.1 0 1 1 4.2 0v.08a1.8 1.8 0 0 0 1.09 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 1 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 2c.28.69.94 1.13 1.67 1.13h.03a2.1 2.1 0 1 1 0 4.2h-.08A1.8 1.8 0 0 0 19.4 15Z" /></svg>
            <span className="label">{t("preferences.label")}</span>
          </button>
          {preferencesOpen ? (
            <div className="preferences-popover" role="dialog" aria-label={t("preferences.title")}>
              <div className="preferences-title">{t("preferences.title")}</div>
              <label className="preferences-field">
                <span>{t("preferences.language")}</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                  {languages.map((entry) => (
                    <option key={entry} value={entry}>{t(`language.${entry}`)}</option>
                  ))}
                </select>
              </label>
              <div className="preferences-field">
                <span>{t("preferences.theme")}</span>
                <div className="preferences-segmented">
                  {(["dark", "light", "auto"] as const).map((entry) => (
                    <button className={theme === entry ? "active" : ""} type="button" key={entry} onClick={() => onThemeChange(entry)}>
                      <span className={`preferences-option-icon theme-icon-${entry}`} aria-hidden="true">{entry === "dark" ? "☾" : entry === "light" ? "☀" : "◐"}</span>
                      <span>{entry === "dark" ? t("theme.dark") : entry === "light" ? t("theme.light") : t("theme.auto")}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="preferences-field">
                <span>{t("preferences.textSize")}</span>
                <div className="preferences-segmented">
                  {(["small", "normal", "large"] as const).map((entry) => (
                    <button className={`text-size-option text-size-option-${entry} ${textSize === entry ? "active" : ""}`} type="button" key={entry} onClick={() => onTextSizeChange(entry)}>
                      {entry === "small" ? t("textSize.small") : entry === "normal" ? t("textSize.normal") : t("textSize.large")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="preferences-field">
                <div className="toggle-row">
                  <span>{t("preferences.hideArchivedNoise")}</span>
                  <button
                    className={`toggle ${hideArchivedNoise ? "on" : ""}`}
                    role="switch"
                    aria-checked={hideArchivedNoise}
                    type="button"
                    onClick={() => onHideArchivedNoiseChange(!hideArchivedNoise)}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <button className="btn filters-toggle" aria-label={t("common.openFilters")} title={t("common.openFilters")} onClick={onOpenFilters}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          <span className="label">{t("common.filters")}</span>
        </button>
        <button className="btn primary" aria-label={t("common.refresh")} title={t("common.refresh")} disabled={loading} onClick={onRefresh}>
          <svg className={loading ? "spin" : ""} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          <span className="label">{loading ? t("common.loading") : t("common.refresh")}</span>
        </button>
        {canLogout ? (
          <button className="btn auth-btn" aria-label={t("common.signOut")} title={authLogin ? `${t("common.signedIn")} ${authLogin}` : t("common.signOut")} onClick={onLogout}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            <span className="label">{authLogin || t("common.signOut")}</span>
          </button>
        ) : (
          <span className="btn auth-btn" aria-label={t("common.signedIn")} title={authLogin ? `${t("common.signedIn")} ${authLogin}` : t("common.authenticatedExternally")} style={{ cursor: "default", opacity: 0.85 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            <span className="label">{authLogin || t("common.authenticated")}</span>
          </span>
        )}
      </div>
    </div>
  );
}
