import type { DailyDigestEntry, DigestPeriod } from "../../types/github";
import { buildDailyDigestMarkdown } from "../../utils/digests";
import { formatNumber } from "../../utils/format";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

interface DailyDigestViewProps {
  digests: DailyDigestEntry[];
  period: DigestPeriod;
  onPeriodChange: (period: DigestPeriod) => void;
}

const PERIOD_LABEL_KEYS: Record<DigestPeriod, TranslationKey> = {
  day: "digest.daily",
  week: "digest.weekly",
  month: "digest.monthly",
};

const PERIOD_DELTA_LABEL_KEYS: Record<DigestPeriod, TranslationKey> = {
  day: "digest.vsPreviousDay",
  week: "digest.vsPreviousWeek",
  month: "digest.vsPreviousMonth",
};

function formatDigestDate(date: string, period: DigestPeriod, t: (key: TranslationKey, replacements?: Record<string, string | number>) => string): string {
  const d = new Date(`${date}T00:00:00`);
  if (period === "month") {
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (period === "week") {
    const start = new Date(d);
    start.setDate(d.getDate() - 6);
    const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return t("digest.weekOf", { from: start.toLocaleDateString(undefined, fmt), to: d.toLocaleDateString(undefined, fmt) });
  }
  return d.toLocaleDateString();
}

export function DailyDigestView({ digests, period, onPeriodChange }: DailyDigestViewProps) {
  const { t } = useI18n();
  async function copyDigest(digest: DailyDigestEntry) {
    await navigator.clipboard.writeText(buildDailyDigestMarkdown(digest));
  }

  return (
    <div className="digest-wrapper">
      <div className="digest-period-toolbar">
        <div className="digest-period-tabs" role="tablist" aria-label={t("digest.periodLabel")}>
          {(["day", "week", "month"] as DigestPeriod[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={period === value}
              className={`digest-period-tab${period === value ? " active" : ""}`}
              onClick={() => onPeriodChange(value)}
            >
              {t(PERIOD_LABEL_KEYS[value])}
            </button>
          ))}
        </div>
        <span className="digest-period-hint">{t(PERIOD_DELTA_LABEL_KEYS[period])}</span>
      </div>
      {!digests.length ? (
        <div className="empty">
          <div className="big">{t("digest.empty", { period: t(PERIOD_LABEL_KEYS[period]).toLowerCase() })}</div>
          <div>{t("digest.emptyText")}</div>
        </div>
      ) : (
    <div className="digest-list">
      {digests.map((digest) => (
        <article className="digest-card" key={digest.date}>
          <div className="digest-head">
            <div>
              <strong>{formatDigestDate(digest.date, period, t)}</strong>
              <span>{t("digest.reposTracked", { count: formatNumber(digest.repoCount) })}</span>
            </div>
            <div className="digest-badges">
              <span>★ {digest.starsDelta >= 0 ? "+" : ""}{formatNumber(digest.starsDelta)}</span>
              <span>{t("digest.forksDelta", { value: `${digest.forksDelta >= 0 ? "+" : ""}${formatNumber(digest.forksDelta)}` })}</span>
              <span>{t("digest.issuesDelta", { value: `${digest.issueDelta >= 0 ? "+" : ""}${formatNumber(digest.issueDelta)}` })}</span>
              <span>{t("digest.securityAlerts", { count: formatNumber(digest.securityAlertsCount) })}</span>
              <span>{t("digest.securityRepos", { count: formatNumber(digest.securityReposCount) })}</span>
              <button type="button" className="digest-copy-btn" onClick={() => void copyDigest(digest)}>{t("digest.copyMarkdown")}</button>
            </div>
          </div>
          {digest.securityAlertsUnavailable ? (
            <div className="modal-info-banner">
              {t("digest.securityUnavailable")}
            </div>
          ) : null}
          {digest.ai ? (
            <div className="digest-ai-block">
              <div className="digest-ai-head">
                <strong>{digest.ai.headline}</strong>
                <span>{digest.ai.model}</span>
              </div>
              <div className="digest-ai-briefing">
                {digest.ai.briefing.map((item) => <p key={item}>{item}</p>)}
              </div>
            </div>
          ) : null}
          <div className="digest-pill-groups">
            <div className="digest-pill-group">
              <h4>{t("digest.executiveSummary")}</h4>
              {digest.executiveSummary.map((item) => <span key={item}>{item}</span>)}
            </div>
            {digest.momentum.length ? (
              <div className="digest-pill-group positive">
                <h4>{t("digest.momentum")}</h4>
                {digest.momentum.map((item) => <span key={item}>{item}</span>)}
              </div>
            ) : null}
            {digest.risks.length ? (
              <div className="digest-pill-group risk">
                <h4>{t("digest.risks")}</h4>
                {digest.risks.map((item) => <span key={item}>{item}</span>)}
              </div>
            ) : null}
          </div>
          <div className="digest-summary">
            {digest.highlights.map((item) => <p key={item}>{item}</p>)}
          </div>
          <div className="digest-repo-list">
            {digest.repos.map((repo) => (
              <div className="digest-repo-row" key={`${digest.date}-${repo.repo}`}>
                <strong>{repo.repo}</strong>
                <span>★ {repo.starsDelta >= 0 ? "+" : ""}{formatNumber(repo.starsDelta)}</span>
                <span>{t("digest.forksDelta", { value: `${repo.forksDelta >= 0 ? "+" : ""}${formatNumber(repo.forksDelta)}` })}</span>
                <em>{t("digest.issuesDelta", { value: `${repo.issueDelta >= 0 ? "+" : ""}${formatNumber(repo.issueDelta)}` })}</em>
                <em>{t("digest.securityAlerts", { count: formatNumber(repo.securityAlertsCount) })}</em>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
      )}
    </div>
  );
}
