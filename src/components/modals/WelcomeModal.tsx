import { CloseIcon } from "../common/Icons";
import { APP_VERSION } from "../../version";
import { useI18n } from "../../i18n/I18nProvider";

interface WelcomeModalProps {
  onClose: () => void;
  onViewChangelog: () => void;
}

export function WelcomeModal({ onClose, onViewChangelog }: WelcomeModalProps) {
  const { t } = useI18n();
  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal welcome-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-icon welcome">✦</span>
            <div style={{ minWidth: 0 }}>
              <div className="kind">{t("welcome.kind")}</div>
              <h3>{t("app.title")}</h3>
            </div>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="modal-body welcome-body">
          <p className="welcome-lead">
            {t("welcome.lead")}
          </p>
          <ul className="welcome-list">
            <li><strong>{t("welcome.repositoriesTitle")}</strong> - {t("welcome.repositoriesText")}</li>
            <li><strong>{t("welcome.inboxTitle")}</strong> - {t("welcome.inboxText")}</li>
            <li><strong>{t("welcome.insightsTitle")}</strong> - {t("welcome.insightsText")}</li>
            <li><strong>{t("welcome.localTitle")}</strong> - {t("welcome.localText")}</li>
          </ul>
          <div className="welcome-meta">{t("welcome.version", { version: APP_VERSION })}</div>
        </div>
        <footer className="welcome-foot">
          <button type="button" className="btn ghost" onClick={onViewChangelog}>{t("welcome.whatsNew")}</button>
          <button type="button" className="btn primary" onClick={onClose}>{t("welcome.getStarted")}</button>
        </footer>
      </div>
    </div>
  );
}
