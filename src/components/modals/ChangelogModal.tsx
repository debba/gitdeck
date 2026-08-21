import { useMemo } from "react";
import changelogSource from "../../../CHANGELOG.md?raw";
import { parseChangelog } from "../../utils/changelog";
import { CloseIcon } from "../common/Icons";
import { APP_VERSION } from "../../version";
import { useI18n } from "../../i18n/I18nProvider";

interface ChangelogModalProps {
  onClose: () => void;
}

export function ChangelogModal({ onClose }: ChangelogModalProps) {
  const { t } = useI18n();
  const entries = useMemo(() => parseChangelog(changelogSource), []);

  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-icon repository">✦</span>
            <div style={{ minWidth: 0 }}>
              <div className="kind">{t("footer.changelog")}</div>
              <h3>v{APP_VERSION}</h3>
            </div>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="modal-body changelog-body">
          {entries.length === 0 ? (
            <div className="modal-empty">{t("changelog.empty")}</div>
          ) : null}
          {entries.map((entry) => (
            <article className="changelog-entry" key={entry.version}>
              <header className="changelog-version">
                <span className="changelog-version-tag">v{entry.version}</span>
                {entry.date ? <span className="changelog-version-date">{entry.date}</span> : null}
                {entry.url ? <a className="changelog-version-link" href={entry.url} target="_blank" rel="noreferrer">{t("changelog.compare")}</a> : null}
              </header>
              {entry.sections.map((section) => (
                <section className="changelog-section" key={section.title}>
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item, index) => (
                      <li key={index}>
                        {item.scope ? <strong className="changelog-scope">{item.scope}:</strong> : null}{" "}
                        {item.text}
                        {item.url ? <a className="changelog-commit" href={item.url} target="_blank" rel="noreferrer"> ↗</a> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
