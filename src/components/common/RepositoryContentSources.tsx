import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchRepositoryContentSources, updateRepositoryContentSources } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import type { GoalContentSource } from "../../types/goals";
import type { GhRepo } from "../../types/github";
import { ContentSourcePicker } from "./ContentSourcePicker";
import { BookIcon, CloseIcon } from "./Icons";

interface RepositoryContentSourcesProps {
  repository: string;
  repos: GhRepo[];
}

/** Opens the fixed source library shared by every generated post for a repository. */
export function RepositoryContentSources({ repository, repos }: RepositoryContentSourcesProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<GoalContentSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    saveVersion.current += 1;
    setError("");
    setLoading(true);
    setSaving(false);
    void fetchRepositoryContentSources(repository)
      .then((result) => { if (active) setSources(result.sources); })
      .catch((cause) => { if (active) setError((cause as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, repository]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function changeSources(next: GoalContentSource[]) {
    setSources(next);
    setError("");
    setSaving(true);
    const version = ++saveVersion.current;
    const request = saveQueue.current.then(async () => {
      await updateRepositoryContentSources(repository, next);
    });
    saveQueue.current = request.catch(() => undefined);
    void request.catch((cause) => {
      if (version === saveVersion.current) setError((cause as Error).message);
    }).finally(() => {
      if (version === saveVersion.current) setSaving(false);
    });
  }

  return (
    <>
      <button className="btn ghost goal-sources-open" type="button" onClick={() => setOpen(true)}>
        <BookIcon /> {t("goals.sourcesTitle")}
      </button>
      {open ? createPortal(
        <div className="modal-root">
          <div className="modal-backdrop" onClick={() => setOpen(false)} />
          <div className="modal goal-sources-modal" role="dialog" aria-modal="true" aria-labelledby="goal-sources-modal-title">
            <header className="modal-head">
              <div className="modal-title">
                <span className="modal-icon repository" aria-hidden="true"><BookIcon /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="kind">{repository}</div>
                  <h3 id="goal-sources-modal-title">{t("goals.sourcesTitle")}</h3>
                </div>
              </div>
              <button className="modal-close" type="button" aria-label={t("common.close")} onClick={() => setOpen(false)}><CloseIcon /></button>
            </header>
            <div className="modal-body goal-sources-body">
              {loading ? <div className="goal-proposals-loading" role="status">{t("common.loading")}</div> : (
                <ContentSourcePicker repos={repos} currentRepository={repository} value={sources} onChange={changeSources} />
              )}
              {saving ? <small className="content-source-status">{t("common.loading")}</small> : null}
              {error ? <small className="content-source-error">{error}</small> : null}
            </div>
            <footer className="modal-foot">
              <span className="modal-page">{saving ? t("common.loading") : ""}</span>
              <div className="spacer" />
              <button className="btn primary" type="button" disabled={saving} onClick={() => setOpen(false)}>{t("common.close")}</button>
            </footer>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
