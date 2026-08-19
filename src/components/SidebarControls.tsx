import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FacetValue, IssueFilters, PullRequestFilters, RepoFilters } from "../utils/dashboard";
import { getLanguageColor } from "../utils/colors";
import { INBOX_MAILBOXES, type InboxMailbox } from "../utils/inbox";
import { formatNumber } from "../utils/format";
import { ChevronIcon, CloseIcon, SearchIcon } from "./common/Icons";
import { useI18n } from "../i18n/I18nProvider";

type Tab = "inbox" | "issues" | "repos" | "kanban" | "insights" | "alerts" | "ci" | "digests" | "prs";

export interface InboxSidebarState {
  mailbox: InboxMailbox;
  counts: Record<InboxMailbox, number>;
  totalCount: number;
  unreadCount: number;
  onMailboxChange: (mailbox: InboxMailbox) => void;
  onMarkAllRead: () => void;
}

type IssueLikeFacets = {
  orgs: Map<string, number>;
  repos: Map<string, number>;
  labels: Map<string, { count: number; color?: string }>;
  authors: Map<string, number>;
  assignees: Map<string, number>;
};

interface SidebarControlsProps {
  tab: Tab;
  search: string;
  issueFilters: IssueFilters;
  prFilters: PullRequestFilters;
  repoFilters: RepoFilters;
  issueFacets: IssueLikeFacets;
  prFacets: IssueLikeFacets;
  repoFacets: {
    orgs: Map<string, number>;
    languages: Map<string, number>;
  };
  onSearchChange: (value: string) => void;
  onIssueFiltersChange: (filters: IssueFilters) => void;
  onPrFiltersChange: (filters: PullRequestFilters) => void;
  onRepoFiltersChange: (filters: RepoFilters) => void;
  onReset: () => void;
  onClose: () => void;
  authLogin?: string;
  inbox?: InboxSidebarState;
}

function toggleSetValue(values: Set<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function countOf(value: FacetValue): number {
  return typeof value === "number" ? value : value.count;
}

function CheckList({
  entries,
  selected,
  onToggle,
  showSwatch,
  languageDot,
  showGhAvatar,
  userLogin,
}: {
  entries: Array<[string, FacetValue]>;
  selected: Set<string>;
  onToggle: (value: string) => void;
  showSwatch?: boolean;
  languageDot?: boolean;
  showGhAvatar?: boolean;
  userLogin?: string;
}) {
  const { t } = useI18n();
  // Original sort (checked first, then by count, then alphabetical) with one addition:
  // when userLogin is set, the user's personal account always sorts last (orgs first).
  const sorted = [...entries].sort((a, b) => {
    if (userLogin) {
      if (a[0] === userLogin && b[0] !== userLogin) return 1;
      if (b[0] === userLogin && a[0] !== userLogin) return -1;
    }
    return Number(selected.has(b[0])) - Number(selected.has(a[0])) || countOf(b[1]) - countOf(a[1]) || a[0].localeCompare(b[0]);
  });
  if (!sorted.length) return <div style={{ padding: 8, color: "var(--muted-2)", fontSize: 12 }}>{t("common.noMatches")}</div>;

  return (
    <div className="check-list">
      {sorted.map(([name, value]) => {
        const color = typeof value === "number" ? undefined : value.color;
        return (
          <label className="check" key={name}>
            <input type="checkbox" checked={selected.has(name)} onChange={() => onToggle(name)} />
            {showSwatch && color ? <span className="label-swatch" style={{ background: `#${color}` }} /> : null}
            {languageDot ? <span className="label-swatch" style={{ borderRadius: "50%", background: getLanguageColor(name) }} /> : null}
            {showGhAvatar ? <img src={`https://github.com/${name}.png?size=32`} alt="" style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0 }} /> : null}
            <span className="label-text">{name}</span>
            <span className="label-count">{countOf(value)}</span>
          </label>
        );
      })}
    </div>
  );
}

function FilterSection({ title, activeCount, children, dataFor, open = false, onClear }: { title: string; activeCount: number; children: ReactNode; dataFor?: string; open?: boolean; onClear?: () => void }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(open || activeCount > 0);
  const prevActiveCountRef = useRef(activeCount);
  // Auto-open when filters become active, but never auto-close — the user may
  // want to deselect the last item and pick a different one without the panel
  // collapsing on them (issue #12). Sections passed `open` (Organizations,
  // Visibility, Options) stay pinned open as before.
  useEffect(() => {
    const prev = prevActiveCountRef.current;
    prevActiveCountRef.current = activeCount;
    if (prev === 0 && activeCount > 0) setIsOpen(true);
  }, [activeCount]);
  const effectiveOpen = open || isOpen;
  const clearable = activeCount > 0 && Boolean(onClear);
  return (
    <details
      className="section"
      data-for={dataFor}
      open={effectiveOpen}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (open && !next) return;
        setIsOpen(next);
      }}
    >
      <summary>
        <ChevronIcon />
        {title}
        {clearable ? (
          <button
            type="button"
            className="count active clearable"
            aria-label={`${t("common.clear")} ${title}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear?.(); }}
          >
            <span className="count-num">{activeCount}</span>
            <span className="count-clear">{t("common.clearAll")}</span>
          </button>
        ) : (
          <span className={`count ${activeCount ? "active" : ""}`}>{activeCount}</span>
        )}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

export function SidebarControls({
  tab,
  search,
  issueFilters,
  prFilters,
  repoFilters,
  issueFacets,
  prFacets,
  repoFacets,
  onSearchChange,
  onIssueFiltersChange,
  onPrFiltersChange,
  onRepoFiltersChange,
  onReset,
  onClose,
  authLogin,
  inbox,
}: SidebarControlsProps) {
  const { t } = useI18n();
  const inboxMode = tab === "inbox";
  const prMode = tab === "prs";
  const issueMode = tab === "issues" || tab === "kanban";
  const ticketMode = prMode || issueMode;
  const activeFilters: IssueFilters | PullRequestFilters = prMode ? prFilters : issueFilters;
  const activeFacets: IssueLikeFacets = prMode ? prFacets : issueFacets;
  const orgSelection = ticketMode ? activeFilters.orgs : repoFilters.orgs;
  const orgEntries = ticketMode ? activeFacets.orgs : repoFacets.orgs;
  const onActiveFiltersChange = (next: IssueFilters | PullRequestFilters) => {
    if (prMode) onPrFiltersChange(next as PullRequestFilters);
    else onIssueFiltersChange(next as IssueFilters);
  };

  if (inboxMode && inbox) {
    return (
      <aside className="sidebar" id="sidebar">
        <div className="side-head">
          <h2>{t("sidebar.mailboxes")}</h2>
          <span className="reset" style={{ pointerEvents: "none" }}>{formatNumber(inbox.totalCount)}</span>
          <button className="side-close" aria-label={t("common.closeFilters")} onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="search-wrap">
          <label className="search-input">
            <SearchIcon />
            <input type="search" placeholder={t("sidebar.searchInbox")} autoComplete="off" value={search} onChange={(event) => onSearchChange(event.target.value)} />
          </label>
        </div>
        <div className="mailbox-list">
          {INBOX_MAILBOXES.map((entry) => {
            const count = inbox.counts[entry.key] ?? 0;
            const active = inbox.mailbox === entry.key;
            return (
              <button
                className={`mailbox-item ${active ? "active" : ""}`}
                key={entry.key}
                type="button"
                onClick={() => inbox.onMailboxChange(entry.key)}
              >
                <span>{t(`mailbox.${entry.key}`)}</span>
                <strong>{formatNumber(count)}</strong>
              </button>
            );
          })}
        </div>
        {inbox.unreadCount > 0 ? (
          <button className="mailbox-action" type="button" onClick={inbox.onMarkAllRead}>
            {t("sidebar.markAllRead", { count: formatNumber(inbox.unreadCount) })}
          </button>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="sidebar" id="sidebar">
      <div className="side-head">
        <h2>{t("common.filters")}</h2>
        <button className="reset" onClick={onReset}>{t("common.clearAll")}</button>
        <button className="side-close" aria-label={t("common.closeFilters")} onClick={onClose}><CloseIcon /></button>
      </div>

      <div className="search-wrap">
        <label className="search-input">
          <SearchIcon />
          <input type="search" placeholder={t("sidebar.search")} autoComplete="off" value={search} onChange={(event) => onSearchChange(event.target.value)} />
        </label>
      </div>

      <FilterSection
        title={t("sidebar.organizations")}
        activeCount={orgSelection.size}
        open
        onClear={() => ticketMode
          ? onActiveFiltersChange({ ...activeFilters, orgs: new Set() })
          : onRepoFiltersChange({ ...repoFilters, orgs: new Set() })}
      >
        <CheckList
          entries={[...orgEntries.entries()]}
          selected={orgSelection}
          showGhAvatar
          userLogin={authLogin || undefined}
          onToggle={(value) => ticketMode
            ? onActiveFiltersChange({ ...activeFilters, orgs: toggleSetValue(activeFilters.orgs, value) })
            : onRepoFiltersChange({ ...repoFilters, orgs: toggleSetValue(repoFilters.orgs, value) })}
        />
      </FilterSection>

      {ticketMode ? (
        <>
          <FilterSection title={t("sidebar.repositories")} activeCount={activeFilters.repos.size} dataFor={prMode ? "prs-only" : "issues-only"} onClear={() => onActiveFiltersChange({ ...activeFilters, repos: new Set() })}>
            <CheckList entries={[...activeFacets.repos.entries()]} selected={activeFilters.repos} onToggle={(value) => onActiveFiltersChange({ ...activeFilters, repos: toggleSetValue(activeFilters.repos, value) })} />
          </FilterSection>
          <FilterSection title={t("sidebar.labels")} activeCount={activeFilters.labels.size} dataFor={prMode ? "prs-only" : "issues-only"} onClear={() => onActiveFiltersChange({ ...activeFilters, labels: new Set() })}>
            <CheckList entries={[...activeFacets.labels.entries()]} selected={activeFilters.labels} showSwatch onToggle={(value) => onActiveFiltersChange({ ...activeFilters, labels: toggleSetValue(activeFilters.labels, value) })} />
          </FilterSection>
          <FilterSection title={t("sidebar.authors")} activeCount={activeFilters.authors.size} dataFor={prMode ? "prs-only" : "issues-only"} onClear={() => onActiveFiltersChange({ ...activeFilters, authors: new Set() })}>
            <div className="opt-group author-mode" role="group" aria-label={t("sidebar.authorFilterMode")}>
              {(["include", "exclude"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={activeFilters.authorMode === mode ? "active" : ""}
                  onClick={() => onActiveFiltersChange({ ...activeFilters, authorMode: mode })}
                >
                  {t(mode === "include" ? "sidebar.includeAuthors" : "sidebar.excludeAuthors")}
                </button>
              ))}
            </div>
            <CheckList entries={[...activeFacets.authors.entries()]} selected={activeFilters.authors} onToggle={(value) => onActiveFiltersChange({ ...activeFilters, authors: toggleSetValue(activeFilters.authors, value) })} />
          </FilterSection>
          <FilterSection title={t("sidebar.assignees")} activeCount={activeFilters.assignees.size} dataFor={prMode ? "prs-only" : "issues-only"} onClear={() => onActiveFiltersChange({ ...activeFilters, assignees: new Set() })}>
            <CheckList entries={[...activeFacets.assignees.entries()]} selected={activeFilters.assignees} onToggle={(value) => onActiveFiltersChange({ ...activeFilters, assignees: toggleSetValue(activeFilters.assignees, value) })} />
          </FilterSection>
        </>
      ) : (
        <>
          <FilterSection title={t("sidebar.languages")} activeCount={repoFilters.languages.size} dataFor="repos-only" onClear={() => onRepoFiltersChange({ ...repoFilters, languages: new Set() })}>
            <CheckList entries={[...repoFacets.languages.entries()]} selected={repoFilters.languages} languageDot onToggle={(value) => onRepoFiltersChange({ ...repoFilters, languages: toggleSetValue(repoFilters.languages, value) })} />
          </FilterSection>
          <FilterSection title={t("sidebar.visibility")} activeCount={repoFilters.visibility === "all" ? 0 : 1} dataFor="repos-only" open onClear={() => onRepoFiltersChange({ ...repoFilters, visibility: "all" })}>
            <div className="opt-group" role="tablist">
              {(["all", "public", "private"] as const).map((value) => (
                <button key={value} className={repoFilters.visibility === value ? "active" : ""} onClick={() => onRepoFiltersChange({ ...repoFilters, visibility: value })}>{value === "all" ? t("common.all") : value === "public" ? t("sidebar.public") : t("sidebar.private")}</button>
              ))}
            </div>
          </FilterSection>
          <FilterSection title={t("sidebar.options")} activeCount={Number(!repoFilters.includeForks) + Number(repoFilters.includeArchived)} dataFor="repos-only" open onClear={() => onRepoFiltersChange({ ...repoFilters, includeForks: true, includeArchived: false })}>
            <div className="toggle-row">{t("sidebar.includeForks")} <button className={`toggle ${repoFilters.includeForks ? "on" : ""}`} role="switch" aria-checked={repoFilters.includeForks} onClick={() => onRepoFiltersChange({ ...repoFilters, includeForks: !repoFilters.includeForks })} /></div>
            <div className="toggle-row">{t("sidebar.includeArchived")} <button className={`toggle ${repoFilters.includeArchived ? "on" : ""}`} role="switch" aria-checked={repoFilters.includeArchived} onClick={() => onRepoFiltersChange({ ...repoFilters, includeArchived: !repoFilters.includeArchived })} /></div>
          </FilterSection>
        </>
      )}
    </aside>
  );
}
