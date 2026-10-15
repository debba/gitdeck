import { APP_VERSION } from "../version";
import { useI18n } from "../i18n/I18nProvider";

interface FooterProps {
  onContributorsClick: () => void;
  onChangelogClick: () => void;
}

export function Footer({ onContributorsClick, onChangelogClick }: FooterProps) {
  const { t } = useI18n();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <span className="app-footer-credit">
          {t("footer.craftedBy")}{" "}
          <a href="https://github.com/debba" target="_blank" rel="noreferrer">debba</a>
          <span className="app-footer-sep">·</span>
          <span className="app-footer-version">v{APP_VERSION}</span>
        </span>
        <div className="app-footer-links">
          <a className="app-footer-link" href="https://github.com/debba/gitdeck" target="_blank" rel="noreferrer" aria-label="GitHub">
            <GithubIcon />
            <span>GitHub</span>
          </a>
          <a className="app-footer-link" href="https://discord.gg/YrZPHAwMSG" target="_blank" rel="noreferrer" aria-label="Discord">
            <DiscordIcon />
            <span>Discord</span>
          </a>
          <button className="app-footer-link" type="button" onClick={onContributorsClick}>
            <UsersIcon />
            <span>{t("footer.contributors")}</span>
          </button>
          <button className="app-footer-link" type="button" onClick={onChangelogClick}>
            <ChangelogIcon />
            <span>{t("footer.changelog")}</span>
          </button>
        </div>
      </div>
    </footer>
  );
}

function GithubIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.7.08-.7 1.18.08 1.8 1.21 1.8 1.21 1.05 1.79 2.75 1.27 3.42.97.1-.76.41-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.49.12-3.1 0 0 .98-.31 3.21 1.18.93-.26 1.93-.39 2.92-.39s1.99.13 2.92.39c2.23-1.49 3.21-1.18 3.21-1.18.64 1.61.24 2.8.12 3.1.75.81 1.2 1.84 1.2 3.1 0 4.43-2.7 5.4-5.27 5.69.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.32 4.37a19.79 19.79 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.25a18.27 18.27 0 0 0-5.49 0c-.16-.39-.4-.87-.62-1.25a.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.62 9.05-.37 13.58.12 18.06a.08.08 0 0 0 .03.06 19.92 19.92 0 0 0 6 3.04.08.08 0 0 0 .09-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.05-.11 13.16 13.16 0 0 1-1.87-.89.08.08 0 0 1-.01-.13c.13-.1.25-.2.37-.3a.08.08 0 0 1 .08-.01 14.21 14.21 0 0 0 12.06 0 .08.08 0 0 1 .08.01c.12.1.24.2.37.3a.08.08 0 0 1-.01.13 12.4 12.4 0 0 1-1.87.89.08.08 0 0 0-.05.11c.37.7.78 1.37 1.23 2a.08.08 0 0 0 .09.03 19.86 19.86 0 0 0 6.01-3.04.08.08 0 0 0 .03-.06c.58-5.17-.97-9.66-4.11-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.41 0-1.33.96-2.41 2.16-2.41 1.21 0 2.18 1.09 2.16 2.41 0 1.33-.96 2.41-2.16 2.41Zm7.97 0c-1.18 0-2.16-1.08-2.16-2.41 0-1.33.96-2.41 2.16-2.41 1.21 0 2.18 1.09 2.16 2.41 0 1.33-.95 2.41-2.16 2.41Z" />
    </svg>
  );
}

function ChangelogIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1={9} y1={13} x2={15} y2={13} />
      <line x1={9} y1={17} x2={15} y2={17} />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx={9} cy={7} r={4} />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
