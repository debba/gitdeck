import type { GhIssue, GhRepo, RepoInsight } from "../../types/github";
import { getLanguageColor } from "../../utils/colors";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { issueCountForRepo } from "../../utils/dashboard";
import { Avatar } from "../common/Avatar";
import { ForkIcon, IssueIcon, StarIcon } from "../common/Icons";
import { useI18n } from "../../i18n/I18nProvider";

interface RepoGridProps {
  repos: GhRepo[];
  issues: GhIssue[];
  insightsByRepo: Map<string, RepoInsight>;
  onRepoClick: (repo: GhRepo) => void;
  onIssuesClick: (repo: string) => void;
  onStarsClick: (repo: string) => void;
  onForksClick: (repo: string) => void;
}

export function RepoGrid({ repos, issues, insightsByRepo, onRepoClick, onIssuesClick, onStarsClick, onForksClick }: RepoGridProps) {
  const { language, t } = useI18n();
  if (!repos.length) {
    return <div className="empty"><div className="big">{t("empty.reposTitle")}</div><div>{t("empty.tryClearing")}</div></div>;
  }

  return (
    <div className="repos-grid">
      {repos.map((repo) => {
        const issueCount = issueCountForRepo(issues, repo.nameWithOwner);
        const primaryLanguage = repo.primaryLanguage?.name;
        const insight = insightsByRepo.get(repo.nameWithOwner);
        return (
          <article
            className="repo-card"
            key={repo.nameWithOwner}
            tabIndex={0}
            onClick={() => onRepoClick(repo)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRepoClick(repo);
            }}
          >
            <div className="rc-head">
              <Avatar login={repo.owner.login} avatarUrl={repo.owner.avatarUrl} size={28} />
              <div className="rc-title">
                <a href={repo.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><span className="owner">{repo.owner.login}</span><span className="slash">/</span>{repo.name}</a>
              </div>
              <div className="repo-badges">
                {repo.isPrivate ? <span className="rb private">{t("repo.private")}</span> : <span className="rb">{t("repo.public")}</span>}
                {repo.isArchived ? <span className="rb archived">{t("repo.archived")}</span> : null}
                {repo.isFork ? <span className="rb fork">{t("repo.fork")}</span> : null}
              </div>
            </div>
            <div className="repo-desc">{repo.description || t("repo.noDescription")}</div>
            {insight ? (
              <div className="repo-health-row">
                <span className={`repo-health-pill ${insight.healthLabel}`}>{t("repo.health", { score: insight.healthScore })}</span>
                {insight.alerts[0] ? <span className="repo-health-note">{insight.alerts[0]}</span> : insight.opportunities[0] ? <span className="repo-health-note">{insight.opportunities[0]}</span> : null}
                {insight.securityAlertsCount > 0 ? <span className="repo-health-note">{t("insights.securityAlerts", { count: formatNumber(insight.securityAlertsCount) })}</span> : insight.securityAlertsUnavailable ? <span className="repo-health-note">{t("insights.securityUnavailable")}</span> : null}
              </div>
            ) : null}
            <div className="rc-stats">
              <button className={`rc-stat strong star ${repo.stargazerCount ? "clickable" : ""}`} onClick={(event) => { event.stopPropagation(); if (repo.stargazerCount) onStarsClick(repo.nameWithOwner); }}><StarIcon /> {formatNumber(repo.stargazerCount)}</button>
              <button className={`rc-stat strong fork ${repo.forkCount ? "clickable" : ""}`} onClick={(event) => { event.stopPropagation(); if (repo.forkCount) onForksClick(repo.nameWithOwner); }}><ForkIcon /> {formatNumber(repo.forkCount)}</button>
              <button className={`rc-stat iss ${issueCount ? "clickable" : ""}`} onClick={(event) => { event.stopPropagation(); if (issueCount) onIssuesClick(repo.nameWithOwner); }}><IssueIcon /> {issueCount}</button>
              {primaryLanguage ? <span className="rc-lang"><span className="lang-dot" style={{ background: getLanguageColor(primaryLanguage) }} />{primaryLanguage}</span> : null}
              <span>{t("repo.pushed", { time: repo.pushedAt ? formatRelativeTime(repo.pushedAt, Date.now(), language) : "-" })}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
