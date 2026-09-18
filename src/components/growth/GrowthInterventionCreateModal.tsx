import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider";
import type { GrowthInterventionCategory } from "../../types/growth";
import { CloseIcon } from "../common/Icons";

const CATEGORIES: GrowthInterventionCategory[] = ["product", "community", "engineering", "marketing"];
const categoryKeys = {
  product: "growth.interventionsCategory.product",
  community: "growth.interventionsCategory.community",
  engineering: "growth.interventionsCategory.engineering",
  marketing: "growth.interventionsCategory.marketing",
} as const;

interface GrowthInterventionCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { category: GrowthInterventionCategory; title: string; action: string }) => Promise<void>;
}

/** Collects a manual intervention without crowding the backlog toolbar. */
export function GrowthInterventionCreateModal({ open, onClose, onSubmit }: GrowthInterventionCreateModalProps) {
  const { t } = useI18n();
  const [category, setCategory] = useState<GrowthInterventionCategory>("product");
  const [title, setTitle] = useState("");
  const [action, setAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, saving]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit({ category, title: title.trim(), action: action.trim() });
      setCategory("product");
      setTitle("");
      setAction("");
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
      <div className="modal growth-intervention-create-modal" role="dialog" aria-modal="true" aria-labelledby="growth-intervention-create-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-icon growth-intervention-create-icon" aria-hidden="true">+</span>
            <div>
              <div className="kind">{t("growth.interventionsManualEyebrow")}</div>
              <h3 id="growth-intervention-create-title">{t("growth.interventionsManualTitle")}</h3>
            </div>
          </div>
          <button className="modal-close" type="button" disabled={saving} aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>
        <form className="growth-intervention-create-form" onSubmit={(event) => void submit(event)}>
          <div className="modal-body growth-intervention-create-body">
            <label>
              {t("growth.interventionsCategoryLabel")}
              <select value={category} disabled={saving} onChange={(event) => setCategory(event.target.value as GrowthInterventionCategory)}>
                {CATEGORIES.map((item) => <option key={item} value={item}>{t(categoryKeys[item])}</option>)}
              </select>
            </label>
            <label>
              {t("growth.interventionsTitleLabel")}
              <input ref={titleRef} value={title} disabled={saving} onChange={(event) => setTitle(event.target.value)} required maxLength={160} />
            </label>
            <label>
              {t("growth.interventionsActionLabel")}
              <textarea value={action} disabled={saving} onChange={(event) => setAction(event.target.value)} required maxLength={1200} rows={6} />
            </label>
            {error ? <div className="growth-interventions-error" role="alert">{t("growth.interventionsError", { message: error })}</div> : null}
          </div>
          <footer className="modal-foot">
            <span className="spacer" />
            <button className="btn ghost" type="button" disabled={saving} onClick={onClose}>{t("common.cancel")}</button>
            <button className="btn primary" type="submit" disabled={saving || !title.trim() || !action.trim()}>
              {saving ? t("growth.interventionsCreating") : t("growth.interventionsCreate")}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
