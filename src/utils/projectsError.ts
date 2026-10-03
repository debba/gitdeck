const FINE_GRAINED_TOKEN_PATTERN = /not accessible by personal access token/i;
const MISSING_SCOPE_PATTERN = /scope|permission|not been granted/i;

const FINE_GRAINED_TOKEN_HINT =
  "Fine-grained personal access tokens cannot read user-owned Projects v2.\n" +
  "Use a classic personal access token with the 'project' scope\n" +
  "(or 'read:project' if you only need to view).";

const MISSING_SCOPE_HINT =
  "Your gh token lacks Projects v2 permissions.\n" +
  "Run in your terminal: gh auth refresh -h github.com -s project\n" +
  "(or 'read:project' if you only need to view).";

export function projectsAccessHint(message: string): string | null {
  if (FINE_GRAINED_TOKEN_PATTERN.test(message)) return FINE_GRAINED_TOKEN_HINT;
  if (MISSING_SCOPE_PATTERN.test(message)) return MISSING_SCOPE_HINT;
  return null;
}
