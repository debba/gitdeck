import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { GoalContentSource } from "../../types/goals";
import type { GhRepo } from "../../types/github";
import { normalizeContentSources } from "../../utils/socialProposals";
import { BookIcon } from "./Icons";
import { RepositoryPicker } from "./RepositoryPicker";

interface ContentSourcePickerProps {
  repos: GhRepo[];
  currentRepository: string;
  value: GoalContentSource[];
  onChange: (sources: GoalContentSource[]) => void;
  maxSources?: number;
}

type SourceMode = "repository" | "website";

/** Selects optional campaign sources without duplicating repository-picker behavior. */
export function ContentSourcePicker({ repos, currentRepository, value, onChange, maxSources = 6 }: ContentSourcePickerProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<SourceMode>("repository");
  const [repository, setRepository] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const full = value.length >= maxSources;
  const availableRepos = useMemo(() => full ? [] : repos.filter((repo) => (
    repo.nameWithOwner !== currentRepository
    && !value.some((source) => source.type === "repository" && source.value === repo.nameWithOwner)
  )), [currentRepository, full, repos, value]);

  function add(source: GoalContentSource): boolean {
    const normalized = normalizeContentSources([...value, source], maxSources);
    if (normalized.length === value.length) {
      setError(t("goals.sourcesInvalid"));
      return false;
    }
    onChange(normalized);
    setError("");
    return true;
  }

  useEffect(() => {
    if (!repository) return;
    add({ type: "repository", value: repository });
    setRepository("");
    // `add` intentionally reacts only to an explicit picker selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  function addWebsite() {
    if (add({ type: "website", value: website })) setWebsite("");
  }

  function handleWebsiteKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addWebsite();
  }

  return (
    <section className="content-source-picker" aria-labelledby="content-source-title">
      <header className="content-source-head">
        <span className="content-source-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2h6A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" /><path d="m8 15 2.2-2.4 1.8 1.8 2.7-3.1L17 15" /><circle cx="15.8" cy="10.2" r="1" /></svg>
        </span>
        <div>
          <strong id="content-source-title">{t("goals.sourcesTitle")}</strong>
          <small>{t("goals.sourcesDescription")}</small>
        </div>
        <span className="content-source-count">{value.length}/{maxSources}</span>
      </header>

      <div className="content-source-compose">
        <div className="content-source-tabs" role="tablist" aria-label={t("goals.sourcesTitle")}>
          <button type="button" role="tab" aria-selected={mode === "repository"} onClick={() => { setMode("repository"); setError(""); }}>
            <BookIcon /> {t("goals.sourcesRepoBadge")}
          </button>
          <button type="button" role="tab" aria-selected={mode === "website"} onClick={() => { setMode("website"); setError(""); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
            {t("goals.sourcesWebBadge")}
          </button>
        </div>
        <div className="content-source-control">
          {mode === "repository" ? (
            <RepositoryPicker
              repos={availableRepos}
              value={repository}
              placeholder={full ? t("goals.sourcesLimit") : t("goals.sourcesChooseRepository")}
              onChange={setRepository}
            />
          ) : (
            <div className="content-source-url">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" /></svg>
              <input
                type="url"
                value={website}
                disabled={full}
                placeholder={full ? t("goals.sourcesLimit") : "https://example.com/media"}
                aria-label={t("goals.sourcesWebsite")}
                onChange={(event) => setWebsite(event.target.value)}
                onKeyDown={handleWebsiteKeyDown}
              />
              <button type="button" disabled={!website.trim() || full} onClick={addWebsite} aria-label={t("goals.sourcesAdd")}>+</button>
            </div>
          )}
        </div>
      </div>

      {value.length ? (
        <div className="content-source-list">
          {value.map((source) => (
            <span key={`${source.type}:${source.value}`}>
              <b>{source.type === "repository" ? t("goals.sourcesRepoBadge") : t("goals.sourcesWebBadge")}</b>
              <span>{source.value}</span>
              <button
                type="button"
                aria-label={t("goals.sourcesRemove", { source: source.value })}
                onClick={() => onChange(value.filter((item) => item !== source))}
              >×</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="content-source-empty">{t("goals.sourcesOptional")}</p>
      )}
      {error ? <small className="content-source-error">{error}</small> : null}
    </section>
  );
}
