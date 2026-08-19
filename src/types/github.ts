export interface GhLabel {
  name: string;
  color?: string;
  description?: string;
}

export interface GhUser {
  login: string;
  url?: string;
  avatarUrl?: string;
  avatar_url?: string;
}

export interface GhIssue {
  repository: { name: string; nameWithOwner: string };
  title: string;
  url: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  author?: GhUser;
  labels: GhLabel[];
  commentsCount: number;
  assignees?: GhUser[];
}

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;

export interface GhPullRequest {
  repository: { name: string; nameWithOwner: string };
  title: string;
  url: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  author?: GhUser;
  labels: GhLabel[];
  commentsCount: number;
  assignees?: GhUser[];
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  reviewsCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRefName: string;
  headRefName: string;
}

export interface CIRunSummary {
  id: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
  event: string;
  headBranch: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  durationSec: number | null;
}

export interface RepoCIHealth {
  repo: string;
  url: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  skippedCount: number;
  inProgressCount: number;
  successRate: number;
  avgDurationSec: number | null;
  lastRun: CIRunSummary | null;
  lastFailure: CIRunSummary | null;
  lastSuccess: CIRunSummary | null;
}

export interface CIHealthData {
  ok: true;
  repos: RepoCIHealth[];
  fetchedAt: string;
}

export interface SnapshotEntry {
  date: string;
  stars: number;
  forks: number;
}

export interface GhRepo {
  nameWithOwner: string;
  name: string;
  owner: { login: string; avatarUrl?: string };
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string } | null;
  updatedAt: string;
  pushedAt: string;
  visibility: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  isTemplate?: boolean;
  viewerPermission?: string | null;
  url: string;
  history?: SnapshotEntry[];
}

export interface ReposData {
  ok: true;
  repos: GhRepo[];
  owners: string[];
  fetchedAt: string;
}

export interface IssuesData {
  ok: true;
  issues: GhIssue[];
  owners: string[];
  fetchedAt: string;
}

export interface PullRequestsData {
  ok: true;
  pullRequests: GhPullRequest[];
  owners: string[];
  fetchedAt: string;
}

export interface ApiError {
  ok: false;
  error: string;
}

export interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface StargazerNode {
  starredAt: string;
  node: { login: string; avatarUrl: string; url: string };
}

export interface ForkNode {
  nameWithOwner: string;
  owner: { login: string; avatarUrl: string };
  stargazerCount: number;
  forkCount: number;
  pushedAt: string;
  updatedAt: string;
  createdAt: string;
  url: string;
  description: string | null;
  primaryLanguage: { name: string } | null;
}

export interface RepoContributor {
  login?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  avatarUrl?: string;
  html_url?: string;
  url?: string;
  contributions: number;
}

export interface RepoTrafficViews {
  count: number;
  uniques: number;
  views?: Array<{
    timestamp: string;
    count: number;
    uniques: number;
  }>;
}

export interface RepoTrafficReferrer {
  referrer: string;
  count: number;
  uniques: number;
}

export interface RepoTrafficPath {
  path: string;
  title: string;
  count: number;
  uniques: number;
}

export interface RepoReleaseAsset {
  id: number;
  name: string;
  download_count: number;
  size?: number;
  browser_download_url?: string;
}

export interface RepoRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at?: string | null;
  body?: string | null;
  assets: RepoReleaseAsset[];
  totalDownloads: number;
}

export interface RepoCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string | null; date?: string | null } | null;
  };
  author?: { login: string; avatar_url: string } | null;
}

export interface RepoMilestone {
  number: number;
  title: string;
  html_url: string;
  description: string | null;
  state: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
}

export interface RepoCommunityProfile {
  health_percentage: number;
  files?: Partial<Record<
    "readme" | "contributing" | "license" | "code_of_conduct" | "issue_template" | "pull_request_template",
    { html_url?: string | null } | null
  >>;
}

export interface RepoBranch {
  name: string;
  committedDate: string | null;
  author: string | null;
  aheadOfDefault: number | null;
  behindDefault: number | null;
  isDefault: boolean;
}

export interface RepoDiscussion {
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  isAnswered: boolean;
  author: string | null;
  authorAvatar: string | null;
  category: string | null;
  comments: number;
}

export interface RepoWorkflowRun {
  id: number;
  name: string | null;
  display_title?: string | null;
  html_url: string;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  run_number: number;
  run_started_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepoSecuritySummary {
  dependabotOpen: number;
  codeScanningOpen: number;
  totalOpen: number;
  latestUpdatedAt: string | null;
  unavailable: boolean;
}

export interface RepoDetailsData {
  ok: true;
  meta: {
    description?: string | null;
    homepage?: string | null;
    clone_url?: string | null;
    topics?: string[];
    license?: { name: string } | null;
    default_branch?: string;
    archived?: boolean;
    is_template?: boolean;
    permissions?: { push?: boolean };
  } | null;
  languages: Record<string, number>;
  contributors: RepoContributor[];
  views: RepoTrafficViews | null;
  releases: RepoRelease[];
  workflows: RepoWorkflowRun[];
  security: RepoSecuritySummary;
  digest?: DailyRepoDigest | null;
  commits?: RepoCommit[];
  milestones?: RepoMilestone[];
  community?: RepoCommunityProfile | null;
  counts?: { branches: number | null; discussions: number | null };
  errors?: Record<string, string | null>;
}

export interface RepoTrafficDetails {
  ok: true;
  forbidden: boolean;
  referrers: RepoTrafficReferrer[];
  paths: RepoTrafficPath[];
  views: RepoTrafficViews | null;
  clones: {
    count: number;
    uniques: number;
    clones?: Array<{
      timestamp: string;
      count: number;
      uniques: number;
    }>;
  } | null;
}

export interface RepoInsight {
  repo: string;
  issueCount: number;
  staleIssueCount: number;
  daysSincePush: number;
  daysSinceUpdate: number;
  starsDelta: number | null;
  forksDelta: number | null;
  releaseCount: number;
  totalDownloads: number;
  recentDownloads: number;
  viewsCount: number;
  viewsUniques: number;
  healthScore: number;
  healthLabel: "strong" | "watch" | "risky";
  securityAlertsCount: number;
  securityAlertsUnavailable: boolean;
  alerts: string[];
  opportunities: string[];
  correlations: string[];
  latestReleasePublishedAt: string | null;
}

export interface RepoInsightsData {
  ok: true;
  generatedAt: string;
  insights: RepoInsight[];
}

export interface DailyRepoDigest {
  repo: string;
  date: string;
  stars: number;
  forks: number;
  issueCount: number;
  staleIssueCount: number;
  securityAlertsCount: number;
  securityAlertsUnavailable: boolean;
  starsDelta: number;
  forksDelta: number;
  issueDelta: number;
  staleIssueDelta: number;
  securityAlertsDelta: number;
  highlights: string[];
  executiveSummary: string[];
  momentum: string[];
  risks: string[];
  ai?: {
    model: string;
    headline: string;
    briefing: string[];
    generatedAt: string;
  } | null;
}

export interface DailyDigestEntry {
  date: string;
  repoCount: number;
  issueCount: number;
  staleIssueCount: number;
  securityAlertsCount: number;
  securityReposCount: number;
  securityAlertsUnavailable: boolean;
  totalStars: number;
  totalForks: number;
  issueDelta: number;
  staleIssueDelta: number;
  starsDelta: number;
  forksDelta: number;
  highlights: string[];
  executiveSummary: string[];
  momentum: string[];
  risks: string[];
  repos: DailyRepoDigest[];
  ai?: {
    model: string;
    headline: string;
    briefing: string[];
    generatedAt: string;
  } | null;
}

export type DigestPeriod = "day" | "week" | "month";

export interface DailyDigestsData {
  ok: true;
  generatedAt: string;
  period?: DigestPeriod;
  digests: DailyDigestEntry[];
}

export type GhNotificationReason =
  | "assign"
  | "author"
  | "comment"
  | "ci_activity"
  | "invitation"
  | "manual"
  | "member_feature_requested"
  | "mention"
  | "push"
  | "review_requested"
  | "security_advisory_credit"
  | "security_alert"
  | "state_change"
  | "subscribed"
  | "team_mention";

export type GhNotificationSubjectType =
  | "Issue"
  | "PullRequest"
  | "Commit"
  | "Release"
  | "RepositoryAdvisory"
  | "RepositoryDependabotAlertsThread"
  | "RepositoryVulnerabilityAlert"
  | "Discussion"
  | "CheckSuite"
  | "WorkflowRun";

export interface GhNotification {
  id: string;
  unread: boolean;
  reason: GhNotificationReason;
  updatedAt: string;
  lastReadAt: string | null;
  subject: {
    title: string;
    url: string | null;
    latestCommentUrl: string | null;
    type: GhNotificationSubjectType | string;
  };
  repository: {
    name: string;
    nameWithOwner: string;
    private: boolean;
    htmlUrl: string;
  };
  itemNumber: number | null;
  itemHtmlUrl: string | null;
}

export interface NotificationsData {
  ok: true;
  notifications: GhNotification[];
  fetchedAt: string;
  pollInterval: number;
}

export interface MentionIssueItem {
  repository: { nameWithOwner: string };
  title: string;
  url: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  state: string;
  isPullRequest?: boolean;
  author?: { login: string; url: string };
}

export interface MentionCodeItem {
  repository: { nameWithOwner: string };
  path: string;
  url: string;
}

export interface DependentItem {
  owner: string;
  repo: string;
  nameWithOwner: string;
  url: string;
  stars: number;
  forks: number;
  avatar: string;
}

export interface ProjectSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription: string | null;
  updatedAt?: string;
  items?: { totalCount: number };
  owner: { __typename: string; login?: string };
  linkedRepos?: string[];
}

export interface ProjectFieldOption {
  id: string;
  name: string;
  color?: string;
}

export interface ProjectField {
  __typename: string;
  id: string;
  name: string;
  dataType?: string;
  options?: ProjectFieldOption[];
}

export interface ProjectItem {
  id: string;
  isArchived: boolean;
  type: string;
  content?: {
    __typename?: string;
    number?: number;
    title?: string;
    url?: string;
    state?: string;
    repository?: { nameWithOwner: string };
    author?: GhUser;
    labels?: { nodes: GhLabel[] };
    assignees?: { nodes: GhUser[] };
    createdAt?: string;
    updatedAt?: string;
  };
  fieldValues?: {
    nodes: Array<{
      __typename: string;
      field?: { id: string; name: string };
      name?: string;
      optionId?: string;
    }>;
  };
}

export interface ProjectDetails {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription: string | null;
  owner: { __typename: string; login?: string };
  fields: ProjectField[];
  items: ProjectItem[];
  totalCount: number;
  truncated: boolean;
}
