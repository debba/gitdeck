# Growth Studio project (ralph loop)

This directory is the single tracked home for turning GitDeck's Growth Studio
into a first-class, self-contained mode of the application: a dedicated shell
at `/growth`, a repository-centric workspace, a real editorial calendar with
AI-generated, media-complete content, and a measure-and-learn loop.

Hard constraints (never violated by any task):

- **The rest of GitDeck keeps working unchanged.** Inbox, repositories,
  issues, pull requests, insights, alerts, CI, digests, board and preferences
  keep their routes, layout and behavior. Only the `goals` tab is replaced by
  the Growth Studio entry.
- **Rules from `AGENTS.md` apply**: English identifiers, comments, docs and
  commit messages; pure business logic in `src/utils` with mirrored tests
  under `tests/utils`; tests never inside `src`; GitHub API access stays behind
  server-side endpoints; no unrelated refactors mixed with feature work.
- **Both locales.** Every new UI string exists in `src/i18n/en.ts` and
  `src/i18n/it.ts` (see `docs/translations.md`).
- **Local-first and copy-paste publishing.** No social network credentials are
  stored; content is copied (text and image) by the user. Media is mandatory
  for a post to reach the `ready` state.
- **Existing goals data is preserved.** Migrations are additive and idempotent.

## Layout

- `docs/GS_PLAN.md`: architecture, data model, AI pipeline, phases, standard task loop.
- `docs/GS_FEATURE_MATRIX.md`: authoritative feature inventory and status.
- `docs/GS_DECISIONS.md`: settled decisions with their rationale.
- `tasks/`: task specifications and the authoritative `PROGRESS.md` ledger.
- `scripts/run-gs-tasks.sh`: the ralph loop runner (headless pi or Claude Code sessions).
- `scripts/validate-gs-task.sh`: the local validation gate run after every task.
- `.runtime/`: ignored runner locks, state, logs and gate cache, created on first execution.

## Run the loop

```bash
git checkout -b feat/growth-studio   # once, from the branch holding the goals work
growth-studio-project/scripts/run-gs-tasks.sh
```

With no task IDs, the runner reads `tasks/PROGRESS.md` and starts at the first
`PENDING` task, then continues in lexical order, re-scanning the ledger after
every task so tasks authored mid-run (by phase-opening tasks) are picked up.
Explicit task IDs are supported:

```bash
growth-studio-project/scripts/run-gs-tasks.sh GS-010 GS-011
```

Each task runs as one non-interactive agent session on the loop branch
(`feat/growth-studio` by default, override with `GS_LOOP_BRANCH`). After the
session the runner re-runs the validation gate itself; a failed gate starts a
focused repair session that amends the same task commit, up to
`GS_LOOP_REPAIR_ATTEMPTS` times (default 3).

The gate runs `npm run typecheck`, `npm test` and `npm run build`, plus guards
for whitespace errors, tests placed under `src/`, and the presence of both
locale files. Successful stages are cached for six hours, keyed by a hash of
all relevant tracked and non-ignored inputs; any source, test, lockfile or
config change forces the checks to run again. Set `GS_VALIDATION_CACHE=0` to
force every check, or configure the lifetime with `GS_VALIDATION_CACHE_TTL`.

## Telegram notifications

```bash
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=...
```

Start, finish, repair and failure notifications carry the global completed-task
percentage from `tasks/PROGRESS.md`, prefixed with `[gitdeck-gs]`. Both
variables must be set together; dry runs never send external notifications.

## Options

```
--agent AGENT       CLI agent running the sessions: pi or claude (default: pi)
--model MODEL       Model override for the selected agent
--thinking LEVEL    Thinking level, pi agent only (default: high)
--live / --no-live  Stream agent activity to the terminal (default: auto by TTY)
--no-notify         Disable desktop notifications
--dry-run           Print the sessions that would run
--force             Run tasks even when PROGRESS.md says COMPLETED
```

Defaults can also be set via `GS_LOOP_AGENT`, `GS_LOOP_MODEL`,
`GS_LOOP_THINKING`, `GS_LOOP_BRANCH`, `GS_LOOP_LIVE`, `GS_LOOP_REPAIR_ATTEMPTS`,
`GS_LOOP_MAX_TASKS`, `GS_VALIDATION_CACHE` and `GS_VALIDATION_CACHE_TTL`.
