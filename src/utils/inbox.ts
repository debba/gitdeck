import type { GhIssue, GhLabel, GhNotification, GhPullRequest, GhUser, PullRequestHeadCheck, ReviewDecision } from "../types/github";

const DAY_MS = 86_400_000;

export type InboxItemKind = "issue" | "pull-request";
export type InboxReasonTone = "default" | "attention" | "success" | "warning" | "danger";
export type InboxReasonCode =
  | "assigned-me"
  | "awaiting-review"
  | "changes-requested"
  | "high-discussion"
  | "large-diff"
  | "mentioned"
  | "new"
  | "no-assignee"
  | "ready"
  | "review-requested"
  | "stale"
  | "unread";

export type InboxMailbox =
  | "inbox"
  | "unread"
  | "mentioned"
  | "review-requested"
  | "needs-review"
  | "ready"
  | "assigned-me"
  | "unassigned"
  | "stale"
  | "changes-requested"
  | "authored-by-others";

export interface InboxReason {
  code: InboxReasonCode;
  label: string;
  tone: InboxReasonTone;
}

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  repository: { name: string; nameWithOwner: string };
  title: string;
  url: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  author?: GhUser;
  labels: GhLabel[];
  assignees: GhUser[];
  commentsCount: number;
  score: number;
  status: string;
  reasons: InboxReason[];
  isAssignedToUser: boolean;
  isAuthoredByUser: boolean;
  isDraft?: boolean;
  reviewDecision?: ReviewDecision;
  branch?: { head: string; base: string };
  diff?: { additions: number; deletions: number; changedFiles: number };
  headCheck?: PullRequestHeadCheck | null;
  unread?: boolean;
  notificationThreadId?: string;
  notificationReason?: string;
}

export const INBOX_MAILBOXES: Array<{ key: InboxMailbox; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "unread", label: "Unread" },
  { key: "mentioned", label: "Mentioned" },
  { key: "review-requested", label: "Review requested" },
  { key: "needs-review", label: "Needs review" },
  { key: "ready", label: "Ready to merge" },
  { key: "assigned-me", label: "Assigned to me" },
  { key: "unassigned", label: "Unassigned" },
  { key: "stale", label: "Stale" },
  { key: "changes-requested", label: "Changes requested" },
  { key: "authored-by-others", label: "Authored by others" },
];

interface BuildInboxOptions {
  issues: GhIssue[];
  pullRequests: GhPullRequest[];
  userLogin?: string;
  now?: number;
}

function daysSince(iso: string, now: number): number {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.floor((now - value) / DAY_MS));
}

function hasAssignee(assignees: GhUser[] | undefined, login: string): boolean {
  return Boolean(login && (assignees || []).some((assignee) => assignee.login === login));
}

function isAuthor(author: GhUser | undefined, login: string): boolean {
  return Boolean(login && author?.login === login);
}

function reason(code: InboxReasonCode, label: string, tone: InboxReasonTone = "default"): InboxReason {
  return { code, label, tone };
}

function inboxSort(a: InboxItem, b: InboxItem): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.score - a.score || a.repository.nameWithOwner.localeCompare(b.repository.nameWithOwner);
}

function buildIssueInboxItem(issue: GhIssue, userLogin: string, now: number): InboxItem {
  const assignees = issue.assignees || [];
  const updatedDays = daysSince(issue.updatedAt, now);
  const createdDays = daysSince(issue.createdAt, now);
  const reasons: InboxReason[] = [];
  let score = 18;

  if (!assignees.length) {
    score += 18;
    reasons.push(reason("no-assignee", "No assignee", "warning"));
  }
  if (updatedDays > 30) {
    score += Math.min(36, 20 + Math.floor((updatedDays - 30) / 7) * 4);
    reasons.push(reason("stale", `Stale ${updatedDays}d`, "danger"));
  }
  if (issue.commentsCount >= 6) {
    score += Math.min(18, 6 + issue.commentsCount);
    reasons.push(reason("high-discussion", `${issue.commentsCount} comments`, "attention"));
  }
  if (hasAssignee(assignees, userLogin)) {
    score += 18;
    reasons.push(reason("assigned-me", "Assigned to you", "attention"));
  }
  if (createdDays <= 2) {
    score += 6;
    reasons.push(reason("new", "New issue", "default"));
  }

  if (!reasons.length) reasons.push(reason("new", "Open issue", "default"));

  return {
    id: `issue:${issue.repository.nameWithOwner}#${issue.number}`,
    kind: "issue",
    repository: issue.repository,
    title: issue.title,
    url: issue.url,
    number: issue.number,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    author: issue.author,
    labels: issue.labels || [],
    assignees,
    commentsCount: issue.commentsCount,
    score,
    status: "Open issue",
    reasons,
    isAssignedToUser: hasAssignee(assignees, userLogin),
    isAuthoredByUser: isAuthor(issue.author, userLogin),
  };
}

function buildPullRequestInboxItem(pr: GhPullRequest, userLogin: string, now: number): InboxItem {
  const assignees = pr.assignees || [];
  const updatedDays = daysSince(pr.updatedAt, now);
  const createdDays = daysSince(pr.createdAt, now);
  const reasons: InboxReason[] = [];
  let score = pr.isDraft ? 12 : 24;
  let status = pr.isDraft ? "Draft" : "Open pull request";

  if (!pr.isDraft && pr.reviewsCount === 0 && pr.reviewDecision !== "APPROVED") {
    score += 38;
    status = "Awaiting review";
    reasons.push(reason("awaiting-review", "Awaiting review", "attention"));
  }
  if (pr.reviewDecision === "APPROVED") {
    score += 28;
    status = "Ready to merge";
    reasons.push(reason("ready", "Approved", "success"));
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    score += 34;
    status = "Changes requested";
    reasons.push(reason("changes-requested", "Changes requested", "danger"));
  }
  if (updatedDays > 14) {
    score += Math.min(34, 18 + Math.floor((updatedDays - 14) / 7) * 4);
    reasons.push(reason("stale", `Stale ${updatedDays}d`, "danger"));
  }
  if (hasAssignee(assignees, userLogin)) {
    score += 16;
    reasons.push(reason("assigned-me", "Assigned to you", "attention"));
  }
  if (createdDays <= 2 && !pr.isDraft) {
    score += 6;
    reasons.push(reason("new", "New PR", "default"));
  }
  const changedFiles = pr.changedFiles ?? 0;
  const lineCount = (pr.additions ?? 0) + (pr.deletions ?? 0);
  if (changedFiles >= 12 || (pr.additions != null && pr.deletions != null && lineCount >= 500)) {
    score += 10;
    reasons.push(reason("large-diff", `${changedFiles} files changed`, "warning"));
  }

  if (!reasons.length) reasons.push(reason("new", status, "default"));

  return {
    id: `pull-request:${pr.repository.nameWithOwner}#${pr.number}`,
    kind: "pull-request",
    repository: pr.repository,
    title: pr.title,
    url: pr.url,
    number: pr.number,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    author: pr.author,
    labels: pr.labels || [],
    assignees,
    commentsCount: pr.commentsCount,
    score,
    status,
    reasons,
    isAssignedToUser: hasAssignee(assignees, userLogin),
    isAuthoredByUser: isAuthor(pr.author, userLogin),
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision,
    branch: { head: pr.headRefName, base: pr.baseRefName },
    diff: pr.additions != null && pr.deletions != null
      ? { additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles ?? 0 }
      : undefined,
    headCheck: pr.headCheck ?? null,
  };
}

export function buildInboxItems({ issues, pullRequests, userLogin = "", now = Date.now() }: BuildInboxOptions): InboxItem[] {
  return [
    ...pullRequests.map((pr) => buildPullRequestInboxItem(pr, userLogin, now)),
    ...issues.map((issue) => buildIssueInboxItem(issue, userLogin, now)),
  ].sort(inboxSort);
}

export function itemHasReason(item: InboxItem, code: InboxReasonCode): boolean {
  return item.reasons.some((itemReason) => itemReason.code === code);
}

export function matchesInboxMailbox(item: InboxItem, mailbox: InboxMailbox): boolean {
  if (mailbox === "inbox") return true;
  if (mailbox === "unread") return Boolean(item.unread);
  if (mailbox === "mentioned") return itemHasReason(item, "mentioned");
  if (mailbox === "review-requested") return itemHasReason(item, "review-requested");
  if (mailbox === "needs-review") return itemHasReason(item, "awaiting-review");
  if (mailbox === "ready") return itemHasReason(item, "ready");
  if (mailbox === "assigned-me") return item.isAssignedToUser;
  if (mailbox === "unassigned") return !item.assignees.length;
  if (mailbox === "stale") return itemHasReason(item, "stale");
  if (mailbox === "changes-requested") return itemHasReason(item, "changes-requested");
  if (mailbox === "authored-by-others") return !item.isAuthoredByUser;
  return true;
}

export function searchInboxItems(items: InboxItem[], search = ""): InboxItem[] {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => {
    const haystack = [
      item.title,
      item.repository.nameWithOwner,
      item.author?.login || "",
      item.status,
      ...item.labels.map((label) => label.name),
      ...item.assignees.map((assignee) => assignee.login),
      ...item.reasons.map((itemReason) => itemReason.label),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function filterInboxItems(items: InboxItem[], mailbox: InboxMailbox, search = ""): InboxItem[] {
  return searchInboxItems(items.filter((item) => matchesInboxMailbox(item, mailbox)), search);
}

const NOTIFICATION_REASON_LABEL: Record<string, { label: string; tone: InboxReasonTone; code: InboxReasonCode } | undefined> = {
  mention: { label: "Mentioned", tone: "attention", code: "mentioned" },
  team_mention: { label: "Team mention", tone: "attention", code: "mentioned" },
  review_requested: { label: "Review requested", tone: "attention", code: "review-requested" },
  assign: { label: "Assigned", tone: "attention", code: "assigned-me" },
  ci_activity: { label: "CI activity", tone: "warning", code: "unread" },
  state_change: { label: "State change", tone: "default", code: "unread" },
};

function notificationKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

export function mergeNotifications(items: InboxItem[], notifications: GhNotification[] | undefined): InboxItem[] {
  if (!notifications?.length) return items;
  const byKey = new Map<string, GhNotification>();
  for (const note of notifications) {
    if (!note.itemNumber || !note.repository.nameWithOwner) continue;
    byKey.set(notificationKey(note.repository.nameWithOwner, note.itemNumber), note);
  }
  if (!byKey.size) return items;
  return items
    .map((item) => {
      const note = byKey.get(notificationKey(item.repository.nameWithOwner, item.number));
      if (!note) return item;
      const reasons = [...item.reasons];
      const mapped = NOTIFICATION_REASON_LABEL[note.reason];
      if (mapped && !reasons.some((entry) => entry.code === mapped.code)) {
        reasons.unshift({ code: mapped.code, label: mapped.label, tone: mapped.tone });
      }
      let score = item.score;
      if (note.unread) {
        score += 24;
        if (!reasons.some((entry) => entry.code === "unread")) {
          reasons.unshift({ code: "unread", label: "Unread", tone: "attention" });
        }
      }
      return {
        ...item,
        reasons,
        score,
        unread: note.unread,
        notificationThreadId: note.id,
        notificationReason: note.reason,
      };
    })
    .sort(inboxSort);
}
