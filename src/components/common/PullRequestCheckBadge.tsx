import type { PullRequestCheckStatus, PullRequestHeadCheck } from "../../types/github";
import { useI18n } from "../../i18n/I18nProvider";

function StatusIcon({ status }: { status: PullRequestCheckStatus }) {
  const props = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (status) {
    case "success":
      return <svg {...props}><polyline points="20 6 9 17 4 12" /></svg>;
    case "failed":
      return <svg {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
    case "running":
      return <svg {...props}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
    case "pending":
      return <svg {...props}><circle cx="12" cy="12" r="8" /><path d="M12 8v4" /></svg>;
    case "canceled":
      return <svg {...props}><circle cx="12" cy="12" r="8" /><line x1="7" y1="7" x2="17" y2="17" /></svg>;
    case "skipped":
      return <svg {...props}><circle cx="12" cy="12" r="8" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;
    case "manual":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <polygon points="10 9 16 12 10 15" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

export function PullRequestCheckBadge({ check }: { check: PullRequestHeadCheck }) {
  const { t } = useI18n();
  const label = t(`checks.${check.status}`);
  const className = `pr-badge ci ${check.status}`;
  const content = (
    <>
      <StatusIcon status={check.status} />
      {label}
    </>
  );
  if (!check.url) return <span className={className}>{content}</span>;
  return (
    <a className={className} href={check.url} target="_blank" rel="noreferrer" title={label}>
      {content}
    </a>
  );
}
