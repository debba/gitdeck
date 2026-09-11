import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAiSettings } from "../../api/github";
import {
  createGrowthIntervention,
  draftGrowthContentFromIntervention,
  fetchGrowthContentItems,
  fetchGrowthInterventions,
  generateGrowthInterventions,
  patchGrowthIntervention,
  recycleGrowthIntervention,
  scanGrowthOpportunities,
} from "../../api/growth";
import { useGoals } from "../../hooks/useGoals";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import {
  GROWTH_INTERVENTION_STATUSES,
  type GrowthContentItem,
  type GrowthIntervention,
  type GrowthInterventionCategory,
  type GrowthInterventionOrigin,
  type GrowthInterventionStatus,
} from "../../types/growth";
import { GOAL_METRIC_DEFINITIONS, type GoalMetric } from "../../types/goals";
import { formatNumber } from "../../utils/format";
import {
  contentIdFromEvergreenRuleKey,
  isEvergreenContentEligible,
} from "../../utils/growth/evergreen";
import { ContentItemDrawer } from "./ContentItemDrawer";
import { GrowthInterventionCreateModal } from "./GrowthInterventionCreateModal";

interface GrowthInterventionsProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
}

const CATEGORIES: GrowthInterventionCategory[] = ["product", "community", "engineering", "marketing"];
const ORIGINS: GrowthInterventionOrigin[] = ["ai", "rule", "manual"];
const metricLabels = new Map<GoalMetric, string>(GOAL_METRIC_DEFINITIONS.map((metric) => [metric.id, metric.label]));
const statusKeys: Record<GrowthInterventionStatus, TranslationKey> = {
  proposed: "growth.status.proposed",
  accepted: "growth.status.accepted",
  dismissed: "growth.status.dismissed",
  done: "growth.status.done",
};
const categoryKeys: Record<GrowthInterventionCategory, TranslationKey> = {
  product: "growth.interventionsCategory.product",
  community: "growth.interventionsCategory.community",
  engineering: "growth.interventionsCategory.engineering",
  marketing: "growth.interventionsCategory.marketing",
};
const originKeys: Record<GrowthInterventionOrigin, TranslationKey> = {
  ai: "growth.interventionsOrigin.ai",
  rule: "growth.interventionsOrigin.rule",
  manual: "growth.interventionsOrigin.manual",
};

type OpportunityScanState = "idle" | "scanning" | "empty" | "success" | "error";
type RecycleFeedback = { kind: "success" | "duplicate" | "error"; message: string };

function opportunityKindKey(ruleKey: string | null): TranslationKey {
  if (ruleKey?.startsWith("release:")) return "growth.opportunityKind.release";
  if (ruleKey?.startsWith("star-milestone:")) return "growth.opportunityKind.starMilestone";
  if (ruleKey?.startsWith("good-first-issue:")) return "growth.opportunityKind.goodFirstIssue";
  if (ruleKey?.startsWith("merged-pr:")) return "growth.opportunityKind.mergedPullRequest";
  if (ruleKey?.startsWith("goal-pace:")) return "growth.opportunityKind.goalPace";
  if (ruleKey?.startsWith("evergreen:")) return "growth.opportunityKind.evergreen";
  return "growth.opportunityKind.detected";
}

export function GrowthInterventions({ accountId, enabled, repository }: GrowthInterventionsProps) {
  const { t } = useI18n();
  const { goals } = useGoals({ accountId, enabled, repository });
  const [interventions, setInterventions] = useState<GrowthIntervention[]>([]);
  const [contentItems, setContentItems] = useState<GrowthContentItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | GrowthInterventionCategory>("all");
  const [originFilter, setOriginFilter] = useState<"all" | GrowthInterventionOrigin>("all");
  const [generationGoalId, setGenerationGoalId] = useState("");
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [selectedContentItem, setSelectedContentItem] = useState<GrowthContentItem | null>(null);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [recycleFeedback, setRecycleFeedback] = useState<Record<string, RecycleFeedback>>({});
  const [scanState, setScanState] = useState<OpportunityScanState>("idle");
  const [scanCount, setScanCount] = useState(0);
  const [scanError, setScanError] = useState("");
  const scanControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !accountId || !repository) return;
    setLoading(true);
    setError("");
    try {
      const [nextInterventions, nextContentItems] = await Promise.all([
        fetchGrowthInterventions({ repository }, signal),
        fetchGrowthContentItems({ repository }, signal),
      ]);
      if (signal?.aborted) return;
      setInterventions(nextInterventions);
      setContentItems(nextContentItems);
    } catch (cause) {
      if (!signal?.aborted && (cause as Error).name !== "AbortError") setError((cause as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [accountId, enabled, repository]);

  useEffect(() => {
    setAiEnabled(null);
    if (!enabled) return;
    let current = true;
    void fetchAiSettings()
      .then(({ settings }) => {
        if (current) setAiEnabled(settings.enabled);
      })
      .catch(() => {
        // Generation still has a deterministic fallback when settings cannot be read.
      });
    return () => {
      current = false;
    };
  }, [accountId, enabled]);

  useEffect(() => {
    scanControllerRef.current?.abort();
    scanControllerRef.current = null;
    setInterventions([]);
    setContentItems([]);
    setNotice("");
    setManualModalOpen(false);
    setDismissedOpen(false);
    setSelectedContentItem(null);
    setDraftErrors({});
    setRecycleFeedback({});
    setScanState("idle");
    setScanCount(0);
    setScanError("");
    if (!enabled || !accountId || !repository) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      scanControllerRef.current?.abort();
    };
  }, [accountId, enabled, load, repository]);

  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);
  const contentByIntervention = useMemo(() => {
    const grouped = new Map<string, GrowthContentItem[]>();
    for (const item of contentItems) {
      if (!item.interventionId) continue;
      grouped.set(item.interventionId, [...(grouped.get(item.interventionId) ?? []), item]);
    }
    return grouped;
  }, [contentItems]);
  const filtered = useMemo(() => interventions.filter((intervention) => (
    (categoryFilter === "all" || intervention.category === categoryFilter)
    && (originFilter === "all" || intervention.origin === originFilter)
  )), [categoryFilter, interventions, originFilter]);

  async function changeStatus(intervention: GrowthIntervention, status: GrowthInterventionStatus) {
    setBusy(intervention.id);
    setError("");
    setNotice("");
    try {
      const updated = await patchGrowthIntervention(intervention.id, { status });
      setInterventions((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    setBusy("generate");
    setError("");
    setNotice("");
    try {
      const result = await generateGrowthInterventions(repository, generationGoalId || undefined);
      await load();
      setAiEnabled(result.aiEnabled);
      setNotice(result.aiEnabled
        ? t("growth.interventionsGenerated", { count: result.interventions.length })
        : t("growth.interventionsGeneratedFallback", { count: result.interventions.length }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function scanOpportunities() {
    if (!accountId || !enabled || !repository || scanControllerRef.current || scanState === "scanning" || busy !== "") return;
    const requestAccountId = accountId;
    const requestRepository = repository;
    const controller = new AbortController();
    scanControllerRef.current = controller;
    setScanState("scanning");
    setScanCount(0);
    setScanError("");
    setError("");
    setNotice("");
    try {
      const result = await scanGrowthOpportunities(requestRepository, controller.signal);
      if (controller.signal.aborted) return;
      const ownedInterventions = result.interventions.filter((intervention) => (
        intervention.accountId === requestAccountId && intervention.repository === requestRepository
      ));
      setInterventions((current) => {
        const returnedIds = new Set(ownedInterventions.map((intervention) => intervention.id));
        return [...current.filter((intervention) => !returnedIds.has(intervention.id)), ...ownedInterventions];
      });
      setScanCount(ownedInterventions.length);
      await load(controller.signal);
      if (!controller.signal.aborted) setScanState(ownedInterventions.length ? "success" : "empty");
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setScanError((cause as Error).message);
        setScanState("error");
      }
    } finally {
      if (scanControllerRef.current === controller) scanControllerRef.current = null;
    }
  }

  async function draftFromIntervention(intervention: GrowthIntervention) {
    setBusy(`draft-${intervention.id}`);
    setError("");
    setNotice("");
    setDraftErrors((current) => ({ ...current, [intervention.id]: "" }));
    try {
      const result = await draftGrowthContentFromIntervention(intervention.id);
      setContentItems((current) => {
        const returnedIds = new Set(result.contentItems.map((item) => item.id));
        return [...current.filter((item) => !returnedIds.has(item.id)), ...result.contentItems];
      });
      if (result.contentItems[0]) setSelectedContentItem(result.contentItems[0]);
    } catch (cause) {
      setDraftErrors((current) => ({ ...current, [intervention.id]: (cause as Error).message }));
    } finally {
      setBusy("");
    }
  }

  async function recycleIntervention(intervention: GrowthIntervention) {
    const action = `recycle-${intervention.id}`;
    setBusy(action);
    setError("");
    setNotice("");
    setRecycleFeedback((current) => {
      const next = { ...current };
      delete next[intervention.id];
      return next;
    });
    try {
      const result = await recycleGrowthIntervention(intervention.id);
      if (
        result.contentItem.accountId !== accountId
        || result.contentItem.repository !== repository
        || result.contentItem.interventionId !== intervention.id
      ) throw new Error("Invalid recycled content response.");
      setContentItems((current) => {
        const exists = current.some((item) => item.id === result.contentItem.id);
        return exists
          ? current.map((item) => item.id === result.contentItem.id ? result.contentItem : item)
          : [...current, result.contentItem];
      });
      setRecycleFeedback((current) => ({
        ...current,
        [intervention.id]: {
          kind: result.duplicate ? "duplicate" : "success",
          message: t(result.duplicate ? "growth.evergreenRecycleDuplicate" : "growth.evergreenRecycleSuccess"),
        },
      }));
    } catch (cause) {
      setRecycleFeedback((current) => ({
        ...current,
        [intervention.id]: {
          kind: "error",
          message: t("growth.evergreenRecycleError", { message: (cause as Error).message }),
        },
      }));
    } finally {
      setBusy("");
    }
  }

  function updateContentItem(updated: GrowthContentItem) {
    setContentItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedContentItem(updated);
  }

  async function createManual(input: { category: GrowthInterventionCategory; title: string; action: string }) {
    setBusy("manual");
    setError("");
    setNotice("");
    try {
      await createGrowthIntervention({ repository, ...input });
      await load();
    } finally {
      setBusy("");
    }
  }

  function renderIntervention(intervention: GrowthIntervention) {
    const linkedGoal = intervention.goalId ? goalsById.get(intervention.goalId) : null;
    const linkedContent = contentByIntervention.get(intervention.id) ?? [];
    const evergreenSourceId = intervention.origin === "rule"
      ? contentIdFromEvergreenRuleKey(intervention.ruleKey)
      : null;
    const evergreenSource = evergreenSourceId
      ? contentItems.find((item) => item.id === evergreenSourceId)
      : undefined;
    const canRecycle = evergreenSource !== undefined
      && isEvergreenContentEligible(evergreenSource, new Date());
    const feedback = recycleFeedback[intervention.id];
    return (
      <article className="growth-intervention-card" key={intervention.id}>
        <div className="growth-intervention-card-head">
          <div className="growth-intervention-badges">
            <span className={`growth-intervention-category category-${intervention.category}`}>{t(categoryKeys[intervention.category])}</span>
            <span className="growth-intervention-origin">{t(originKeys[intervention.origin])}</span>
            {intervention.origin === "rule" ? (
              <span className="growth-intervention-kind">{t(opportunityKindKey(intervention.ruleKey))}</span>
            ) : null}
          </div>
          {linkedGoal ? (
            <span className="growth-intervention-goal">
              {t("growth.interventionsLinkedMission", {
                mission: `${metricLabels.get(linkedGoal.metric) ?? linkedGoal.metric} ${formatNumber(linkedGoal.currentValue)} / ${formatNumber(linkedGoal.targetValue)}`,
              })}
            </span>
          ) : null}
        </div>
        <h3>{intervention.title}</h3>
        <p>{intervention.action}</p>
        {linkedContent.length ? (
          <div className="growth-intervention-content">
            <strong>{t("growth.interventionsContentItems", { count: linkedContent.length })}</strong>
            <ul>
              {linkedContent.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => setSelectedContentItem(item)}>
                    <span>{item.title || item.format}</span>
                    <small>{t(`growth.status.${item.status}` as TranslationKey)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {draftErrors[intervention.id] ? (
          <p className="growth-intervention-draft-error" role="alert">
            {t("growth.contentDraftError", { message: draftErrors[intervention.id] })}
            {/not configured/i.test(draftErrors[intervention.id]) ? <> <a href="/preferences#preferences-ai" target="_blank" rel="noopener">{t("growth.interventionsOpenPreferences")}</a></> : null}
          </p>
        ) : null}
        {feedback ? (
          <p className={`growth-intervention-recycle-feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
            {feedback.message}
          </p>
        ) : null}
        <div className="growth-intervention-actions">
          <button className="btn" type="button" disabled={busy !== "" || scanState === "scanning"} onClick={() => void draftFromIntervention(intervention)}>
            {busy === `draft-${intervention.id}` ? t("growth.contentDrafting") : t("growth.contentDraftFromIntervention")}
          </button>
          {canRecycle ? (
            <button className="btn primary" type="button" disabled={busy !== "" || scanState === "scanning"} onClick={() => void recycleIntervention(intervention)}>
              {busy === `recycle-${intervention.id}` ? t("growth.evergreenRecycling") : t("growth.evergreenRecycleAction")}
            </button>
          ) : null}
          {intervention.status === "proposed" || intervention.status === "dismissed" ? (
            <button className="btn primary" type="button" disabled={busy === intervention.id || scanState === "scanning"} onClick={() => void changeStatus(intervention, "accepted")}>
              {t("growth.interventionsAccept")}
            </button>
          ) : null}
          {intervention.status === "accepted" ? (
            <button className="btn primary" type="button" disabled={busy === intervention.id || scanState === "scanning"} onClick={() => void changeStatus(intervention, "done")}>
              {t("growth.interventionsMarkDone")}
            </button>
          ) : null}
          {intervention.status !== "dismissed" && intervention.status !== "done" ? (
            <button className="btn ghost" type="button" disabled={busy === intervention.id || scanState === "scanning"} onClick={() => void changeStatus(intervention, "dismissed")}>
              {t("growth.interventionsDismiss")}
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <section className="growth-interventions">
      <header className="growth-interventions-hero">
        <div>
          <span>{t("growth.interventionsEyebrow")}</span>
          <h1>{t("growth.interventionsTitle")}</h1>
          <p>{t("growth.interventionsDescription", { repository })}</p>
        </div>
        <div className="growth-interventions-generate">
          <label>
            {t("growth.interventionsGenerationScope")}
            <select value={generationGoalId} onChange={(event) => setGenerationGoalId(event.target.value)}>
              <option value="">{t("growth.interventionsRepositoryWide")}</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {metricLabels.get(goal.metric) ?? goal.metric}: {formatNumber(goal.currentValue)} / {formatNumber(goal.targetValue)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="button" disabled={busy !== "" || scanState === "scanning"} onClick={() => void generate()}>
            {busy === "generate" ? t("growth.interventionsGenerating") : t("growth.interventionsGenerate")}
          </button>
          {aiEnabled === false ? (
            <p className="growth-interventions-ai-note">
              {t("growth.interventionsNoAi")} <a href="/preferences#preferences-ai" target="_blank" rel="noopener">{t("growth.interventionsOpenPreferences")}</a>
            </p>
          ) : null}
        </div>
      </header>

      {error ? <div className="growth-interventions-error" role="alert">{t("growth.interventionsError", { message: error })}</div> : null}
      {notice ? <div className="growth-interventions-notice" role="status">{notice}</div> : null}

      <section className="growth-interventions-scan" aria-labelledby="growth-opportunity-scan-title" aria-busy={scanState === "scanning"}>
        <div>
          <span>{t("growth.opportunityScanEyebrow")}</span>
          <h2 id="growth-opportunity-scan-title">{t("growth.opportunityScanTitle")}</h2>
          {scanState === "idle" ? <p>{t("growth.opportunityScanGuidance")}</p> : null}
          {scanState === "scanning" ? <p role="status">{t("growth.opportunityScanScanning")}</p> : null}
          {scanState === "empty" ? <p role="status">{t("growth.opportunityScanEmpty")}</p> : null}
          {scanState === "success" ? <p role="status">{t("growth.opportunityScanSummary", { count: scanCount })}</p> : null}
          {scanState === "error" ? <p className="growth-opportunity-scan-error" role="alert">{t("growth.opportunityScanError", { message: scanError })}</p> : null}
          {scanState === "empty" || scanState === "success" ? (
            <small className="growth-opportunity-scan-partial">{t("growth.opportunityScanPartialSignals")}</small>
          ) : null}
        </div>
        <button
          className="btn"
          type="button"
          disabled={!accountId || !enabled || busy !== "" || scanState === "scanning"}
          onClick={() => void scanOpportunities()}
        >
          {scanState === "scanning" ? t("growth.opportunityScanScanningAction") : t("growth.opportunityScanAction")}
        </button>
      </section>

      <section className="growth-interventions-tools">
        <div className="growth-interventions-filters">
          <label>
            {t("growth.interventionsFilterCategory")}
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
              <option value="all">{t("growth.interventionsAllCategories")}</option>
              {CATEGORIES.map((category) => <option key={category} value={category}>{t(categoryKeys[category])}</option>)}
            </select>
          </label>
          <label>
            {t("growth.interventionsFilterOrigin")}
            <select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as typeof originFilter)}>
              <option value="all">{t("growth.interventionsAllOrigins")}</option>
              {ORIGINS.map((origin) => <option key={origin} value={origin}>{t(originKeys[origin])}</option>)}
            </select>
          </label>
        </div>
        <div className="growth-interventions-manual-launcher">
          <div>
            <span>{t("growth.interventionsManualEyebrow")}</span>
            <h2>{t("growth.interventionsManualTitle")}</h2>
          </div>
          <button className="btn primary" type="button" disabled={busy !== "" || scanState === "scanning"} onClick={() => setManualModalOpen(true)}>
            {t("growth.interventionsManualTitle")}
          </button>
        </div>
      </section>

      {loading && !interventions.length ? <p className="growth-interventions-loading">{t("growth.interventionsLoading")}</p> : null}
      {!loading && !filtered.length ? (
        <div className="growth-interventions-empty"><h2>{t("growth.interventionsEmptyTitle")}</h2><p>{t("growth.interventionsEmptyDescription")}</p></div>
      ) : null}

      <div className="growth-intervention-groups" aria-busy={loading}>
        {GROWTH_INTERVENTION_STATUSES.filter((status) => status !== "dismissed").map((status) => {
          const entries = filtered.filter((intervention) => intervention.status === status);
          return (
            <section className={`growth-intervention-group status-${status}`} key={status}>
              <header><h2>{t(statusKeys[status])}</h2><span>{entries.length}</span></header>
              {entries.length ? <div className="growth-intervention-list">{entries.map(renderIntervention)}</div> : <p>{t("growth.interventionsGroupEmpty")}</p>}
            </section>
          );
        })}
        {(() => {
          const dismissed = filtered.filter((intervention) => intervention.status === "dismissed");
          return (
            <section className="growth-intervention-group status-dismissed">
              <button className="growth-intervention-group-toggle" type="button" aria-expanded={dismissedOpen} onClick={() => setDismissedOpen((open) => !open)}>
                <span><strong>{t(statusKeys.dismissed)}</strong><small>{dismissed.length}</small></span>
                <span aria-hidden="true">{dismissedOpen ? "−" : "+"}</span>
              </button>
              {dismissedOpen ? (
                dismissed.length ? <div className="growth-intervention-list">{dismissed.map(renderIntervention)}</div> : <p>{t("growth.interventionsGroupEmpty")}</p>
              ) : null}
            </section>
          );
        })()}
      </div>
      <GrowthInterventionCreateModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        onSubmit={createManual}
      />
      {selectedContentItem ? (
        <ContentItemDrawer
          item={selectedContentItem}
          onClose={() => setSelectedContentItem(null)}
          onUpdate={updateContentItem}
        />
      ) : null}
    </section>
  );
}
