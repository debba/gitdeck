#!/usr/bin/env bash
# Local validation gate for the Growth Studio ralph loop.
# Runs every applicable check and caches successful stages for unchanged
# inputs. Guards always run.
set -Eeuo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
PROJECT_DIR="${ROOT_DIR}/growth-studio-project"
CACHE_DIR="${PROJECT_DIR}/.runtime/validation-cache"
CACHE_ENABLED="${GS_VALIDATION_CACHE:-1}"
CACHE_TTL="${GS_VALIDATION_CACHE_TTL:-21600}" # six hours
CACHE_SCHEMA="1"

step() { printf '\n=== %s ===\n' "$1"; }
skip() { printf -- '--- skipped: %s\n' "$1"; }

[[ "$CACHE_ENABLED" =~ ^[01]$ ]] || {
  echo "GS_VALIDATION_CACHE must be 0 or 1." >&2
  exit 1
}
[[ "$CACHE_TTL" =~ ^[0-9]+$ ]] || {
  echo "GS_VALIDATION_CACHE_TTL must be a non-negative integer." >&2
  exit 1
}

# Hash tracked and non-ignored inputs, including their paths.
input_fingerprint() {
  local scope="$1"
  shift
  {
    printf 'schema=%s scope=%s\n' "$CACHE_SCHEMA" "$scope"
    git -C "$ROOT_DIR" ls-files --cached --others --exclude-standard -- "$@" |
      LC_ALL=C sort -u |
      while IFS= read -r file; do
        [[ -f "${ROOT_DIR}/${file}" ]] || continue
        printf '%s\t%s\n' "$file" "$(git -C "$ROOT_DIR" hash-object -- "$file")"
      done
  } | sha256sum | awk '{ print $1 }'
}

cache_hit() {
  local stage="$1" fingerprint="$2"
  local cache_file="${CACHE_DIR}/${stage}.tsv"
  local saved_at saved_fingerprint now

  (( CACHE_ENABLED && CACHE_TTL > 0 )) || return 1
  [[ -f "$cache_file" ]] || return 1
  IFS=$'\t' read -r saved_at saved_fingerprint < "$cache_file" || return 1
  [[ "$saved_at" =~ ^[0-9]+$ && "$saved_fingerprint" == "$fingerprint" ]] || return 1
  now="$(date +%s)"
  (( now >= saved_at && now - saved_at <= CACHE_TTL ))
}

cache_save() {
  local stage="$1" fingerprint="$2"
  (( CACHE_ENABLED )) || return 0
  mkdir -p "$CACHE_DIR"
  printf '%s\t%s\n' "$(date +%s)" "$fingerprint" > "${CACHE_DIR}/${stage}.tsv"
}

fail=0
cd "$ROOT_DIR"

step "Guard: git diff --check"
if ! git diff --check; then
  echo "ERROR: whitespace errors in the diff." >&2
  fail=1
fi

step "Guard: tests live outside src/ (AGENTS.md)"
misplaced="$(find src -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) 2>/dev/null || true)"
if [[ -n "$misplaced" ]]; then
  echo "ERROR: test files found under src/:" >&2
  printf '%s\n' "$misplaced" >&2
  fail=1
fi

step "Guard: locale files present"
for locale in src/i18n/en.ts src/i18n/it.ts; do
  [[ -f "$locale" ]] || { echo "ERROR: missing $locale" >&2; fail=1; }
done

step "Guard: English and Italian locale key parity"
command -v node >/dev/null 2>&1 || { echo "node is required but not in PATH." >&2; exit 1; }
if [[ -f src/i18n/en.ts && -f src/i18n/it.ts ]] &&
  ! node "${PROJECT_DIR}/scripts/check-i18n-key-parity.mjs" \
    src/i18n/en.ts src/i18n/it.ts; then
  fail=1
fi

command -v npm >/dev/null 2>&1 || { echo "npm is required but not in PATH." >&2; exit 1; }
[[ -d node_modules ]] || { step "npm install"; npm install; }

app_fingerprint="$(input_fingerprint app \
  src tests public index.html package.json package-lock.json tsconfig.json vite.config.ts)"
if cache_hit app "$app_fingerprint"; then
  skip "typecheck, unit tests and build (unchanged successful inputs)"
else
  app_fail=0

  step "typecheck"
  if npm run typecheck; then :; else fail=1; app_fail=1; fi

  step "unit tests (vitest run)"
  if npm test; then :; else fail=1; app_fail=1; fi

  step "production build"
  if npm run build; then :; else fail=1; app_fail=1; fi

  (( app_fail )) || cache_save app "$app_fingerprint"
fi

step "Result"
if (( fail )); then
  echo "VALIDATION FAILED"
  exit 1
fi
echo "VALIDATION OK"
