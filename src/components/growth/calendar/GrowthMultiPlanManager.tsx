import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { generateMultipleGrowthContentPlans } from "../../../api/growth";
import { useI18n } from "../../../i18n/I18nProvider";
import {
  growthPlanPeriodFromStart,
  nextGrowthPlanPeriod,
} from "../../../utils/growth/planSlots";

interface GrowthMultiPlanManagerProps {
  accountId: string | null;
  enabled: boolean;
  repositories: readonly string[];
  onGenerated: () => void;
}

export function GrowthMultiPlanManager({
  accountId,
  enabled,
  repositories,
  onGenerated,
}: GrowthMultiPlanManagerProps) {
  const { language, t } = useI18n();
  const planningRepositories = useMemo(
    () => [...repositories]
      .sort((left, right) => left.localeCompare(right, language, { sensitivity: "base" }) || left.localeCompare(right, language)),
    [language, repositories],
  );
  const defaultPeriod = useMemo(() => nextGrowthPlanPeriod(), [accountId]);
  const [selectedRepositories, setSelectedRepositories] = useState<Set<string>>(() => new Set());
  const [periodStart, setPeriodStart] = useState(defaultPeriod.periodStart);
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [success, setSuccess] = useState("");
  const [fallback, setFallback] = useState(false);
  const [weightsAdjusted, setWeightsAdjusted] = useState(false);
  const [deconflictedCount, setDeconflictedCount] = useState(0);
  const [remainingCollisionCount, setRemainingCollisionCount] = useState(0);
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
    actionController.current = null;
    setSelectedRepositories(new Set());
    setPeriodStart(defaultPeriod.periodStart);
    setWeeks(1);
    setBusy(false);
    setValidationError("");
    setRequestError("");
    setSuccess("");
    setFallback(false);
    setWeightsAdjusted(false);
    setDeconflictedCount(0);
    setRemainingCollisionCount(0);
    return () => actionController.current?.abort();
  }, [accountId, defaultPeriod.periodStart, enabled]);

  function toggleRepository(repository: string) {
    if (busy) return;
    setSelectedRepositories((current) => {
      const next = new Set(current);
      if (next.has(repository)) next.delete(repository);
      else if (next.size < 10) next.add(repository);
      return next;
    });
    setValidationError("");
  }

  async function generatePlans(event: FormEvent) {
    event.preventDefault();
    if (busy || actionController.current || !accountId) return;
    const selected = planningRepositories.filter((repository) => selectedRepositories.has(repository));
    if (!period || selected.length < 2 || selected.length > 10) {
      setValidationError(t("growth.multiPlanValidation"));
      return;
    }

    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setValidationError("");
    setRequestError("");
    setSuccess("");
    setFallback(false);
    setWeightsAdjusted(false);
    setDeconflictedCount(0);
    setRemainingCollisionCount(0);
    try {
      const result = await generateMultipleGrowthContentPlans({
        repositories: selected,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      }, controller.signal);
      if (controller.signal.aborted) return;
      setFallback(result.plans.some(({ usedFallback }) => usedFallback));
      setWeightsAdjusted(result.plans.some((plan) => plan.weightsAdjusted));
      setDeconflictedCount(result.deconflictedItemCount);
      setRemainingCollisionCount(result.remainingCollisionCount);
      setSuccess(t("growth.multiPlanSuccess", { count: result.plans.length }));
      onGenerated();
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setRequestError((cause as Error).message);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (actionController.current === controller) actionController.current = null;
    }
  }

  return (
    <section className="growth-multi-plan" aria-busy={busy}>
      <header className="growth-plan-manager-head">
        <div>
          <span>{t("growth.multiPlanEyebrow")}</span>
          <h2>{t("growth.multiPlanTitle")}</h2>
          <p>{t("growth.multiPlanDescription")}</p>
        </div>
      </header>
      <form onSubmit={generatePlans}>
        <fieldset disabled={busy || !enabled || !accountId || planningRepositories.length < 2}>
          <legend>{t("growth.multiPlanRepositories")}</legend>
          <div className="growth-multi-plan-repositories">
            {planningRepositories.map((repository) => (
              <label key={repository}>
                <input
                  type="checkbox"
                  checked={selectedRepositories.has(repository)}
                  disabled={!selectedRepositories.has(repository) && selectedRepositories.size >= 10}
                  onChange={() => toggleRepository(repository)}
                />
                <span>{repository}</span>
              </label>
            ))}
          </div>
          {planningRepositories.length < 2 ? <p>{t("growth.multiPlanNeedsRepositories")}</p> : null}
        </fieldset>
        <div className="growth-multi-plan-period">
          <label>
            <span>{t("growth.planStart")}</span>
            <input
              type="date"
              value={periodStart}
              disabled={busy}
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
              disabled={busy}
              onChange={(event) => {
                setWeeks(Number(event.target.value));
                setValidationError("");
              }}
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>{count === 1 ? t("growth.planOneWeek") : t("growth.planWeekCount", { count })}</option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={busy || !enabled || !accountId || planningRepositories.length < 2}>
            {busy
              ? t("growth.multiPlanGenerating", { count: selectedRepositories.size })
              : t("growth.multiPlanGenerate")}
          </button>
        </div>
      </form>
      {validationError ? <div className="growth-plan-message error" role="alert">{validationError}</div> : null}
      {requestError ? <div className="growth-plan-message error" role="alert">{t("growth.multiPlanError", { message: requestError })}</div> : null}
      {fallback ? <div className="growth-plan-message fallback" role="status">{t("growth.multiPlanFallback")}</div> : null}
      {weightsAdjusted ? <div className="growth-plan-message" role="status">{t("growth.multiPlanWeightsAdjusted")}</div> : null}
      {deconflictedCount > 0 ? <div className="growth-plan-message" role="status">{t("growth.multiPlanDeconflicted", { count: deconflictedCount })}</div> : null}
      {remainingCollisionCount > 0 ? <div className="growth-plan-message fallback" role="status">{t("growth.multiPlanPartialDeconfliction", { count: remainingCollisionCount })}</div> : null}
      {success ? <div className="growth-plan-message success" role="status">{success}</div> : null}
    </section>
  );
}
