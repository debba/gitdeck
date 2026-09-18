import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { createGoal } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import { GOAL_METRIC_DEFINITIONS, type GoalMetric } from "../../types/goals";
import type { GhRepo } from "../../types/github";
import { CloseIcon, GoalIcon } from "../common/Icons";
import { RepositoryPicker } from "../common/RepositoryPicker";

interface GoalCreateModalProps {
  open: boolean;
  repos: GhRepo[];
  fixedRepository?: string;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}

function currentRepoValue(repo: GhRepo | undefined, metric: GoalMetric): number {
  if (metric === "stars") return repo?.stargazerCount ?? 0;
  if (metric === "forks") return repo?.forkCount ?? 0;
  return 0;
}

/** Collects and submits the fields needed to create a repository goal. */
export function GoalCreateModal({ open, repos, fixedRepository, onClose, onCreated }: GoalCreateModalProps) {
  const { t } = useI18n();
  const [repository, setRepository] = useState("");
  const [metric, setMetric] = useState<GoalMetric>("stars");
  const [targetValue, setTargetValue] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const targetRef = useRef<HTMLInputElement | null>(null);
  const activeRepository = fixedRepository ?? repository;
  const reposByName = new Map(repos.map((repo) => [repo.nameWithOwner, repo]));

  useEffect(() => {
    if (!open) setError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (fixedRepository) targetRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fixedRepository, open, onClose, saving]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await createGoal({
        repository: activeRepository,
        metric,
        targetValue: Number(targetValue),
        currentValue: currentRepoValue(reposByName.get(activeRepository), metric),
        deadline,
      });
      await onCreated();
      setTargetValue("");
      setDeadline("");
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-root">
      <div className="modal-backdrop" onClick={() => { if (!saving) onClose(); }} />
      <div className="modal goal-create-modal" role="dialog" aria-modal="true" aria-labelledby="goal-create-modal-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-icon repository" aria-hidden="true"><GoalIcon /></span>
            <div>
              <div className="kind">{t("tabs.goals")}</div>
              <h3 id="goal-create-modal-title">{t("goals.createTitle")}</h3>
            </div>
          </div>
          <button className="modal-close" type="button" disabled={saving} aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>
        <form className="goal-create-form" onSubmit={(event) => void submit(event)}>
          <div className="modal-body goal-create-modal-body">
            <p>{t("goals.createDescription")}</p>
            <div className="goal-create-fields">
              <label className="goal-create-repository-field">
                {t("goals.repository")}
                {fixedRepository ? (
                  <input type="text" value={fixedRepository} readOnly aria-readonly="true" />
                ) : (
                  <RepositoryPicker repos={repos} value={repository} placeholder={t("goals.searchRepository")} autoFocus onChange={setRepository} />
                )}
              </label>
              <label>
                {t("goals.metric")}
                <select value={metric} onChange={(event) => setMetric(event.target.value as GoalMetric)}>
                  {GOAL_METRIC_DEFINITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>
                {t("goals.target")}
                <input ref={targetRef} type="number" min="1" step="1" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} required />
              </label>
              <label>
                {t("goals.deadline")}
                <input type="date" min={new Date().toISOString().slice(0, 10)} value={deadline} onChange={(event) => setDeadline(event.target.value)} required />
              </label>
            </div>
            {error ? <div className="error" role="alert">{error}</div> : null}
          </div>
          <footer className="modal-foot">
            <span className="spacer" />
            <button className="btn ghost" type="button" disabled={saving} onClick={onClose}>{t("common.cancel")}</button>
            <button className="btn primary" type="submit" disabled={saving || !activeRepository || !repos.length}>{saving ? t("common.loading") : t("goals.add")}</button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
