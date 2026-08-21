import { useEffect, useState } from "react";
import { CloseIcon } from "../common/Icons";
import { formatNumber } from "../../utils/format";
import { useI18n } from "../../i18n/I18nProvider";

interface ContributorsModalProps {
  onClose: () => void;
}

interface Contributor {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
}

const REPO = "debba/gh-dashboard";

export function ContributorsModal({ onClose }: ContributorsModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [contributors, setContributors] = useState<Contributor[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=100`);
        if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
        const data = (await response.json()) as Contributor[];
        if (!cancelled) setContributors(data.filter((c) => c.type !== "Bot"));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-icon repository">★</span>
            <div style={{ minWidth: 0 }}>
              <div className="kind">{t("footer.contributors")}</div>
              <h3>{REPO}</h3>
            </div>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="modal-toolbar">
          <span className="modal-count">
            <strong>{loading ? t("common.loading") : formatNumber(contributors.length)}</strong> {t("common.people")}
          </span>
          <div className="spacer" style={{ flex: 1 }} />
          <a className="modal-count" href={`https://github.com/${REPO}/graphs/contributors`} target="_blank" rel="noreferrer">
            {t("common.viewOnGitHub")} →
          </a>
        </div>
        <div className={`modal-body ${loading ? "loading" : ""}`}>
          {error ? <div className="modal-error">{error}</div> : null}
          {!error && contributors.map((contributor) => (
            <div className="sg-row" key={contributor.login}>
              <img src={contributor.avatar_url} alt="" />
              <a className="login" href={contributor.html_url} target="_blank" rel="noreferrer">{contributor.login}</a>
              <span className="when">{formatNumber(contributor.contributions)} {t("common.commits")}</span>
            </div>
          ))}
          {!error && !loading && !contributors.length ? <div className="modal-empty">{t("contributors.empty")}</div> : null}
        </div>
      </div>
    </div>
  );
}
