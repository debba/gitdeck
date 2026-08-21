import { useEffect, useState } from "react";
import { fetchForks, fetchStargazers } from "../../api/github";
import type { ForkNode, StargazerNode } from "../../types/github";
import { formatExactNumber, formatNumber, formatRelativeTime } from "../../utils/format";
import { CloseIcon, ForkIcon, StarIcon } from "../common/Icons";
import { useI18n } from "../../i18n/I18nProvider";

export type MetricKind = "stars" | "forks";

interface RepositoryMetricModalProps {
  kind: MetricKind;
  repo: string;
  totalCount?: number;
  onClose: () => void;
}

export function RepositoryMetricModal({ kind, repo, totalCount, onClose }: RepositoryMetricModalProps) {
  const { t } = useI18n();
  const [direction, setDirection] = useState<"ASC" | "DESC">("DESC");
  const [forkField, setForkField] = useState("PUSHED_AT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  const [stargazers, setStargazers] = useState<StargazerNode[]>([]);
  const [forks, setForks] = useState<ForkNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setTotal(null);
      try {
        if (kind === "stars") {
          const result = await fetchStargazers({ repo, direction });
          if (!cancelled) {
            setTotal(result.totalCount);
            setStargazers(result.edges);
          }
        } else {
          const result = await fetchForks({ repo, direction, field: forkField });
          if (!cancelled) {
            setTotal(result.totalCount);
            setForks(result.nodes);
          }
        }
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
  }, [kind, repo, direction, forkField]);

  const displayedTotal = total ?? totalCount;

  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="modal-title">
            <span className={`modal-icon ${kind}`}>{kind === "stars" ? <StarIcon /> : <ForkIcon />}</span>
            <div style={{ minWidth: 0 }}>
              <div className="kind">{kind === "stars" ? t("metric.stars") : t("metric.forks")}</div>
              <h3>{repo}</h3>
            </div>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="modal-toolbar">
          <span className="modal-count"><strong>{displayedTotal === undefined ? t("common.loading") : formatExactNumber(displayedTotal)}</strong> {t("common.total")}</span>
          <div className="spacer" style={{ flex: 1 }} />
          {kind === "forks" ? (
            <select value={forkField} onChange={(event) => setForkField(event.target.value)}>
              <option value="PUSHED_AT">{t("metric.recentlyPushed")}</option>
              <option value="UPDATED_AT">{t("metric.recentlyUpdated")}</option>
              <option value="CREATED_AT">{t("metric.newest")}</option>
              <option value="STARGAZERS">{t("metric.mostStars")}</option>
              <option value="NAME">{t("common.name")}</option>
            </select>
          ) : null}
          <select value={direction} onChange={(event) => setDirection(event.target.value as "ASC" | "DESC")}>
            <option value="DESC">{t("common.descending")}</option>
            <option value="ASC">{t("common.ascending")}</option>
          </select>
        </div>
        <div className={`modal-body ${loading ? "loading" : ""}`}>
          {error ? <div className="modal-error">{error}</div> : null}
          {!error && kind === "stars" && stargazers.map((edge) => (
            <div className="sg-row" key={`${edge.node.login}-${edge.starredAt}`}>
              <img src={edge.node.avatarUrl} alt="" />
              <a className="login" href={edge.node.url} target="_blank" rel="noreferrer">{edge.node.login}</a>
              <span className="when" title={new Date(edge.starredAt).toLocaleString()}>{formatRelativeTime(edge.starredAt)}</span>
            </div>
          ))}
          {!error && kind === "forks" && forks.map((fork) => (
            <div className="fork-row" key={fork.nameWithOwner}>
              <img src={fork.owner.avatarUrl} alt="" />
              <div>
                <div className="fr-title"><a href={fork.url} target="_blank" rel="noreferrer">{fork.nameWithOwner}</a></div>
                <div className="fr-desc">{fork.description || t("repo.noDescription")}</div>
              </div>
              <div className="fr-meta"><span className="mini-stat">★ {formatNumber(fork.stargazerCount)}</span><span>{formatRelativeTime(fork.pushedAt)}</span></div>
            </div>
          ))}
          {!error && !loading && ((kind === "stars" && !stargazers.length) || (kind === "forks" && !forks.length)) ? <div className="modal-empty">{t("metric.noResults")}</div> : null}
        </div>
      </div>
    </div>
  );
}
