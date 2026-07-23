import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { GhRepo } from "../../types/github";
import { getLabelCssVars } from "../../utils/colors";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { searchInboxItems, type InboxItem } from "../../utils/inbox";
import { clampPage } from "../../utils/pagination";
import { Avatar } from "../common/Avatar";
import { Pagination } from "../common/Pagination";
import {
  BookIcon,
  CheckIcon,
  DensityIcon,
  IssueIcon,
  KeyboardIcon,
  PulseIcon,
  RefreshIcon,
  SearchIcon,
} from "../common/Icons";

type Density = "compact" | "cozy" | "comfortable";

const DENSITY_KEY = "gh-dash.inboxDensity";
const DENSITY_OPTIONS: Density[] = ["compact", "cozy", "comfortable"];

function readStoredDensity(): Density {
  if (typeof window === "undefined") return "cozy";
  const raw = window.localStorage.getItem(DENSITY_KEY);
  return DENSITY_OPTIONS.includes(raw as Density) ? (raw as Density) : "cozy";
}

interface TriageWorkspaceProps {
  items: InboxItem[];
  title: string;
  emptyTitle: string;
  emptyMessage: string;
  reposByName?: Map<string, GhRepo>;
  onRepoClick?: (repo: GhRepo) => void;
  sidebar?: ReactNode;
  className?: string;
  searchPlaceholder?: string;
  onMarkRead?: (threadId: string) => void;
  onRefresh?: () => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  hideInternalSearch?: boolean;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

function kindLabel(item: InboxItem): string {
  return item.kind === "pull-request" ? "PR" : "Issue";
}

function primaryReason(item: InboxItem): string {
  return item.reasons[0]?.label || item.status;
}

function scoreTone(item: InboxItem): string {
  if (item.score >= 80) return "danger";
  if (item.score >= 60) return "attention";
  if (item.score >= 42) return "warning";
  return "default";
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inbox-property-row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function LabelPills({ item }: { item: InboxItem }) {
  if (!item.labels.length) return <span className="inbox-muted">None</span>;
  return (
    <div className="inbox-labels">
      {item.labels.map((label) => {
        const vars = getLabelCssVars(label.color);
        return (
          <span
            className={vars ? "inbox-label gh-label" : "inbox-label"}
            key={label.name}
            style={vars}
          >
            {label.name}
          </span>
        );
      })}
    </div>
  );
}

interface TriagePreviewProps {
  item: InboxItem | undefined;
  repo?: GhRepo;
  onRepoClick?: (repo: GhRepo) => void;
  onMarkRead?: (threadId: string) => void;
}

function TriagePreview({ item, repo, onRepoClick, onMarkRead }: TriagePreviewProps) {
  if (!item) {
    return (
      <section className="inbox-reader empty-reader">
        <div>
          <strong>No item selected</strong>
          <span>Select an issue or pull request from the list.</span>
        </div>
      </section>
    );
  }

  const handleOpen = () => {
    if (item.unread && item.notificationThreadId && onMarkRead) {
      onMarkRead(item.notificationThreadId);
    }
  };

  return (
    <section className="inbox-reader">
      <header className="inbox-reader-head">
        <div className="inbox-reader-from">
          <Avatar login={item.author?.login} avatarUrl={item.author?.avatarUrl} size={48} />
          <div className="inbox-reader-from-meta">
            <strong>{item.author?.login || "Unknown"}</strong>
            <span>
              {item.repository.nameWithOwner} · #{item.number} · {item.status}
            </span>
            <span className="inbox-reader-time">Updated {formatRelativeTime(item.updatedAt)}</span>
          </div>
          {item.unread ? <span className="inbox-unread-pill">Unread</span> : null}
        </div>
        <h2>{item.title}</h2>
        <div className="inbox-actions">
          <a className="btn primary" href={item.url} target="_blank" rel="noreferrer" onClick={handleOpen}>Open on GitHub</a>
          {item.unread && item.notificationThreadId && onMarkRead ? (
            <button className="btn" type="button" onClick={() => onMarkRead(item.notificationThreadId!)}>
              <CheckIcon /> Mark as read
            </button>
          ) : null}
          {repo && onRepoClick ? (
            <button className="btn" type="button" onClick={() => onRepoClick(repo)}>
              <BookIcon /> Repository
            </button>
          ) : null}
        </div>
      </header>

      <div className="inbox-reader-section">
        <h3>Why this needs attention</h3>
        <div className="inbox-reasons expanded">
          {item.reasons.map((itemReason) => (
            <span className={`inbox-reason tone-${itemReason.tone}`} key={`${item.id}-${itemReason.code}`}>
              {itemReason.label}
            </span>
          ))}
        </div>
      </div>

      <div className="inbox-reader-section">
        <h3>Context</h3>
        <div className="inbox-context-grid">
          <div>
            <span>Comments</span>
            <strong>{formatNumber(item.commentsCount)}</strong>
          </div>
          <div>
            <span>Attention score</span>
            <strong>{formatNumber(item.score)}</strong>
          </div>
          <div>
            <span>Created</span>
            <strong>{formatRelativeTime(item.createdAt)}</strong>
          </div>
          <div>
            <span>Updated</span>
            <strong>{formatRelativeTime(item.updatedAt)}</strong>
          </div>
        </div>
      </div>

      {item.branch || item.diff ? (
        <div className="inbox-reader-section">
          <h3>Pull request details</h3>
          <div className="inbox-pr-detail">
            {item.branch ? <span>{item.branch.head} {"->"} {item.branch.base}</span> : null}
            {item.diff ? (
              <span>
                +{formatNumber(item.diff.additions)} -{formatNumber(item.diff.deletions)} across {formatNumber(item.diff.changedFiles)} files
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TriageProperties({ item }: { item: InboxItem | undefined }) {
  return (
    <aside className="inbox-properties">
      <div className="inbox-properties-head">
        <strong>Properties</strong>
      </div>
      {item ? (
        <>
          <PropertyRow label="Type"><span className={`inbox-kind ${item.kind}`}>{kindLabel(item)}</span></PropertyRow>
          <PropertyRow label="Status">{item.status}</PropertyRow>
          <PropertyRow label="Score"><span className={`inbox-score tone-${scoreTone(item)}`}>{formatNumber(item.score)}</span></PropertyRow>
          <PropertyRow label="Repository">{item.repository.nameWithOwner}</PropertyRow>
          <PropertyRow label="Author">{item.author?.login || "Unknown"}</PropertyRow>
          <PropertyRow label="Assignees">{item.assignees.length ? item.assignees.map((assignee) => assignee.login).join(", ") : "None"}</PropertyRow>
          <PropertyRow label="Created">{new Date(item.createdAt).toLocaleDateString()}</PropertyRow>
          <PropertyRow label="Updated">{new Date(item.updatedAt).toLocaleDateString()}</PropertyRow>
          {item.branch ? <PropertyRow label="Branch">{item.branch.head} {"->"} {item.branch.base}</PropertyRow> : null}
          <div className="inbox-property-block">
            <span>Labels</span>
            <LabelPills item={item} />
          </div>
        </>
      ) : (
        <div className="inbox-properties-empty">Select an item to inspect its properties.</div>
      )}
    </aside>
  );
}

export function TriageWorkspace({
  items,
  title,
  emptyTitle,
  emptyMessage,
  reposByName,
  onRepoClick,
  sidebar,
  className = "",
  searchPlaceholder = "Search",
  onMarkRead,
  onRefresh,
  search: searchProp,
  onSearchChange,
  hideInternalSearch,
  page: pageProp,
  pageSize: pageSizeProp,
  onPageChange,
  onPageSizeChange,
}: TriageWorkspaceProps) {
  const [internalSearch, setInternalSearch] = useState("");
  const search = searchProp !== undefined ? searchProp : internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;
  const [selectedId, setSelectedId] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<Density>(() => readStoredDensity());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const filteredItems = useMemo(() => searchInboxItems(items, search), [items, search]);
  const paginated = pageSizeProp !== undefined && pageProp !== undefined;
  const safePage = paginated ? clampPage(pageProp!, filteredItems.length, pageSizeProp!) : 1;
  const visibleItems = useMemo(() => {
    if (!paginated) return filteredItems;
    return filteredItems.slice((safePage - 1) * pageSizeProp!, safePage * pageSizeProp!);
  }, [filteredItems, paginated, safePage, pageSizeProp]);
  const selectedItem = visibleItems.find((item) => item.id === selectedId) || visibleItems[0];
  const selectedRepo = selectedItem ? reposByName?.get(selectedItem.repository.nameWithOwner) : undefined;
  const checkedItems = useMemo(
    () => visibleItems.filter((item) => checked.has(item.id) && item.notificationThreadId && item.unread),
    [visibleItems, checked],
  );

  useEffect(() => {
    window.localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  useEffect(() => {
    if (!visibleItems.length) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!selectedId || !visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0].id);
    }
  }, [selectedId, visibleItems]);

  useEffect(() => {
    setChecked((prev) => {
      if (!prev.size) return prev;
      const visibleIds = new Set(visibleItems.map((entry) => entry.id));
      const next = new Set<string>();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleItems]);

  const focusRow = useCallback((id: string) => {
    const node = rowRefs.current.get(id);
    if (node) node.scrollIntoView({ block: "nearest" });
  }, []);

  const moveSelection = useCallback((delta: number) => {
    if (!visibleItems.length) return;
    const currentIndex = Math.max(0, visibleItems.findIndex((entry) => entry.id === (selectedItem?.id || "")));
    const nextIndex = Math.min(visibleItems.length - 1, Math.max(0, currentIndex + delta));
    const nextId = visibleItems[nextIndex].id;
    setSelectedId(nextId);
    focusRow(nextId);
  }, [visibleItems, selectedItem, focusRow]);

  const toggleCheck = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const checkAll = useCallback(() => {
    setChecked(new Set(visibleItems.map((item) => item.id)));
  }, [visibleItems]);

  const clearChecked = useCallback(() => setChecked(new Set()), []);

  const markChecked = useCallback(() => {
    if (!onMarkRead) return;
    for (const item of checkedItems) {
      if (item.notificationThreadId) onMarkRead(item.notificationThreadId);
    }
    clearChecked();
  }, [checkedItems, clearChecked, onMarkRead]);

  const markActive = useCallback(() => {
    if (!onMarkRead || !selectedItem?.notificationThreadId || !selectedItem.unread) return;
    onMarkRead(selectedItem.notificationThreadId);
  }, [onMarkRead, selectedItem]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (event.key === "Escape") {
        if (inEditable && target) (target as HTMLElement).blur();
        else if (checked.size) clearChecked();
        else setShortcutsOpen(false);
        return;
      }

      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (inEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j") { event.preventDefault(); moveSelection(1); return; }
      if (event.key === "k") { event.preventDefault(); moveSelection(-1); return; }
      if (event.key === "x" && selectedItem) { event.preventDefault(); toggleCheck(selectedItem.id); return; }
      if (event.key === "e") { event.preventDefault(); markActive(); return; }
      if (event.key === "Enter" && selectedItem) {
        event.preventDefault();
        if (selectedItem.unread && selectedItem.notificationThreadId && onMarkRead) {
          onMarkRead(selectedItem.notificationThreadId);
        }
        window.open(selectedItem.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (event.key === "?") { event.preventDefault(); setShortcutsOpen((prev) => !prev); return; }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [checked.size, clearChecked, markActive, moveSelection, onMarkRead, selectedItem, toggleCheck]);

  const cycleDensity = useCallback(() => {
    const idx = DENSITY_OPTIONS.indexOf(density);
    setDensity(DENSITY_OPTIONS[(idx + 1) % DENSITY_OPTIONS.length]);
  }, [density]);

  const allChecked = checked.size > 0 && checked.size === visibleItems.length;
  const partiallyChecked = checked.size > 0 && !allChecked;

  return (
    <div className={`triage-workspace ${sidebar ? "with-mailboxes" : "embedded"} ${className}`} data-density={density}>
      {sidebar}

      <section className="inbox-list-pane">
        <header className="inbox-list-head">
          <div className="inbox-list-title">
            <strong>{title}</strong>
            <span>{formatNumber(visibleItems.length)} items</span>
          </div>
          {hideInternalSearch ? null : (
            <label className="inbox-search">
              <SearchIcon />
              <input
                ref={searchInputRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
              />
            </label>
          )}
          <div className="inbox-toolbar">
            <label className="inbox-checkbox" title="Select all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(node) => { if (node) node.indeterminate = partiallyChecked; }}
                onChange={(event) => (event.target.checked ? checkAll() : clearChecked())}
              />
            </label>
            {checked.size ? (
              <>
                <span className="inbox-toolbar-count">{checked.size} selected</span>
                {checkedItems.length && onMarkRead ? (
                  <button className="btn ghost" type="button" onClick={markChecked}>
                    <CheckIcon /> Mark {checkedItems.length} as read
                  </button>
                ) : null}
                <button className="btn ghost" type="button" onClick={clearChecked}>Clear</button>
              </>
            ) : (
              <span className="inbox-toolbar-count muted">Tip: press <kbd>?</kbd> for shortcuts</span>
            )}
            <span className="inbox-toolbar-spacer" />
            {onRefresh ? (
              <button className="icon-btn" type="button" onClick={onRefresh} title="Refresh">
                <RefreshIcon />
              </button>
            ) : null}
            <button className="icon-btn" type="button" onClick={cycleDensity} title={`Density: ${density}`}>
              <DensityIcon />
            </button>
            <button className="icon-btn" type="button" onClick={() => setShortcutsOpen((prev) => !prev)} title="Shortcuts">
              <KeyboardIcon />
            </button>
          </div>
        </header>
        <div className="inbox-list">
          {visibleItems.length ? visibleItems.map((item) => {
            const isSelected = selectedItem?.id === item.id;
            const isChecked = checked.has(item.id);
            return (
              <div
                className={`inbox-row ${isSelected ? "selected" : ""} ${item.unread ? "unread" : ""} ${isChecked ? "checked" : ""}`}
                key={item.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(item.id, node);
                  else rowRefs.current.delete(item.id);
                }}
                onClick={() => setSelectedId(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(item.id);
                  }
                }}
              >
                <label
                  className="inbox-row-check"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleCheck(item.id)}
                  />
                </label>
                <span className="inbox-row-indicator" aria-hidden="true">
                  {item.unread ? <span className="inbox-row-dot" /> : null}
                </span>
                <Avatar login={item.author?.login} avatarUrl={item.author?.avatarUrl} size={density === "compact" ? 28 : 36} />
                <div className="inbox-row-body">
                  <div className="inbox-row-top">
                    <strong className="inbox-row-author">{item.author?.login || "Unknown"}</strong>
                    <span className="inbox-row-repo">{item.repository.nameWithOwner}</span>
                    <span className="inbox-row-num">#{item.number}</span>
                    <em>{formatRelativeTime(item.updatedAt)}</em>
                  </div>
                  <div className="inbox-row-title">{item.title}</div>
                  {density !== "compact" ? (
                    <div className="inbox-row-meta">
                      <span className={`inbox-kind ${item.kind}`}>
                        {item.kind === "pull-request" ? <PulseIcon /> : <IssueIcon />}
                        {kindLabel(item)}
                      </span>
                      <span className="inbox-row-summary">{primaryReason(item)}</span>
                      <span className="inbox-row-comments">{formatNumber(item.commentsCount)} comments</span>
                    </div>
                  ) : null}
                </div>
                <span className={`inbox-row-priority tone-${scoreTone(item)}`} aria-hidden="true" />
              </div>
            );
          }) : (
            <div className="inbox-list-empty">
              <strong>{emptyTitle}</strong>
              <span>{emptyMessage}</span>
            </div>
          )}
        </div>
        {paginated && filteredItems.length > pageSizeProp! ? (
          <div className="inbox-list-pagination">
            <Pagination
              totalItems={filteredItems.length}
              page={safePage}
              pageSize={pageSizeProp!}
              onPageChange={onPageChange ?? (() => {})}
              onPageSizeChange={onPageSizeChange ?? (() => {})}
              showPageSize={false}
            />
          </div>
        ) : null}
      </section>

      <TriagePreview item={selectedItem} repo={selectedRepo} onRepoClick={onRepoClick} onMarkRead={onMarkRead} />
      <TriageProperties item={selectedItem} />

      {shortcutsOpen ? (
        <div className="inbox-shortcuts" role="dialog" onClick={() => setShortcutsOpen(false)}>
          <div className="inbox-shortcuts-card" onClick={(event) => event.stopPropagation()}>
            <strong>Keyboard shortcuts</strong>
            <dl>
              <div><dt><kbd>j</kbd> / <kbd>k</kbd></dt><dd>Next / previous item</dd></div>
              <div><dt><kbd>Enter</kbd></dt><dd>Open on GitHub</dd></div>
              <div><dt><kbd>e</kbd></dt><dd>Mark active as read</dd></div>
              <div><dt><kbd>x</kbd></dt><dd>Toggle selection</dd></div>
              <div><dt><kbd>/</kbd></dt><dd>Focus search</dd></div>
              <div><dt><kbd>Esc</kbd></dt><dd>Clear selection / blur search</dd></div>
              <div><dt><kbd>?</kbd></dt><dd>Toggle this help</dd></div>
            </dl>
            <button className="btn" type="button" onClick={() => setShortcutsOpen(false)}>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
