const FINE_GRAINED_TOKEN_PATTERN = /not accessible by personal access token/i;
const MISSING_SCOPE_PATTERN = /scope|permission|not been granted/i;
const REQUIRED_SCOPES_PATTERN = /requires one of the following scopes: \[([^\]]*)\]/g;

const FINE_GRAINED_TOKEN_HINT =
  "Fine-grained personal access tokens cannot read user-owned Projects v2.\n" +
  "Use a classic personal access token with the 'project' scope\n" +
  "(or 'read:project' if you only need to view).";

const MISSING_SCOPE_HINT =
  "Your gh token lacks Projects v2 permissions.\n" +
  "Run in your terminal: gh auth refresh -h github.com -s project\n" +
  "(or 'read:project' if you only need to view).";

function requiredScopes(message: string): string[] {
  const scopes = [...message.matchAll(REQUIRED_SCOPES_PATTERN)].map((match) => match[1].split(",")[0].replace(/['"\s]/g, ""));
  return [...new Set(scopes)].filter(Boolean);
}

function requiredScopesHint(scopes: string[]): string {
  return (
    `Your token lacks scopes required by the Board: ${scopes.map((scope) => `'${scope}'`).join(", ")}.\n` +
    "Add them to your personal access token,\n" +
    `or run in your terminal: gh auth refresh -h github.com -s ${scopes.join(",")}`
  );
}

export function projectsAccessHint(message: string): string | null {
  if (FINE_GRAINED_TOKEN_PATTERN.test(message)) return FINE_GRAINED_TOKEN_HINT;
  const scopes = requiredScopes(message);
  if (scopes.length) return requiredScopesHint(scopes);
  if (MISSING_SCOPE_PATTERN.test(message)) return MISSING_SCOPE_HINT;
  return null;
}
