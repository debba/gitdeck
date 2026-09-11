import { useI18n } from "../../i18n/I18nProvider";
import type { Language } from "../../utils/i18n";
import { AiIntegrationSettings } from "../preferences/AiIntegrationSettings";

type Theme = "dark" | "light" | "auto";
type TextSize = "small" | "normal" | "large";

interface PreferencesViewProps {
  theme: Theme;
  textSize: TextSize;
  hideArchivedNoise: boolean;
  onThemeChange: (theme: Theme) => void;
  onTextSizeChange: (textSize: TextSize) => void;
  onHideArchivedNoiseChange: (hideArchivedNoise: boolean) => void;
  onBack: () => void;
}

const PaletteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 0 18h.6a2.4 2.4 0 0 0 1.7-4.1 1.6 1.6 0 0 1 1.1-2.7H17a4 4 0 0 0 4-4A7.3 7.3 0 0 0 12 3Z" />
    <circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

/** Full-page preferences, reachable at `/preferences`. */
export function PreferencesView({
  theme,
  textSize,
  hideArchivedNoise,
  onThemeChange,
  onTextSizeChange,
  onHideArchivedNoiseChange,
  onBack,
}: PreferencesViewProps) {
  const { language, languages, setLanguage, t } = useI18n();

  return (
    <div className="preferences-page">
      <header className="preferences-page-head">
        <div>
          <h2>{t("preferences.title")}</h2>
          <p>{t("preferences.subtitle")}</p>
        </div>
        <button className="btn ghost" type="button" onClick={onBack}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></svg>
          {t("preferences.back")}
        </button>
      </header>

      <div className="preferences-body">
        <nav className="preferences-nav" aria-label={t("preferences.sections")}>
          <span className="preferences-nav-title">{t("preferences.sections")}</span>
          <a href="#preferences-appearance"><PaletteIcon />{t("preferences.appearance")}</a>
          <a href="#preferences-ai"><SparkIcon />{t("preferences.ai")}</a>
        </nav>

        <div className="preferences-content">
          <section className="preferences-card" id="preferences-appearance" aria-labelledby="preferences-appearance-title">
            <header className="preferences-card-head">
              <span className="preferences-card-icon"><PaletteIcon /></span>
              <div>
                <h3 id="preferences-appearance-title">{t("preferences.appearance")}</h3>
                <p>{t("preferences.appearanceHint")}</p>
              </div>
            </header>
            <div className="preferences-card-grid">
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
            </div>
            <div className="preferences-switch">
              <div>
                <strong>{t("preferences.hideArchivedNoise")}</strong>
                <small>{t("preferences.hideArchivedNoiseHint")}</small>
              </div>
              <button
                className={`toggle ${hideArchivedNoise ? "on" : ""}`}
                role="switch"
                aria-checked={hideArchivedNoise}
                aria-label={t("preferences.hideArchivedNoise")}
                type="button"
                onClick={() => onHideArchivedNoiseChange(!hideArchivedNoise)}
              />
            </div>
          </section>

          <section className="preferences-card" id="preferences-ai" aria-labelledby="preferences-ai-title">
            <header className="preferences-card-head">
              <span className="preferences-card-icon accent"><SparkIcon /></span>
              <div>
                <h3 id="preferences-ai-title">{t("preferences.ai")}</h3>
                <p>{t("preferences.ai.hint")}</p>
              </div>
            </header>
            <AiIntegrationSettings />
          </section>
        </div>
      </div>
    </div>
  );
}
