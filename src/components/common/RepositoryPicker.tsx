import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GhRepo } from "../../types/github";
import { formatNumber } from "../../utils/format";
import { BookIcon } from "./Icons";

interface RepositoryPickerProps {
  repos: GhRepo[];
  value: string;
  placeholder: string;
  onChange: (repository: string) => void;
}

export function RepositoryPicker({ repos, value, placeholder, onChange }: RepositoryPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const optionsId = useId();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => setQuery(value), [value]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const sorted = [...repos].sort((a, b) => b.stargazerCount - a.stargazerCount);
    if (!needle || query === value) return sorted.slice(0, 12);
    return sorted.filter((repo) => `${repo.nameWithOwner} ${repo.description ?? ""} ${repo.primaryLanguage?.name ?? ""}`.toLocaleLowerCase().includes(needle)).slice(0, 12);
  }, [query, repos, value]);

  function select(repo: GhRepo) {
    onChange(repo.nameWithOwner);
    setQuery(repo.nameWithOwner);
    setOpen(false);
  }

  return (
    <div className="repository-picker" ref={rootRef}>
      <div className={`repository-picker-input${open ? " open" : ""}`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 10.5 15 14m-1-7A6 6 0 1 1 2 7a6 6 0 0 1 12 0Z" /></svg>
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={optionsId}
          aria-activedescendant={open && matches[activeIndex] ? `${optionsId}-option-${activeIndex}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value !== value) onChange("");
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, matches.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
            if (event.key === "Enter" && open && matches[activeIndex]) { event.preventDefault(); select(matches[activeIndex]); }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <span className="repository-picker-chevron">⌄</span>
      </div>
      {open ? (
        <div className="repository-picker-menu" id={optionsId} role="listbox">
          <div className="repository-picker-summary">{matches.length ? `${matches.length} repositories` : "No repositories found"}</div>
          {matches.map((repo, index) => (
            <button
              type="button"
              role="option"
              aria-selected={repo.nameWithOwner === value}
              id={`${optionsId}-option-${index}`}
              className={index === activeIndex ? "active" : ""}
              key={repo.nameWithOwner}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(repo)}
            >
              <span className="repository-picker-avatar" aria-hidden="true"><BookIcon /></span>
              <span className="repository-picker-copy"><strong>{repo.nameWithOwner}</strong><small>{repo.description || "No description"}</small></span>
              <span className="repository-picker-stats">★ {formatNumber(repo.stargazerCount)}{repo.primaryLanguage ? <small>{repo.primaryLanguage.name}</small> : null}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
