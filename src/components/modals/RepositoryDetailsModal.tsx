import { useEffect, useState } from "react";
import {
  addRepoAlias,
  fetchDependents,
  fetchForks,
  fetchMentionCode,
  fetchMentionIssues,
  fetchRepoDetails,
  fetchRepoTraffic,
  removeRepoAlias,
} from "../../api/github";
import type { DependentItem, ForkNode, GhIssue, GhPullRequest, GhRepo, MentionCodeItem, MentionIssueItem, RepoDetailsData, RepoTrafficDetails } from "../../types/github";
import { issueCountForRepo } from "../../utils/dashboard";
import { getLanguageColor } from "../../utils/colors";
import { buildDailyRepoDigestMarkdown } from "../../utils/digests";
import { isValidRepoName } from "../../utils/aliasQuery";
import { formatBytes, formatNumber, formatRelativeTime } from "../../utils/format";
import { clampPage } from "../../utils/pagination";
import { Pagination } from "../common/Pagination";
import { CloseIcon, ForkIcon, IssueIcon, RefreshIcon, StarIcon } from "../common/Icons";

interface RepositoryDetailsModalProps {
  repo: GhRepo;
  issues: GhIssue[];
  pullRequests: GhPullRequest[];
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
  onIssuesClick: (repo: string) => void;
}

export type DetailTab = "overview" | "actions" | "pull-requests" | "issues" | "releases" | "forks" | "traffic" | "mentions" | "dependents";

type ReleaseFilter = "all" | "stable" | "prerelease" | "draft";

const MODAL_PAGE_SIZE = 10;

function historyDelta(repo: GhRepo, field: "stars" | "forks") {
  const history = repo.history || [];
  if (history.length < 2) return null;
  return history[history.length - 1][field] - history[0][field];
}

function formatReleaseDate(iso: string | null | undefined) {
  if (!iso) return "Unpublished";
  return new Date(iso).toLocaleDateString();
}

function chartPath(values: number[], width: number, height: number) {
  if (values.length < 2) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function MiniChart({ title, values, tone = "accent" }: { title: string; values: number[]; tone?: "accent" | "purple" | "green" | "amber" }) {
  const width = 240;
  const height = 72;
  const path = chartPath(values, width, height);
  const latest = values.at(-1) ?? 0;
  const first = values[0] ?? latest;
  const delta = latest - first;

  return (
    <div className={`repo-chart tone-${tone}`}>
      <div className="repo-chart-head">
        <span>{title}</span>
        <strong>{formatNumber(latest)}</strong>
      </div>
      {path ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <path className="repo-chart-baseline" d={`M 0 ${height - 1} H ${width}`} />
          <path className="repo-chart-line" d={path} />
        </svg>
      ) : (
        <div className="repo-chart-empty">Not enough data</div>
      )}
      <em>{delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${formatNumber(delta)} in range`}</em>
    </div>
  );
}

export function RepositoryDetailsModal({ repo, issues, pullRequests, activeTab, onTabChange, onClose, onIssuesClick }: RepositoryDetailsModalProps) {
  const [details, setDetails] = useState<RepoDetailsData | null>(null);
  const [mentionIssues, setMentionIssues] = useState<MentionIssueItem[]>([]);
  const [mentionCode, setMentionCode] = useState<MentionCodeItem[]>([]);
  const [dependents, setDependents] = useState<DependentItem[]>([]);
  const [trafficDetails, setTrafficDetails] = useState<RepoTrafficDetails | null>(null);
  const [contributorsPage, setContributorsPage] = useState(1);
  const [mentionsPage, setMentionsPage] = useState(1);
  const [mentionsPageSize, setMentionsPageSize] = useState(MODAL_PAGE_SIZE);
  const [actionsPage, setActionsPage] = useState(1);
  const [actionsPageSize, setActionsPageSize] = useState(MODAL_PAGE_SIZE);
  const [dependentsPage, setDependentsPage] = useState(1);
  const [dependentsPageSize, setDependentsPageSize] = useState(MODAL_PAGE_SIZE);
  const [repoIssuesPage, setRepoIssuesPage] = useState(1);
  const [repoIssuesPageSize, setRepoIssuesPageSize] = useState(MODAL_PAGE_SIZE);
  const [repoPrsPage, setRepoPrsPage] = useState(1);
  const [repoPrsPageSize, setRepoPrsPageSize] = useState(MODAL_PAGE_SIZE);
  const [releasesPage, setReleasesPage] = useState(1);
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");
  const [openReleaseIds, setOpenReleaseIds] = useState<number[]>([]);
  const [forks, setForks] = useState<ForkNode[]>([]);
  const [forksTotal, setForksTotal] = useState(0);
  const [forksPage, setForksPage] = useState(1);
  const [forksPageSize, setForksPageSize] = useState(MODAL_PAGE_SIZE);
  const [forkField, setForkField] = useState("PUSHED_AT");
  const [forkDirection, setForkDirection] = useState<"DESC" | "ASC">("DESC");
  const [forksLoading, setForksLoading] = useState(false);
  const [forksError, setForksError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState("");
  const [aliasError, setAliasError] = useState("");
  const [aliasBusy, setAliasBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDetails() {
      setLoading(true);
      setError("");
      try {
        const [detailsResult, issueRefs, codeRefs, dependentRefs, trafficResult] = await Promise.all([
          fetchRepoDetails(repo.nameWithOwner),
          fetchMentionIssues(repo.nameWithOwner),
          fetchMentionCode(repo.nameWithOwner),
          fetchDependents(repo.nameWithOwner),
          fetchRepoTraffic(repo.nameWithOwner),
        ]);
        if (!cancelled) {
          setDetails(detailsResult);
          setMentionIssues(issueRefs.items);
          setMentionCode(codeRefs.items);
          setAliases(issueRefs.aliases ?? []);
          setDependents(dependentRefs.items);
          setTrafficDetails(trafficResult);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [repo.nameWithOwner, refreshKey]);

  useEffect(() => {
    setContributorsPage(1);
    setMentionsPage(1);
    setActionsPage(1);
    setDependentsPage(1);
    setRepoIssuesPage(1);
    setRepoPrsPage(1);
    setReleasesPage(1);
    setReleaseFilter("all");
    setForksPage(1);
    setOpenReleaseIds([]);
  }, [repo.nameWithOwner]);

  useEffect(() => {
    if (activeTab !== "forks") return;
    let cancelled = false;
    setForksLoading(true);
    setForksError("");
    void fetchForks({ repo: repo.nameWithOwner, field: forkField, direction: forkDirection })
      .then((result) => {
        if (cancelled) return;
        setForks(result.nodes);
        setForksTotal(result.totalCount);
        setForksPage(1);
      })
      .catch((err) => {
        if (!cancelled) setForksError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setForksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, forkDirection, forkField, repo.nameWithOwner, refreshKey]);

  function toggleRelease(releaseId: number) {
    setOpenReleaseIds((current) =>
      current.includes(releaseId) ? current.filter((id) => id !== releaseId) : [...current, releaseId]
    );
  }

  async function copyRepoDigest() {
    if (!details?.digest) return;
    await navigator.clipboard.writeText(buildDailyRepoDigestMarkdown(details.digest));
  }

  async function submitAlias() {
    const value = aliasInput.trim();
    if (!isValidRepoName(value)) {
      setAliasError("Use the owner/repo format.");
      return;
    }
    if (value === repo.nameWithOwner) {
      setAliasError("Alias cannot be the current repository name.");
      return;
    }
    setAliasBusy(true);
    setAliasError("");
    try {
      const result = await addRepoAlias(repo.nameWithOwner, value);
      setAliases(result.aliases);
      setAliasInput("");
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setAliasError((err as Error).message);
    } finally {
      setAliasBusy(false);
    }
  }

  async function deleteAlias(alias: string) {
    setAliasBusy(true);
    setAliasError("");
    try {
      const result = await removeRepoAlias(repo.nameWithOwner, alias);
      setAliases(result.aliases);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setAliasError((err as Error).message);
    } finally {
      setAliasBusy(false);
    }
  }

  const repoIssues = issues.filter((issue) => issue.repository.nameWithOwner === repo.nameWithOwner);
  const repoPullRequests = pullRequests.filter((pr) => pr.repository.nameWithOwner === repo.nameWithOwner);
  const language = repo.primaryLanguage?.name || "";
  const starsDelta = historyDelta(repo, "stars");
  const forksDelta = historyDelta(repo, "forks");
  const description = details?.meta?.description ?? repo.description ?? "No description";
  const contributors = details?.contributors || [];
  const topics = details?.meta?.topics || [];
  const languages = Object.entries(details?.languages || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const views = details?.views ?? null;
  const clones = trafficDetails?.clones ?? null;
  const releases = details?.releases ?? [];
  const workflows = details?.workflows ?? [];
  const security = details?.security ?? null;
  const totalReleaseDownloads = releases.reduce((sum, release) => sum + release.totalDownloads, 0);
  const stableReleases = releases.filter((release) => !release.prerelease && !release.draft);
  const preReleases = releases.filter((release) => release.prerelease && !release.draft);
  const draftReleases = releases.filter((release) => release.draft);
  const filteredReleases = releaseFilter === "stable"
    ? stableReleases
    : releaseFilter === "prerelease"
      ? preReleases
      : releaseFilter === "draft"
        ? draftReleases
        : releases;
  const releaseFilters: { key: ReleaseFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: releases.length },
    { key: "stable", label: "Releases", count: stableReleases.length },
    { key: "prerelease", label: "Pre-releases", count: preReleases.length },
    { key: "draft", label: "Drafts", count: draftReleases.length },
  ];
  const repoDigest = details?.digest ?? null;
  const releasesPageSize = 10;
  const referrers = trafficDetails?.referrers ?? [];
  const popularPaths = trafficDetails?.paths ?? [];
  const trafficForbidden = trafficDetails?.forbidden ?? false;
  const mentionItems = [
    ...mentionIssues.map((item) => ({ kind: "issue" as const, key: item.url, item })),
    ...mentionCode.map((item) => ({ kind: "code" as const, key: item.url, item })),
  ];
  const safeContributorsPage = clampPage(contributorsPage, contributors.length, MODAL_PAGE_SIZE);
  const safeMentionsPage = clampPage(mentionsPage, mentionItems.length, mentionsPageSize);
  const safeActionsPage = clampPage(actionsPage, workflows.length, actionsPageSize);
  const safeDependentsPage = clampPage(dependentsPage, dependents.length, dependentsPageSize);
  const safeRepoIssuesPage = clampPage(repoIssuesPage, repoIssues.length, repoIssuesPageSize);
  const safeRepoPrsPage = clampPage(repoPrsPage, repoPullRequests.length, repoPrsPageSize);
  const safeReleasesPage = clampPage(releasesPage, filteredReleases.length, releasesPageSize);
  const safeForksPage = clampPage(forksPage, forks.length, forksPageSize);
  const pagedContributors = contributors.slice((safeContributorsPage - 1) * MODAL_PAGE_SIZE, safeContributorsPage * MODAL_PAGE_SIZE);
  const pagedMentionItems = mentionItems.slice((safeMentionsPage - 1) * mentionsPageSize, safeMentionsPage * mentionsPageSize);
  const pagedWorkflows = workflows.slice((safeActionsPage - 1) * actionsPageSize, safeActionsPage * actionsPageSize);
  const pagedDependents = dependents.slice((safeDependentsPage - 1) * dependentsPageSize, safeDependentsPage * dependentsPageSize);
  const pagedRepoIssues = repoIssues.slice((safeRepoIssuesPage - 1) * repoIssuesPageSize, safeRepoIssuesPage * repoIssuesPageSize);
  const pagedRepoPrs = repoPullRequests.slice((safeRepoPrsPage - 1) * repoPrsPageSize, safeRepoPrsPage * repoPrsPageSize);
  const pagedReleases = filteredReleases.slice((safeReleasesPage - 1) * releasesPageSize, safeReleasesPage * releasesPageSize);
  const pagedForks = forks.slice((safeForksPage - 1) * forksPageSize, safeForksPage * forksPageSize);
  const starHistory = (repo.history || []).map((entry) => entry.stars);
  const forkHistory = (repo.history || []).map((entry) => entry.forks);
  const viewHistory = (views?.views || []).map((entry) => entry.count);
  const cloneHistory = (clones?.clones || []).map((entry) => entry.count);
  const detailTabs = [
    { key: "overview" as const, label: "Overview", count: contributors.length + languages.length + (repoDigest ? 1 : 0) },
    { key: "actions" as const, label: "Actions", count: workflows.length },
    { key: "pull-requests" as const, label: "PRs", count: repoPullRequests.length },
    { key: "issues" as const, label: "Issues", count: repoIssues.length },
    { key: "releases" as const, label: "Releases", count: releases.length },
    { key: "forks" as const, label: "Forks", count: forksTotal || repo.forkCount },
    { key: "traffic" as const, label: "Traffic", count: referrers.length + popularPaths.length },
    { key: "mentions" as const, label: "Mentions", count: mentionItems.length + aliases.length },
    { key: "dependents" as const, label: "Dependents", count: dependents.length },
  ];

  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal repo-detail-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-icon repository">R</span>
            <div style={{ minWidth: 0 }}>
              <div className="kind">Repository</div>
              <h3>{repo.nameWithOwner}</h3>
            </div>
          </div>
          <div className="modal-head-actions">
            <button
              className={`modal-close modal-refresh ${loading ? "refreshing" : ""}`}
              aria-label="Reload repository data"
              title="Reload repository data"
              disabled={loading}
              onClick={() => setRefreshKey((value) => value + 1)}
            ><RefreshIcon /></button>
            <button className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon /></button>
          </div>
        </header>

        <div className="modal-body repo-detail-body">
          {error ? <div className="modal-error">{error}</div> : null}
          <section className="repo-detail-summary">
            <div className="repo-detail-title-row">
              <a className="repo-detail-title" href={repo.url} target="_blank" rel="noreferrer">{repo.nameWithOwner}</a>
              <div className="repo-badges">
                {repo.isPrivate ? <span className="rb private">Private</span> : <span className="rb">Public</span>}
                {repo.isArchived ? <span className="rb archived">Archived</span> : null}
                {repo.isFork ? <span className="rb fork">Fork</span> : null}
              </div>
            </div>
            <p>{description}</p>
            {topics.length ? <div className="repo-detail-topics">{topics.slice(0, 8).map((topic) => <span key={topic}>{topic}</span>)}</div> : null}
          </section>

          <section className="repo-detail-stats" aria-label="Repository stats">
            <div className="repo-detail-stat"><StarIcon /><span>Stars</span><strong>{formatNumber(repo.stargazerCount)}</strong></div>
            <div className="repo-detail-stat"><ForkIcon /><span>Forks</span><strong>{formatNumber(repo.forkCount)}</strong></div>
            <button className="repo-detail-stat action" onClick={() => onIssuesClick(repo.nameWithOwner)}><IssueIcon /><span>Open issues</span><strong>{formatNumber(issueCountForRepo(issues, repo.nameWithOwner))}</strong></button>
          </section>

          <section className="repo-detail-grid">
            <div><div className="repo-detail-label">Owner</div><div className="repo-detail-value">{repo.owner.login}</div></div>
            <div>
              <div className="repo-detail-label">Language</div>
              <div className="repo-detail-value">{language ? <><span className="lang-dot" style={{ background: getLanguageColor(language) }} />{language}</> : "None"}</div>
            </div>
            <div><div className="repo-detail-label">Last push</div><div className="repo-detail-value" title={new Date(repo.pushedAt).toLocaleString()}>{formatRelativeTime(repo.pushedAt)}</div></div>
            <div><div className="repo-detail-label">Last update</div><div className="repo-detail-value" title={new Date(repo.updatedAt).toLocaleString()}>{formatRelativeTime(repo.updatedAt)}</div></div>
            {details?.meta?.license?.name ? <div><div className="repo-detail-label">License</div><div className="repo-detail-value">{details.meta.license.name}</div></div> : null}
            {details?.meta?.default_branch ? <div><div className="repo-detail-label">Default branch</div><div className="repo-detail-value">{details.meta.default_branch}</div></div> : null}
          </section>

          <nav className="repo-detail-tabs" aria-label="Repository detail sections">
            {detailTabs.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`repo-detail-tab ${activeTab === item.key ? "active" : ""}`}
                aria-current={activeTab === item.key ? "page" : undefined}
                onClick={() => onTabChange(item.key)}
              >
                <span>{item.label}</span>
                <strong>{loading && item.key !== "overview" && item.count === 0 ? "..." : formatNumber(item.count)}</strong>
              </button>
            ))}
          </nav>

          {activeTab === "overview" && repoDigest ? (
            <section>
              <div className="modal-section-title section-title-with-count">
                <span>Daily repo digest</span>
                <strong>{repoDigest.date}</strong>
              </div>
              <div className="repo-detail-digest">
                <div className="repo-detail-digest-head">
                  <div className="repo-detail-digest-badges">
                    <span>★ {repoDigest.starsDelta >= 0 ? "+" : ""}{formatNumber(repoDigest.starsDelta)}</span>
                    <span>forks {repoDigest.forksDelta >= 0 ? "+" : ""}{formatNumber(repoDigest.forksDelta)}</span>
                    <span>issues {repoDigest.issueDelta >= 0 ? "+" : ""}{formatNumber(repoDigest.issueDelta)}</span>
                  </div>
                  <button type="button" className="digest-copy-btn" onClick={() => void copyRepoDigest()}>Copy Markdown</button>
                </div>
                {repoDigest.ai ? (
                  <div className="digest-ai-block">
                    <div className="digest-ai-head">
                      <strong>{repoDigest.ai.headline}</strong>
                      <span>{repoDigest.ai.model}</span>
                    </div>
                    <div className="digest-ai-briefing">
                      {repoDigest.ai.briefing.map((item) => <p key={item}>{item}</p>)}
                    </div>
                  </div>
                ) : null}
                <div className="digest-pill-groups">
                  <div className="digest-pill-group">
                    <h4>Executive Summary</h4>
                    {repoDigest.executiveSummary.map((item) => <span key={item}>{item}</span>)}
                  </div>
                  {repoDigest.momentum.length ? (
                    <div className="digest-pill-group positive">
                      <h4>Momentum</h4>
                      {repoDigest.momentum.map((item) => <span key={item}>{item}</span>)}
                    </div>
                  ) : null}
                  {repoDigest.risks.length ? (
                    <div className="digest-pill-group risk">
                      <h4>Risks</h4>
                      {repoDigest.risks.map((item) => <span key={item}>{item}</span>)}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "overview" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Contributors</span>
              <strong>{loading && !contributors.length ? "..." : formatNumber(contributors.length)}</strong>
            </div>
            {loading && !contributors.length ? <div className="modal-empty sub">Loading contributors...</div> : null}
            {contributors.length ? (
              <div className="repo-detail-contributors">
                {pagedContributors.map((person, index) => {
                  const name = person.login || person.name || person.email || "Anonymous";
                  return (
                  <a href={person.html_url || person.url} target="_blank" rel="noreferrer" key={`${name}-${index}`}>
                    {person.avatar_url || person.avatarUrl ? <img src={person.avatar_url || person.avatarUrl} alt="" /> : <span className="repo-detail-avatar-fallback">{name.slice(0, 1).toUpperCase()}</span>}
                    <span>{name}</span>
                    <em>{formatNumber(person.contributions)}</em>
                  </a>
                  );
                })}
                </div>
            ) : !loading ? <div className="modal-empty sub">No contributors available.</div> : null}
            {contributors.length ? (
              <Pagination
                totalItems={contributors.length}
                page={safeContributorsPage}
                pageSize={MODAL_PAGE_SIZE}
                onPageChange={setContributorsPage}
                onPageSizeChange={() => {}}
                showPageSize={false}
              />
            ) : null}
          </section> : null}

          {activeTab === "overview" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Security and quality</span>
              <strong>{security ? formatNumber(security.totalOpen) : "..."}</strong>
            </div>
            <div className="repo-detail-traffic-grid">
              <div className="repo-detail-traffic-card">
                <span className="repo-detail-traffic-label">Dependabot alerts</span>
                <strong>{security ? formatNumber(security.dependabotOpen) : "..."}</strong>
                <em>
                  {security
                    ? (security.dependabotOpen ? "Open dependency advisories." : "No open dependency alerts.")
                    : "Loading security data..."}
                </em>
              </div>
              <div className="repo-detail-traffic-card">
                <span className="repo-detail-traffic-label">Code scanning alerts</span>
                <strong>{security ? formatNumber(security.codeScanningOpen) : "..."}</strong>
                <em>
                  {security
                    ? (security.codeScanningOpen ? "Open code scanning findings." : "No open code scanning alerts.")
                    : "Loading security data..."}
                </em>
              </div>
            </div>
            {security?.latestUpdatedAt ? (
              <div className="modal-info-banner">
                Last security update {formatRelativeTime(security.latestUpdatedAt)}
              </div>
            ) : null}
            {security?.unavailable ? (
              <div className="modal-info-banner">
                Security alerts are not fully available with the current permissions or repository settings.
              </div>
            ) : null}
          </section> : null}

          {activeTab === "overview" && languages.length ? (
            <section>
              <div className="modal-section-title">Languages</div>
              <div className="repo-detail-languages">
                {languages.map(([name, bytes]) => <span key={name}><i style={{ background: getLanguageColor(name) }} />{name}<em>{formatNumber(bytes)}</em></span>)}
              </div>
            </section>
          ) : null}

          {activeTab === "overview" ? (
            <section>
              <div className="modal-section-title">Repository trend</div>
              <div className="repo-chart-grid">
                <MiniChart title="Stars" values={starHistory} tone="amber" />
                <MiniChart title="Forks" values={forkHistory} tone="purple" />
              </div>
            </section>
          ) : null}

          {activeTab === "mentions" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Previous names</span>
              <strong>{formatNumber(aliases.length)}</strong>
            </div>
            <p className="modal-empty sub" style={{ marginTop: 0 }}>
              Add owner/repo names this project used to be known by; mentions will include matches against them.
            </p>
            {aliases.length ? (
              <div className="repo-alias-list">
                {aliases.map((alias) => (
                  <span className="repo-alias-chip" key={alias}>
                    <code>{alias}</code>
                    <button
                      type="button"
                      aria-label={`Remove alias ${alias}`}
                      disabled={aliasBusy}
                      onClick={() => void deleteAlias(alias)}
                    >×</button>
                  </span>
                ))}
              </div>
            ) : null}
            <form
              className="repo-alias-form"
              onSubmit={(event) => { event.preventDefault(); void submitAlias(); }}
            >
              <input
                type="text"
                placeholder="owner/old-name"
                value={aliasInput}
                onChange={(event) => setAliasInput(event.target.value)}
                disabled={aliasBusy}
                spellCheck={false}
              />
              <button type="submit" disabled={aliasBusy || !aliasInput.trim()}>Add</button>
            </form>
            {aliasError ? <div className="modal-error" style={{ marginTop: 8 }}>{aliasError}</div> : null}
          </section> : null}

          {activeTab === "mentions" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Mentions from other repositories</span>
              <strong>{loading && !mentionItems.length ? "..." : formatNumber(mentionItems.length)}</strong>
            </div>
            {pagedMentionItems.map((entry) => entry.kind === "issue" ? (
              <a className="mention-row compact" href={entry.item.url} target="_blank" rel="noreferrer" key={entry.key}>
                <span className={`mr-icon ${entry.item.isPullRequest ? "pr-open" : "issue-open"}`}>{entry.item.isPullRequest ? "PR" : "I"}</span>
                <span className="mr-main"><strong>{entry.item.title}</strong><em>{entry.item.repository.nameWithOwner} #{entry.item.number} · {formatRelativeTime(entry.item.updatedAt)}</em></span>
              </a>
            ) : (
              <a className="mention-row compact" href={entry.item.url} target="_blank" rel="noreferrer" key={entry.key}>
                <span className="mr-icon code">C</span>
                <span className="mr-main"><strong>{entry.item.path}</strong><em>{entry.item.repository.nameWithOwner}</em></span>
              </a>
            ))}
            {!loading && !mentionItems.length ? <div className="modal-empty sub">No external mentions found.</div> : null}
            {mentionItems.length ? (
              <Pagination
                totalItems={mentionItems.length}
                page={safeMentionsPage}
                pageSize={mentionsPageSize}
                onPageChange={setMentionsPage}
                onPageSizeChange={(size) => {
                  setMentionsPageSize(size);
                  setMentionsPage(1);
                }}
                showPageSize={false}
              />
            ) : null}
          </section> : null}

          {activeTab === "actions" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>GitHub Actions history</span>
              <strong>{loading && !workflows.length ? "..." : formatNumber(workflows.length)}</strong>
            </div>
            {pagedWorkflows.map((run) => {
              const state = run.conclusion || run.status;
              const startedAt = run.run_started_at || run.created_at || run.updated_at;
              return (
                <a className="wf-row repo-actions-row" href={run.html_url} target="_blank" rel="noreferrer" key={run.id}>
                  <span className={`wf-status ${state || "neutral"}`} aria-hidden="true" />
                  <span className="wf-main">
                    <span className="wf-title">{run.display_title || run.name || `Run #${run.run_number}`}</span>
                    <span className="wf-meta">
                      <span>{run.name || "Workflow"}</span>
                      <span className="wf-branch">{run.head_branch || "default"}</span>
                      <span>{run.event}</span>
                      <span>#{run.run_number}</span>
                    </span>
                  </span>
                  <span className="wf-time">{state || "unknown"} · {formatRelativeTime(startedAt)}</span>
                </a>
              );
            })}
            {loading && !workflows.length ? <div className="modal-empty sub">Loading workflow runs...</div> : null}
            {!loading && !workflows.length ? <div className="modal-empty sub">No workflow runs available.</div> : null}
            {workflows.length ? (
              <Pagination
                totalItems={workflows.length}
                page={safeActionsPage}
                pageSize={actionsPageSize}
                onPageChange={setActionsPage}
                onPageSizeChange={(size) => {
                  setActionsPageSize(size);
                  setActionsPage(1);
                }}
                showPageSize={false}
              />
            ) : null}
          </section> : null}

          {activeTab === "traffic" ? <section>
            <div className="modal-section-title">Traffic</div>
            <div className="repo-detail-traffic-grid">
              <div className="repo-detail-traffic-card">
                <span className="repo-detail-traffic-label">Views (last 14 days)</span>
                <strong>{views ? formatNumber(views.count) : "n/a"}</strong>
                <em>{views ? `${formatNumber(views.uniques)} unique visitors` : "Traffic data may require admin access."}</em>
              </div>
              <div className="repo-detail-traffic-card">
                <span className="repo-detail-traffic-label">Clones (last 14 days)</span>
                <strong>{clones ? formatNumber(clones.count) : "n/a"}</strong>
                <em>{clones ? `${formatNumber(clones.uniques)} unique cloners` : "Clone data may require admin access."}</em>
              </div>
            </div>
            <div className="repo-chart-grid">
              <MiniChart title="Views" values={viewHistory} />
              <MiniChart title="Clones" values={cloneHistory} tone="green" />
            </div>
            {trafficForbidden ? (
              <div className="modal-info-banner">
                Traffic breakdown is not available for this repository with the current GitHub permissions.
              </div>
            ) : null}
            {referrers.length ? (
              <>
                <div className="modal-section-title">Top referrers</div>
                <div className="repo-detail-traffic-list">
                  {referrers.map((referrer) => (
                    <div className="repo-detail-traffic-row" key={referrer.referrer}>
                      <strong>{referrer.referrer}</strong>
                      <span>{formatNumber(referrer.count)} views</span>
                      <em>{formatNumber(referrer.uniques)} unique</em>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {popularPaths.length ? (
              <>
                <div className="modal-section-title">Popular pages</div>
                <div className="repo-detail-traffic-list">
                  {popularPaths.map((path) => (
                    <div className="repo-detail-traffic-row" key={path.path}>
                      <strong title={path.path}>{path.title || path.path}</strong>
                      <span>{formatNumber(path.count)} views</span>
                      <em>{formatNumber(path.uniques)} unique</em>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </section> : null}

          {activeTab === "releases" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Releases</span>
              <strong>{formatNumber(releases.length)}</strong>
            </div>
            <div className="repo-detail-traffic-grid">
              <div className="repo-detail-traffic-card">
                <span className="repo-detail-traffic-label">Release downloads</span>
                <strong>{formatNumber(totalReleaseDownloads)}</strong>
                <em>{releases.length ? `${formatNumber(releases.length)} total releases` : "No releases found."}</em>
              </div>
              <div className="repo-detail-traffic-card">
                <span className="repo-detail-traffic-label">Latest release</span>
                <strong>{(stableReleases[0] ?? releases[0])?.tag_name || "n/a"}</strong>
                <em>{(stableReleases[0] ?? releases[0]) ? formatReleaseDate((stableReleases[0] ?? releases[0]).published_at) : "No release published."}</em>
              </div>
            </div>
            {releases.length ? (
              <div className="repo-detail-release-filters" role="group" aria-label="Filter releases by type">
                {releaseFilters.filter((item) => item.key === "all" || item.count > 0).map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={releaseFilter === item.key ? "active" : ""}
                    onClick={() => {
                      setReleaseFilter(item.key);
                      setReleasesPage(1);
                    }}
                  >
                    <span>{item.label}</span>
                    <strong>{formatNumber(item.count)}</strong>
                  </button>
                ))}
              </div>
            ) : null}
            {filteredReleases.length ? (
              <div className="repo-detail-releases">
                {pagedReleases.map((release) => (
                  <div className="repo-detail-release" key={release.id}>
                    <button
                      className={`repo-detail-release-head ${openReleaseIds.includes(release.id) ? "open" : ""}`}
                      type="button"
                      onClick={() => toggleRelease(release.id)}
                      aria-expanded={openReleaseIds.includes(release.id)}
                    >
                      <div>
                        <span className="repo-detail-release-title">
                          <strong>{release.name || release.tag_name}</strong>
                          {release.draft ? <span className="rb draft">Draft</span> : release.prerelease ? <span className="rb prerelease">Pre-release</span> : null}
                        </span>
                        <span>{release.tag_name} · {formatReleaseDate(release.published_at)}</span>
                      </div>
                      <span>{formatNumber(release.totalDownloads)} downloads</span>
                    </button>
                    {openReleaseIds.includes(release.id) ? (
                      release.assets.length ? (
                        <div className="repo-detail-release-assets">
                          <a className="repo-detail-release-link" href={release.html_url} target="_blank" rel="noreferrer">
                            <span>Open release on GitHub</span>
                            <em>{release.tag_name}</em>
                          </a>
                          {release.assets.map((asset) => (
                            <a href={asset.browser_download_url || release.html_url} target="_blank" rel="noreferrer" key={asset.id}>
                              <span>{asset.name}</span>
                              <em>{formatNumber(asset.download_count)} downloads · {formatBytes(asset.size || 0)}</em>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="repo-detail-release-assets">
                          <a className="repo-detail-release-link" href={release.html_url} target="_blank" rel="noreferrer">
                            <span>Open release on GitHub</span>
                            <em>{release.tag_name}</em>
                          </a>
                          <div className="modal-empty sub">No assets attached to this release.</div>
                        </div>
                      )
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {!loading && !releases.length ? <div className="modal-empty sub">No releases available.</div> : null}
            {!loading && releases.length && !filteredReleases.length ? <div className="modal-empty sub">No releases in this category.</div> : null}
            {filteredReleases.length ? (
              <Pagination
                totalItems={filteredReleases.length}
                page={safeReleasesPage}
                pageSize={releasesPageSize}
                onPageChange={setReleasesPage}
                onPageSizeChange={() => {}}
                showPageSize={false}
              />
            ) : null}
          </section> : null}

          {activeTab === "pull-requests" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Open pull requests</span>
              <strong>{formatNumber(repoPullRequests.length)}</strong>
            </div>
            {pagedRepoPrs.map((pr) => (
              <a className="repo-detail-issue" href={pr.url} target="_blank" rel="noreferrer" key={pr.url}>
                <span>#{pr.number}</span>
                <strong>{pr.title}</strong>
                <em>{pr.isDraft ? "Draft" : pr.reviewDecision?.replace("_", " ").toLowerCase() || "Review pending"} · {formatRelativeTime(pr.updatedAt)}</em>
              </a>
            ))}
            {!repoPullRequests.length ? <div className="modal-empty sub">No open pull requests for this repository.</div> : null}
            {repoPullRequests.length ? (
              <Pagination
                totalItems={repoPullRequests.length}
                page={safeRepoPrsPage}
                pageSize={repoPrsPageSize}
                onPageChange={setRepoPrsPage}
                onPageSizeChange={(size) => {
                  setRepoPrsPageSize(size);
                  setRepoPrsPage(1);
                }}
                showPageSize={false}
              />
            ) : null}
          </section> : null}

          {activeTab === "forks" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Forks</span>
              <strong>{forksLoading && !forks.length ? "..." : formatNumber(forksTotal || forks.length)}</strong>
            </div>
            <div className="repo-detail-subtoolbar">
              <label>
                Sort
                <select value={forkField} onChange={(event) => setForkField(event.target.value)}>
                  <option value="PUSHED_AT">Recently pushed</option>
                  <option value="UPDATED_AT">Recently updated</option>
                  <option value="CREATED_AT">Recently created</option>
                  <option value="STARGAZERS">Most stars</option>
                  <option value="NAME">Name</option>
                </select>
              </label>
              <label>
                Direction
                <select value={forkDirection} onChange={(event) => setForkDirection(event.target.value as "DESC" | "ASC")}>
                  <option value="DESC">Descending</option>
                  <option value="ASC">Ascending</option>
                </select>
              </label>
            </div>
            {forksError ? <div className="modal-error">{forksError}</div> : null}
            {pagedForks.map((fork) => (
              <a className="fork-row" href={fork.url} target="_blank" rel="noreferrer" key={fork.nameWithOwner}>
                <img src={fork.owner.avatarUrl} alt="" />
                <div>
                  <div className="fr-title">{fork.nameWithOwner}</div>
                  <div className="fr-desc">{fork.description || "No description"}</div>
                </div>
                <div className="fr-meta">
                  <span className="mini-stat"><StarIcon /> {formatNumber(fork.stargazerCount)}</span>
                  <span className="mini-stat"><ForkIcon /> {formatNumber(fork.forkCount)}</span>
                  <span>pushed {formatRelativeTime(fork.pushedAt)}</span>
                </div>
              </a>
            ))}
            {forksLoading && !forks.length ? <div className="modal-empty sub">Loading forks...</div> : null}
            {!forksLoading && !forks.length && !forksError ? <div className="modal-empty sub">No forks available.</div> : null}
            {forks.length ? (
              <Pagination
                totalItems={forks.length}
                page={safeForksPage}
                pageSize={forksPageSize}
                onPageChange={setForksPage}
                onPageSizeChange={(size) => {
                  setForksPageSize(size);
                  setForksPage(1);
                }}
                showPageSize={false}
              />
            ) : null}
          </section> : null}

          {activeTab === "dependents" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Dependent repositories</span>
              <strong>{loading && !dependents.length ? "..." : formatNumber(dependents.length)}</strong>
            </div>
            {pagedDependents.map((item) => (
              <a className="dependent-row" href={item.url} target="_blank" rel="noreferrer" key={item.nameWithOwner}>
                {item.avatar ? <img src={item.avatar} alt="" /> : <span />}
                <strong>{item.nameWithOwner}</strong>
                <em>★ {formatNumber(item.stars)} · forks {formatNumber(item.forks)}</em>
              </a>
            ))}
            {!loading && !dependents.length ? <div className="modal-empty sub">No dependents available.</div> : null}
            {dependents.length ? (
              <Pagination
                totalItems={dependents.length}
                page={safeDependentsPage}
                pageSize={dependentsPageSize}
                onPageChange={setDependentsPage}
                onPageSizeChange={(size) => {
                  setDependentsPageSize(size);
                  setDependentsPage(1);
                }}
                showPageSize={false}
              />
            ) : null}
          </section> : null}

          {activeTab === "overview" ? <section className="repo-detail-history">
            <div className="modal-section-title">Recent trend</div>
            <div className="repo-detail-trend">
              <span>Stars {starsDelta === null ? "not enough history" : `${starsDelta >= 0 ? "+" : ""}${formatNumber(starsDelta)}`}</span>
              <span>Forks {forksDelta === null ? "not enough history" : `${forksDelta >= 0 ? "+" : ""}${formatNumber(forksDelta)}`}</span>
            </div>
          </section> : null}

          {activeTab === "issues" ? <section>
            <div className="modal-section-title section-title-with-count">
              <span>Open issues in dashboard</span>
              <strong>{formatNumber(repoIssues.length)}</strong>
            </div>
            {repoIssues.length ? pagedRepoIssues.map((issue) => (
              <a className="repo-detail-issue" href={issue.url} target="_blank" rel="noreferrer" key={issue.url}>
                <span>#{issue.number}</span>
                <strong>{issue.title}</strong>
                <em>{formatRelativeTime(issue.updatedAt)}</em>
              </a>
            )) : <div className="modal-empty sub">No open issues for this repository.</div>}
            {repoIssues.length ? (
              <Pagination
                totalItems={repoIssues.length}
                page={safeRepoIssuesPage}
                pageSize={repoIssuesPageSize}
                onPageChange={setRepoIssuesPage}
                onPageSizeChange={(size) => {
                  setRepoIssuesPageSize(size);
                  setRepoIssuesPage(1);
                }}
                showPageSize={false}
              />
            ) : null}
          </section> : null}
        </div>
      </div>
    </div>
  );
}
