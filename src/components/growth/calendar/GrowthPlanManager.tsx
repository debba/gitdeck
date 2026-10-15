import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  archiveGrowthContentPlan,
  fetchGrowthContentPlans,
  generateGrowthContentPlan,
  regenerateGrowthContentPlan,
} from "../../../api/growth";
import { useI18n } from "../../../i18n/I18nProvider";
import type { GrowthContentPlan } from "../../../types/growth";
import {
  growthPlanPeriodFromStart,
  nextGrowthPlanPeriod,
} from "../../../utils/growth/planSlots";
import { ConfirmDialog } from "../../common/ConfirmDialog";

interface GrowthPlanManagerProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
  onContentItemsChange: () => void;
}

type PendingAction = { kind: "regenerate" | "archive"; plan: GrowthContentPlan };

function planStatusKey(status: GrowthContentPlan["status"]):
  | "growth.planStatusDraft"
  | "growth.planStatusActive"
  | "growth.planStatusArchived" {
  if (status === "draft") return "growth.planStatusDraft";
  if (status === "archived") return "growth.planStatusArchived";
  return "growth.planStatusActive";
}

export function GrowthPlanManager({
  accountId,
  enabled,
  repository,
  onContentItemsChange,
}: GrowthPlanManagerProps) {
  const { language, t } = useI18n();
  const defaultPeriod = useMemo(() => nextGrowthPlanPeriod(), [accountId, repository]);
  const [periodStart, setPeriodStart] = useState(defaultPeriod.periodStart);
  const [weeks, setWeeks] = useState(1);
  const [plans, setPlans] = useState<GrowthContentPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const [weightsNotice, setWeightsNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const actionController = useRef<AbortController | null>(null);

  const period = useMemo(() => {
    try {
      return growthPlanPeriodFromStart(periodStart, weeks);
    } catch {
      return null;
    }
  }, [periodStart, weeks]);

  useEffect(() => {
    actionController.current?.abort();
    setPlans([]);
    setBusy(null);
    setLoadError("");
    setRequestError("");
    setValidationError("");
    setFallbackNotice("");
    setWeightsNotice("");
    setPendingAction(null);
    setPeriodStart(defaultPeriod.periodStart);
    setWeeks(1);
    if (!enabled || !accountId || !repository) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void fetchGrowthContentPlans(repository, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPlans(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setLoadError((cause as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      actionController.current?.abort();
    };
  }, [accountId, defaultPeriod.periodStart, enabled, repository]);

  async function refreshPlans(signal: AbortSignal) {
    const result = await fetchGrowthContentPlans(repository, signal);
    if (!signal.aborted) setPlans(result);
  }

  async function runAction(
    key: string,
    action: (signal: AbortSignal) => Promise<unknown>,
  ) {
    if (busy || !accountId) return;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    setBusy(key);
    setRequestError("");
    setValidationError("");
    setFallbackNotice("");
    setWeightsNotice("");
    try {
      const result = await action(controller.signal);
      if (controller.signal.aborted) return;
      if (
        typeof result === "object"
        && result !== null
        && "usedFallback" in result
        && result.usedFallback === true
      ) setFallbackNotice(t("growth.planFallback"));
      if (
        typeof result === "object"
        && result !== null
        && "weightsAdjusted" in result
        && result.weightsAdjusted === true
      ) setWeightsNotice(t("growth.planWeightsAdjusted"));
      onContentItemsChange();
      await refreshPlans(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setRequestError((cause as Error).message);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null);
      if (actionController.current === controller) actionController.current = null;
    }
  }

  function createPlan(event: FormEvent) {
    event.preventDefault();
    if (!period) {
      setValidationError(t("growth.planValidation"));
      return;
    }
    void runAction("create", (signal) => generateGrowthContentPlan({
      repository,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    }, signal));
  }

  function confirmAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === "regenerate") {
      void runAction(action.plan.id, (signal) => regenerateGrowthContentPlan(action.plan.id, signal));
    } else {
      void runAction(action.plan.id, (signal) => archiveGrowthContentPlan(action.plan.id, signal));
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const formatDate = (value: string) => dateFormatter.format(new Date(`${value}T12:00:00.000Z`));
  const activeBusy = busy !== null;

  return (
    <section className="growth-plan-manager" aria-busy={loading || activeBusy}>
      <header className="growth-plan-manager-head">
        <div>
          <span>{t("growth.planEyebrow")}</span>
          <h2>{t("growth.planTitle")}</h2>
          <p>{t("growth.planDescription")}</p>
        </div>
      </header>

      <form className="growth-plan-create" onSubmit={createPlan}>
        <label>
          <span>{t("growth.planStart")}</span>
          <input
            type="date"
            value={periodStart}
            disabled={activeBusy}
            onChange={(event) => {
              setPeriodStart(event.target.value);
              setValidationError("");
            }}
          />
        </label>
        <label>
          <span>{t("growth.planWeeks")}</span>
          <select
            value={weeks}
            disabled={activeBusy}
            onChange={(event) => {
              setWeeks(Number(event.target.value));
              setValidationError("");
            }}
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {count === 1 ? t("growth.planOneWeek") : t("growth.planWeekCount", { count })}
              </option>
            ))}
          </select>
        </label>
        <div className="growth-plan-create-summary">
          <span>{t("growth.planPeriod")}</span>
          <strong>{period
            ? t("growth.planPeriodRange", { start: formatDate(period.periodStart), end: formatDate(period.periodEnd) })
            : t("growth.planInvalidPeriod")}</strong>
        </div>
        <button className="btn primary" type="submit" disabled={activeBusy || !enabled || !accountId}>
          {busy === "create" ? t("growth.planGenerating") : t("growth.planGenerate")}
        </button>
      </form>

      {validationError ? <div className="growth-plan-message error" role="alert">{validationError}</div> : null}
      {requestError ? <div className="growth-plan-message error" role="alert">{t("growth.planRequestError", { message: requestError })}</div> : null}
      {fallbackNotice ? <div className="growth-plan-message fallback" role="status">{fallbackNotice}</div> : null}
      {weightsNotice ? <div className="growth-plan-message" role="status">{weightsNotice}</div> : null}
      {loading ? <div className="growth-plan-message" role="status">{t("growth.planLoading")}</div> : null}
      {!loading && loadError ? <div className="growth-plan-message error" role="alert">{t("growth.planLoadError", { message: loadError })}</div> : null}
      {!loading && !loadError && plans.length === 0 ? (
        <div className="growth-plan-empty">
          <strong>{t("growth.planEmptyTitle")}</strong>
          <p>{t("growth.planEmptyDescription")}</p>
        </div>
      ) : null}

      {!loading && plans.length > 0 ? (
        <div className="growth-plan-list">
          {plans.map((plan) => (
            <article className={`growth-plan-row status-${plan.status}`} key={plan.id}>
              <div>
                <span className="growth-plan-status">{t(planStatusKey(plan.status))}</span>
                <strong>{t("growth.planPeriodRange", {
                  start: formatDate(plan.periodStart),
                  end: formatDate(plan.periodEnd),
                })}</strong>
                <small>{t("growth.planGeneratedAt", {
                  date: new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" })
                    .format(new Date(plan.generatedAt)),
                })}</small>
              </div>
              {plan.status !== "archived" ? (
                <div className="growth-plan-actions">
                  <button className="btn ghost" type="button" disabled={activeBusy} onClick={() => setPendingAction({ kind: "regenerate", plan })}>
                    {busy === plan.id ? t("growth.planWorking") : t("growth.planRegenerate")}
                  </button>
                  <button className="btn ghost danger" type="button" disabled={activeBusy} onClick={() => setPendingAction({ kind: "archive", plan })}>
                    {t("growth.planArchive")}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingAction !== null}
        kind={t("growth.planConfirmKind")}
        title={t(pendingAction?.kind === "archive" ? "growth.planArchiveConfirmTitle" : "growth.planRegenerateConfirmTitle")}
        message={t(pendingAction?.kind === "archive" ? "growth.planArchiveConfirmMessage" : "growth.planRegenerateConfirmMessage")}
        confirmLabel={t(pendingAction?.kind === "archive" ? "growth.planArchive" : "growth.planRegenerate")}
        danger={pendingAction?.kind === "archive"}
        onConfirm={confirmAction}
        onCancel={() => setPendingAction(null)}
      />
    </section>
  );
}
