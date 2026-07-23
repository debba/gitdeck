import type { GhIssue } from "../../types/github";
import { formatRelativeTime } from "../../utils/format";
import { getLabelCssVars } from "../../utils/colors";
import { Avatar } from "../common/Avatar";
import { IssueIcon } from "../common/Icons";
import { useI18n } from "../../i18n/I18nProvider";

export function IssueList({ issues }: { issues: GhIssue[] }) {
  const { language, t } = useI18n();
  if (!issues.length) {
    return <div className="empty"><div className="big">{t("empty.issuesTitle")}</div><div>{t("empty.tryClearing")}</div></div>;
  }

  return (
    <div className="data-list">
      {issues.map((issue) => {
        const stale = Date.now() - new Date(issue.updatedAt).getTime() > 30 * 86_400_000;
        const author = issue.author?.login || "unknown";
        return (
          <a className="data-row" href={issue.url} key={issue.url} target="_blank" rel="noreferrer">
            <Avatar login={issue.author?.login} avatarUrl={issue.author?.avatarUrl} size={36} />
            <div className="data-row-body">
              <div className="data-row-top">
                <strong className="data-row-author">{author}</strong>
                <span className="data-row-repo">{issue.repository.nameWithOwner}</span>
                <span className="data-row-num">#{issue.number}</span>
                <em>{formatRelativeTime(issue.updatedAt, Date.now(), language)}</em>
              </div>
              <div className="data-row-title">{issue.title}</div>
              <div className="data-row-meta">
                <span className="data-kind issue"><IssueIcon /> {t("list.issue")}</span>
                {stale ? <span className="stale-badge">{t("list.stale")}</span> : null}
                {(issue.labels || []).slice(0, 4).map((label) => {
                  const vars = getLabelCssVars(label.color);
                  return (
                    <span
                      className={vars ? "data-label gh-label" : "data-label"}
                      key={label.name}
                      style={vars}
                    >
                      {label.name}
                    </span>
                  );
                })}
                {(issue.labels || []).length > 4 ? (
                  <span className="data-label muted">+{issue.labels.length - 4}</span>
                ) : null}
                <span className="data-row-spacer" />
                <span className="data-row-count">{t("list.comments", { count: issue.commentsCount })}</span>
                {issue.assignees && issue.assignees.length ? (
                  <span className="data-row-assignees">
                    {issue.assignees.slice(0, 3).map((assignee) => (
                      <Avatar key={assignee.login} login={assignee.login} avatarUrl={assignee.avatarUrl} size={18} />
                    ))}
                  </span>
                ) : null}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
