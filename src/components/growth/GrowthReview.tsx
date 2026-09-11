import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchGrowthReview, refreshGrowthContentPerformance } from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import {
  GROWTH_UNASSIGNED_PILLAR_KEY,
  GROWTH_PERFORMANCE_WINDOWS,
  type GrowthContentPerformanceRefreshData,
  type GrowthPerformanceMetricTotals,
  type GrowthReviewContentItem,
  type GrowthReviewFinding,
  type GrowthReviewPublishedItem,
  type GrowthWeeklyReview,
} from "../../types/growth";
import { growthRepositoryPath } from "../../utils/growthRoutes";

interface GrowthReviewProps {
  accountId: string | null;
  enabled: boolean;
  repository?: string;
}

const metricLabels: Record<string, TranslationKey> = {
  starsDelta: "growth.reviewMetricStars",
  forksDelta: "growth.reviewMetricForks",
  closedPrsDelta: "growth.reviewMetricClosedPrs",
  releaseDownloadsDelta: "growth.reviewMetricDownloads",
};

export function GrowthReview({ accountId, enabled, repository }: GrowthReviewProps) {
  const { language, t } = useI18n();
  const [review, setReview] = useState<GrowthWeeklyReview | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshData, setRefreshData] = useState<GrowthContentPerformanceRefreshData | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const requestOwner = `${accountId ?? ""}:${repository ?? "*"}`;
  const requestOwnerRef = useRef(requestOwner);
  requestOwnerRef.current = requestOwner;

  useEffect(() => {
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    setReview(null);
    setError("");
    setRefreshError("");
    setRefreshData(null);
    setRefreshing(false);
    if (!enabled || !accountId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void fetchGrowthReview(repository ? { repository } : {}, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setReview(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && (reason as Error).name !== "AbortError") {
          setError((reason as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
    };
  }, [accountId, enabled, repository]);

  async function handleRefreshMeasurements() {
    if (!enabled || !accountId || refreshing || refreshControllerRef.current) return;
    const controller = new AbortController();
    const owner = requestOwner;
    refreshControllerRef.current = controller;
    setRefreshing(true);
    setRefreshError("");
    setRefreshData(null);

    try {
      const refreshed = await refreshGrowthContentPerformance(
        repository ? { repository } : {},
        controller.signal,
      );
      if (controller.signal.aborted || requestOwnerRef.current !== owner) return;
      const updatedReview = await fetchGrowthReview(
        repository ? { repository } : {},
        controller.signal,
      );
      if (controller.signal.aborted || requestOwnerRef.current !== owner) return;
      setRefreshData(refreshed);
      setReview(updatedReview);
    } catch (reason) {
      if (!controller.signal.aborted && (reason as Error).name !== "AbortError" && requestOwnerRef.current === owner) {
        setRefreshError((reason as Error).message);
      }
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
        setRefreshing(false);
      }
    }
  }

  if (loading) {
    return <section className="growth-review-state" aria-busy="true">{t("growth.reviewLoading")}</section>;
  }
  if (error) {
    return (
      <section className="growth-review-state growth-review-error" role="alert">
        {t("growth.reviewError", { message: error })}
      </section>
    );
  }
  if (!review) return null;

  const global = !repository;
  const measured = review.performance.windows.some(({ measuredItems }) => measuredItems > 0);
  const dateFormatter = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" });
  const dateTimeFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const range = `${dateFormatter.format(new Date(review.reviewPeriod.start))} – ${dateFormatter.format(new Date(review.reviewPeriod.end))}`;

  return (
    <section className="growth-review">
      <header className="growth-review-hero">
        <div>
          <span>{global ? t("growth.reviewGlobalEyebrow") : t("growth.reviewRepositoryEyebrow")}</span>
          <h1>{t("growth.reviewTitle")}</h1>
          <p>{global
            ? t("growth.reviewGlobalDescription")
            : t("growth.reviewRepositoryDescription", { repository: repository ?? "" })}</p>
        </div>
        <div className="growth-review-controls">
          <div className="growth-review-period">
            <span>{t("growth.reviewPeriod")}</span>
            <strong>{range}</strong>
            <small>{t("growth.reviewUtcNote")}</small>
          </div>
          <button
            className="btn primary"
            type="button"
            disabled={refreshing}
            onClick={() => void handleRefreshMeasurements()}
          >
            {refreshing ? t("growth.reviewRefreshing") : t("growth.reviewRefresh")}
          </button>
        </div>
      </header>

      {refreshError ? (
        <div className="growth-review-refresh-error" role="alert">
          {t("growth.reviewRefreshError", { message: refreshError })}
        </div>
      ) : null}

      {refreshData ? (
        <section className="growth-review-refresh-report" role="status">
          <header>
            <div>
              <strong>{t("growth.reviewRefreshComplete")}</strong>
              <span>{dateTimeFormatter.format(new Date(refreshData.refreshedAt))}</span>
            </div>
            <small>{t("growth.reviewRefreshNoEstimates")}</small>
          </header>
          <div className="growth-review-refresh-windows">
            {GROWTH_PERFORMANCE_WINDOWS.map((window) => {
              const measuredCount = refreshData.performance.filter((item) => item.window === window).length;
              const pending = refreshData.pending.filter((item) => item.window === window);
              return (
                <article key={window} tabIndex={0}>
                  <strong>{t("growth.reviewWindow", { window })}</strong>
                  <span>{t("growth.reviewRefreshReturned", { count: measuredCount })}</span>
                  <span>{t("growth.reviewRefreshPending", { count: pending.length })}</span>
                  {pending.length ? (
                    <ul>
                      {pending.map((item) => (
                        <li key={`${item.contentId}:${item.window}`}>
                          {t(`growth.reviewPendingReason.${item.reason}` as TranslationKey)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {review.usedFallback ? (
        <div className="growth-review-fallback" role="status">
          <strong>{t("growth.reviewFallbackTitle")}</strong>
          <span>{review.aiEnabled ? t("growth.reviewFallbackError") : t("growth.reviewFallbackDisabled")}</span>
        </div>
      ) : null}

      {review.empty ? (
        <section className="growth-review-empty">
          <span>{t("growth.reviewEmptyEyebrow")}</span>
          <h2>{t("growth.reviewEmptyTitle")}</h2>
          <p>{t("growth.reviewEmptyDescription")}</p>
        </section>
      ) : null}

      <section className="growth-review-narrative" tabIndex={0}>
        <span>{t("growth.reviewNarrativeEyebrow")}</span>
        <h2>{t("growth.reviewNarrativeTitle")}</h2>
        <p>{review.narrative}</p>
      </section>

      <section className="growth-review-section">
        <header><div><span>{t("growth.reviewResultsEyebrow")}</span><h2>{t("growth.reviewResultsTitle")}</h2></div></header>
        {measured ? (
          <div className="growth-review-performance-grid">
            {review.performance.windows.map((window) => (
              <article key={window.window} tabIndex={0}>
                <div className="growth-review-card-heading">
                  <strong>{t("growth.reviewWindow", { window: window.window })}</strong>
                  <span>{t("growth.reviewMeasuredItems", { count: window.measuredItems })}</span>
                </div>
                <MetricList metrics={window.metrics} />
              </article>
            ))}
          </div>
        ) : <p className="growth-review-section-empty">{t("growth.reviewNoMeasurements")}</p>}
      </section>

      {measured ? (
        <section className="growth-review-section">
          <header><div><span>{t("growth.reviewFindingsEyebrow")}</span><h2>{t("growth.reviewFindingsTitle")}</h2></div></header>
          <div className="growth-review-findings">
            <FindingList title={t("growth.reviewChannelFindings")} findings={review.channelFindings} />
            <FindingList title={t("growth.reviewPillarFindings")} findings={review.pillarFindings} />
          </div>
        </section>
      ) : null}

      <div className="growth-review-lists">
        <ReviewItemSection
          title={t("growth.reviewPublishedTitle")}
          eyebrow={t("growth.reviewPublishedEyebrow")}
          empty={t("growth.reviewPublishedEmpty")}
          items={review.publishedItems}
          global={global}
          dateTimeFormatter={dateTimeFormatter}
          dateField="publishedAt"
        />
        <ReviewItemSection
          title={t("growth.reviewMissedTitle")}
          eyebrow={t("growth.reviewMissedEyebrow")}
          empty={t("growth.reviewMissedEmpty")}
          items={review.missedItems}
          global={global}
          dateTimeFormatter={dateTimeFormatter}
          dateField="scheduledFor"
        />
        <ReviewItemSection
          title={t("growth.reviewUpcomingTitle")}
          eyebrow={t("growth.reviewUpcomingEyebrow")}
          empty={t("growth.reviewUpcomingEmpty")}
          items={review.upcomingItems}
          global={global}
          dateTimeFormatter={dateTimeFormatter}
          dateField="scheduledFor"
        />
      </div>

      <section className="growth-review-section growth-review-recommendations">
        <header><div><span>{t("growth.reviewActionsEyebrow")}</span><h2>{t("growth.reviewActionsTitle")}</h2></div></header>
        <ol>
          {review.recommendations.map((item) => (
            <li key={item.id} tabIndex={0}>
              <div>
                <strong>{item.title}</strong>
                {global && item.repository ? <RepositoryChip repository={item.repository} /> : null}
              </div>
              <p>{item.action}</p>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

function MetricList({ metrics }: { metrics: GrowthPerformanceMetricTotals }) {
  const { language, t } = useI18n();
  return (
    <dl className="growth-review-metrics">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key}>
          <dt>{metricLabels[key] ? t(metricLabels[key]) : key}</dt>
          <dd className={value > 0 ? "positive" : value < 0 ? "negative" : ""}>
            {value > 0 ? "+" : ""}{new Intl.NumberFormat(language).format(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FindingList({ title, findings }: { title: string; findings: GrowthReviewFinding[] }) {
  const { t } = useI18n();
  return (
    <section>
      <h3>{title}</h3>
      {findings.length ? findings.map((item) => {
        const channelKey = `growth.channel.${item.key}` as TranslationKey;
        const key = item.dimension === "channel"
          ? t(channelKey)
          : item.key === GROWTH_UNASSIGNED_PILLAR_KEY ? t("growth.reviewUnassignedPillar") : item.key;
        return (
          <article key={`${item.dimension}:${item.window}`} tabIndex={0}>
            <div><strong>{key}</strong><span>{item.window}</span></div>
            <p>{t(`growth.reviewFinding.${item.direction}` as TranslationKey, {
              count: item.measuredItems,
            })}</p>
          </article>
        );
      }) : <p className="growth-review-section-empty">{t("growth.reviewFindingsEmpty")}</p>}
    </section>
  );
}

function ReviewItemSection({
  title,
  eyebrow,
  empty,
  items,
  global,
  dateTimeFormatter,
  dateField,
}: {
  title: string;
  eyebrow: string;
  empty: string;
  items: Array<GrowthReviewContentItem | GrowthReviewPublishedItem>;
  global: boolean;
  dateTimeFormatter: Intl.DateTimeFormat;
  dateField: "scheduledFor" | "publishedAt";
}) {
  const { t } = useI18n();
  return (
    <section className="growth-review-section growth-review-item-section">
      <header><div><span>{eyebrow}</span><h2>{title}</h2></div><strong>{items.length}</strong></header>
      {items.length ? (
        <div className="growth-review-item-list">
          {items.map((item) => {
            const date = item[dateField];
            const workspacePath = growthRepositoryPath(item.repository) ?? "/growth";
            return (
              <article key={item.id} tabIndex={0}>
                <div className="growth-review-item-heading">
                  <strong>{item.title}</strong>
                  {global ? <RepositoryChip repository={item.repository} /> : null}
                </div>
                <div className="growth-review-item-meta">
                  <span>{t(`growth.channel.${item.channel}` as TranslationKey)}</span>
                  {item.pillar ? <span>{item.pillar}</span> : null}
                  {date ? <time dateTime={date}>{dateTimeFormatter.format(new Date(date))}</time> : null}
                </div>
                <div className="growth-review-item-links">
                  <Link to={`${workspacePath}/calendar`}>{t("growth.reviewOpenCalendar")}</Link>
                  {item.publishedUrl ? (
                    <a href={item.publishedUrl} target="_blank" rel="noopener noreferrer">
                      {t("growth.reviewOpenPublished")}
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="growth-review-section-empty">{empty}</p>}
    </section>
  );
}

function RepositoryChip({ repository }: { repository: string }) {
  return <span className="growth-review-repository-chip">{repository}</span>;
}
