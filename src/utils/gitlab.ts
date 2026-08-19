export interface GitLabInstanceConfig {
  id: string;
  kind: "gitlab";
  label: string;
  baseUrl: string;
  webUrl: string;
  oauthAuthorizeUrl: string;
  oauthTokenUrl: string;
  oauthScopes: string;
  userAgent: string;
}

export function isSameGitLabInstance(rawUrl: string, expectedUrl: string | null | undefined): boolean {
  if (!expectedUrl) return false;
  try {
    return buildGitLabInstanceConfig(rawUrl).webUrl === expectedUrl;
  } catch {
    return false;
  }
}

export function gitLabTokenSettingsUrl(rawUrl: string): string | null {
  try {
    return `${buildGitLabInstanceConfig(rawUrl).webUrl}/-/user_settings/personal_access_tokens`;
  } catch {
    return null;
  }
}

export function buildGitLabInstanceConfig(rawUrl: string): GitLabInstanceConfig {
  const input = rawUrl.trim();
  if (!input) throw new Error("GitLab instance URL is required");

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("Invalid GitLab instance URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("GitLab instance URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("GitLab instance URL must not include credentials, query parameters, or fragments");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api/v4")) pathname = pathname.slice(0, -7);
  const webUrl = `${url.protocol}//${url.host}${pathname}`;
  const instanceName = `${url.host}${pathname}`;
  const slug = instanceName.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, "");

  return {
    id: `gitlab-${slug}`,
    kind: "gitlab",
    label: `GitLab (${instanceName})`,
    baseUrl: `${webUrl}/api/v4`,
    webUrl,
    oauthAuthorizeUrl: `${webUrl}/oauth/authorize`,
    oauthTokenUrl: `${webUrl}/oauth/token`,
    oauthScopes: "api read_user read_repository",
    userAgent: "gitdeck",
  };
}
