import type { GhPullRequest } from "../../types/github";
import { reviewDecisionLabel } from "../../utils/dashboard";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { getLabelCssVars } from "../../utils/colors";
import { Avatar } from "../common/Avatar";
import { PulseIcon } from "../common/Icons";
import { useI18n } from "../../i18n/I18nProvider";

function reviewBadgeClass(pr: GhPullRequest): string {
  if (pr.reviewDecision === "APPROVED") return "approved";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes";
  return "pending";
}

export function PullRequestList({ pullRequests }: { pullRequests: GhPullRequest[] }) {
  const { language, t } = useI18n();
  if (!pullRequests.length) {
    return <div className="empty"><div className="big">{t("empty.prsTitle")}</div><div>{t("empty.tryClearing")}</div></div>;
  }

  return (
    <div className="data-list">
      {pullRequests.map((pr) => {
        const stale = Date.now() - new Date(pr.updatedAt).getTime() > 14 * 86_400_000;
        const author = pr.author?.login || "unknown";
        return (
          <a className="data-row" href={pr.url} key={pr.url} target="_blank" rel="noreferrer">
            <Avatar login={pr.author?.login} avatarUrl={pr.author?.avatarUrl} size={36} />
            <div className="data-row-body">
              <div className="data-row-top">
                <strong className="data-row-author">{author}</strong>
                <span className="data-row-repo">{pr.repository.nameWithOwner}</span>
                <span className="data-row-num">#{pr.number}</span>
                <em>{formatRelativeTime(pr.updatedAt, Date.now(), language)}</em>
              </div>
              <div className="data-row-title">{pr.title}</div>
              <div className="data-row-meta">
                <span className="data-kind pull-request"><PulseIcon /> {t("list.pr")}</span>
                {pr.isDraft ? <span className="pr-badge draft">{t("list.draft")}</span> : null}
                <span className={`pr-badge review ${reviewBadgeClass(pr)}`}>{reviewDecisionLabel(pr.reviewDecision)}</span>
                {stale ? <span className="stale-badge">{t("list.stale")}</span> : null}
                {(pr.labels || []).slice(0, 3).map((label) => {
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
                <span className="data-row-spacer" />
                <span className="pr-diff">
                  <span className="pr-diff-add">+{formatNumber(pr.additions)}</span>
                  <span className="pr-diff-del">−{formatNumber(pr.deletions)}</span>
                </span>
                <span className="data-row-count">{t("list.comments", { count: pr.commentsCount })}</span>
                {pr.assignees && pr.assignees.length ? (
                  <span className="data-row-assignees">
                    {pr.assignees.slice(0, 3).map((assignee) => (
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
