import type { ProviderConfigSummary } from "../../api/github";

type ProviderKind = ProviderConfigSummary["kind"];

interface ProviderLogoProps {
  kind: ProviderKind;
  small?: boolean;
  className?: string;
}

export function ProviderLogo({ kind, small = false, className = "" }: ProviderLogoProps) {
  const classes = [
    "provider-logo",
    `provider-logo-${kind}`,
    small ? "provider-logo-small" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <span className={classes} aria-hidden="true">
      {kind === "github" ? <GitHubMark /> : null}
      {kind === "gitlab" ? <GitLabMark /> : null}
      {kind === "forgejo" ? <ForgejoMark /> : null}
    </span>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.73.5.67 5.56.67 11.83c0 5.01 3.24 9.26 7.74 10.76.57.1.78-.25.78-.55v-1.93c-3.15.68-3.81-1.52-3.81-1.52-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.67 1.24 3.32.95.1-.74.4-1.24.72-1.53-2.51-.29-5.16-1.26-5.16-5.62 0-1.24.45-2.25 1.18-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.16.91-.25 1.89-.38 2.86-.39.97.01 1.95.14 2.86.39 2.19-1.47 3.15-1.16 3.15-1.16.62 1.57.23 2.73.11 3.02.73.79 1.18 1.8 1.18 3.04 0 4.37-2.65 5.33-5.18 5.61.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.79.55 4.5-1.5 7.74-5.75 7.74-10.76C23.33 5.56 18.27.5 12 .5Z" />
    </svg>
  );
}

function GitLabMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path fill="#FC6D26" d="M12 22 3.1 15.5 5.2 8.8h13.6l2.1 6.7L12 22Z" />
      <path fill="#E24329" d="m12 22 3.4-13.2h3.4l2.1 6.7L12 22ZM12 22 8.6 8.8H5.2l-2.1 6.7L12 22Z" />
      <path fill="#FCA326" d="M5.2 8.8 6.7 4c.2-.6 1-.6 1.2 0l.7 4.8H5.2Zm10.2 0 .7-4.8c.2-.6 1-.6 1.2 0l1.5 4.8h-3.4Z" />
      <path fill="#FC6D26" d="M12 22 8.6 8.8h6.8L12 22Z" />
    </svg>
  );
}

function ForgejoMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="9" cy="18" r="2.5" />
      <path d="M6 8.5V12a3 3 0 0 0 3 3" />
      <path d="M18 8.5v1a4 4 0 0 1-4 4H9" />
    </svg>
  );
}
