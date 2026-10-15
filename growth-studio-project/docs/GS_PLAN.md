# Growth Studio plan

Authoritative architecture and phase plan for the Growth Studio project.
Read it in full before every task. Sections marked *settled* are decisions
recorded in `GS_DECISIONS.md`; do not reopen them inside a task.

## 1. Goal

Turn Growth Studio from a panel inside the Goals tab into the central growth
tool of GitDeck:

1. A **dedicated shell** at `/growth`, opened from the main menu in a new
   window, that hides everything unrelated (dashboard filters sidebar, tab
   strip, footer) and has its own navigation.
2. A **repository-centric workspace**: the repository is the entry point;
   goals ("missions"), interventions, calendar, library and review are panels
   of that workspace.
3. **Interventions as an editorial plan**: interventions and content items are
   first-class persisted entities with status and dates; the AI fills a
   calendar built from content pillars and per-channel cadence, then drafts
   each slot with mandatory media.
4. A **measure-and-learn loop**: published content is attributed to metric
   deltas, a weekly Growth Review reports what worked, and the next plan is
   re-weighted accordingly.
5. A **unified calendar** across every repository with a growth profile.

## 2. Hard constraints

- Everything outside Growth Studio keeps its routes, layout and behavior. The
  only change to the main application chrome is replacing the `goals` tab with
  the Growth Studio link (`target="_blank"`, `rel="noopener"`).
- `AGENTS.md` rules: English everywhere; pure logic in `src/utils` with
  mirrored tests in `tests/utils`; server logic tests in `tests/server`; no
  tests under `src`; forge API access only through server endpoints; no
  unrelated refactors; TypeScript for new files.
- Both `src/i18n/en.ts` and `src/i18n/it.ts` receive every new key.
- Publishing is copy-paste only. No social credentials, no outbound posting.
- Media is mandatory: a content item cannot become `ready` without at least one
  media attachment.
- Schema changes are additive and idempotent (`CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info` check). Existing
  `repository_goals` and `repository_content_sources` rows keep working.
- New native dependencies are not allowed. Image rasterization happens in the
  browser (SVG drawn on a canvas), not on the server.
- Each task ends with `growth-studio-project/scripts/validate-gs-task.sh`
  printing `VALIDATION OK`, one conventional commit (scope `growth`), no push,
  no `Co-Authored-By` trailer.

## 3. Settled decisions (see GS_DECISIONS.md)

- D-001 Repository is the entry point; goals are a panel.
- D-002 Growth Studio opens in a separate window from the main menu.
- D-003 Copy-paste publishing with mandatory media; images are copied to the
  clipboard or downloaded, never posted by the app.
- D-004 Unified multi-repository calendar is in scope.
- D-005 Client-side rasterization for generated image cards.
- D-006 The loop runs with pi by default; Telegram notifications reuse the
  Emailchef runner variables.

## 4. Current state (inventory, verified 2026-09-04)

Files a task will most often touch or extend:

| Area | Files | Verified responsibilities |
|---|---|---|
| Types | `src/types/goals.ts` | Defines the four metrics in `GOAL_METRIC_DEFINITIONS`; `RepositoryGoal`; `GoalSuggestion`; `GoalProposal`; `GoalProposalsData`; `GoalContentSource`; media suggestions; and all ten legacy proposal formats. The current generator emits only `x-thread`, `linkedin-post`, and `mastodon-post`. |
| Server store | `src/server/goalStore.ts` | Lazily creates `repository_goals` with columns `id`, `account_id`, `repository`, `metric`, `target_value`, `current_value`, `deadline`, `created_at`, `updated_at`, `suggestions`, and `suggestions_generated_at`, plus `repository_content_sources` with `account_id`, `repository`, `sources`, and `updated_at`. Suggestions and their nested proposals are JSON in `repository_goals.suggestions`. Exports account-scoped goal CRUD, current-value updates, suggestion/proposal saves, and content-source get/save helpers. |
| Server logic | `src/server/goals.ts` | `refreshGoal` uses metric resolvers for stars, forks, closed PRs, and release-asset downloads. `generateGoalSuggestions` uses a four-item `fallbackSuggestions` result when AI is not configured or structured generation yields an empty list, and otherwise requests 3–5 suggestions. `generateGoalProposals` requires AI and requests exactly one X thread, LinkedIn post, and Mastodon post. The module also privately fetches README and release signals, fetches repository and website source signals, guards website requests and redirects against SSRF, and exports `SOCIAL_PROPOSALS_VERSION` (currently `4`). |
| Goal routes | `src/server/routes/goals.ts` | Registers `GET /api/goals`, `POST /api/goals`, `DELETE /api/goals/:id`, `POST /api/goals/:id/advice`, and `POST /api/goals/:id/suggestions/:index/proposals`. Every handler requires the active account; create validates repository, metric, positive integer target, and date. |
| Content-source routes | `src/server/routes/repository.ts`, `src/server/routes/index.ts` | `registerRepositoryRoutes` registers account-scoped `GET` and `PUT /api/repository-content-sources?repo=owner/name`; the same route module also owns repository details, stargazers, forks, branches, and discussions. `registerApiRoutes` registers both repository and goal routes. |
| AI | `src/server/ai/client.ts`, `src/server/ai/settings.ts`, `src/server/aiDigest.ts` | `generateStructured` provides provider-specific structured JSON generation and throws `AiNotConfiguredError` or `AiRequestError`; `testAiConnection` performs the connection test. Settings resolve database overrides, environment variables, and defaults, expose `isAiConfigured`, and persist through `preferenceStore`. `maybeGenerateAiDigest` is a separate optional structured-output consumer. |
| Dashboard data | `src/server/dashboardData.ts` | Exports five-minute memoized `getReposCached`, `getIssuesCached`, and `getPullRequestsCached` loaders plus `invalidateDataCache`. Repository loads best-effort record and attach snapshots. |
| GitHub API helpers | `src/server/githubClient.ts` | Server-only authenticated GitHub GraphQL and REST helpers: `gql`, `restApi`, `restApiPaginate`, and the `ghApiJson` alias. |
| Historical data | `src/server/snapshots.ts`, `src/server/digests.ts` | Snapshots persist up to 90 daily star/fork records per repository in a JSON file, but `attachHistory` exposes only the latest 30. No raw snapshot reader is exported. Digests persist up to 120 daily records in a separate JSON file and expose daily/period delivery plus `getLatestRepoDigest`; AI enrichment is optional. |
| Persistence helpers | `src/server/sqlite.ts`, `src/server/preferenceStore.ts` | SQLite exports `getDatabase`, `execute`, `run`, `get`, `all`, and `closeDatabase`; the singleton database enables WAL and foreign keys. Preferences lazily create a global `preferences(scope, key, value, updated_at)` table and expose JSON `setPreference`, `getPreference`, and `deletePreference`. |
| SPA and entry point | `src/server/spa.ts`, `src/main.tsx` | The private `APP_ROUTES` set contains the fixed top-level routes including `/goals`; `isAppRoute` tests that set, while `isClientRoutePath` accepts any extensionless final path segment. `main.tsx` mounts only `App` inside shared `I18nProvider`, `AccountProvider`, and `BrowserRouter`. |
| Dashboard tab | `src/App.tsx` | Defines the `Tab` union and `TAB_ROUTES`, derives a tab from the pathname, owns goal loading state/effects, applies `tab-goals`, gives Goals the repository-filter search branch, renders the goals tab button, and mounts `GoalsView`. See section 4.2. |
| Goals UI | `src/components/views/GoalsView.tsx`, `src/components/views/GoalsLoadingState.tsx`, `src/components/modals/GoalProposalsModal.tsx` | `GoalsView` creates/deletes goals, groups them by repository, refreshes advice, opens source and proposal modals, and links to AI preferences. The loading component is a layout-matched skeleton. The proposal modal loads/caches/regenerates drafts, handles no-AI/error states, copies text, renders X posts and media, and closes on Escape. |
| Shared goals controls | `src/components/common/RepositoryPicker.tsx`, `src/components/common/RepositoryContentSources.tsx`, `src/components/common/ContentSourcePicker.tsx` | Searchable repository combobox; account-scoped source-library modal with queued auto-save; and repository/website source editor. `RepositoryPicker` currently contains the hard-coded English strings `repositories`, `No repositories found`, and `No description`; the other two use `goals.*` translations. |
| AI settings UI | `src/components/preferences/AiIntegrationSettings.tsx` | Loads, edits, tests, and resets the server-side AI provider settings and displays each resolved setting source. It is mounted by `PreferencesView` at `/preferences#preferences-ai`. |
| Client API | `src/api/github.ts` | Goal methods are `fetchGoals`, `createGoal`, `deleteGoal`, `generateGoalAdvice`, and `fetchGoalProposals`. Source methods are `fetchRepositoryContentSources` and `updateRepositoryContentSources`; AI settings methods are in the same module. |
| Pure goal utils | `src/utils/goals.ts`, `tests/utils/goals.test.ts` | Groups goals by repository, calculates bounded progress/deadline state, and formats an X thread for copying; mirrored tests cover all three. |
| Pure proposal utils | `src/utils/socialProposals.ts`, `tests/utils/socialProposals.test.ts` | Normalizes source entries, extracts web text/media URLs, attaches source media, counts/validates platform content, normalizes AI proposals, and checks the three-format social set; mirrored tests cover these behaviors. |
| AI tests | `tests/server/aiClient.test.ts`, `tests/server/aiSettings.test.ts` | Cover JSON parsing and provider wire formats/errors, plus settings precedence, reset, provider switching, and URL validation. |
| i18n | `src/i18n/en.ts`, `src/i18n/it.ts` | Both files contain the same 70-key Goals set listed in section 4.1. |
| Styles | `src/styles/goals.css`, `src/styles/layout-sidebar.css`, `src/styles/navigation.css`, `src/styles/tokens.css` | Goals CSS also owns repository-picker, source-picker, and proposals-modal styles. Layout/sidebar and navigation own dashboard chrome and tabs; tokens define dark, light, and automatic-theme values. All four are imported by `src/styles.css`. |
| Scripts | `package.json` | `dev` runs the TSX API watcher and Vite concurrently; `build` bundles the Node server with esbuild then runs Vite; `test` is `vitest run`; `typecheck` is `tsc --noEmit`. |

### 4.1 Goals i18n inventory

`src/i18n/en.ts` and `src/i18n/it.ts` have identical key sets: one
`tabs.goals` key and 69 `goals.*` keys. These are the keys that later shell and
Missions work must preserve or deliberately replace:

```text
tabs.goals
goals.createTitle
goals.createDescription
goals.repository
goals.chooseRepository
goals.searchRepository
goals.metric
goals.target
goals.deadline
goals.add
goals.emptyTitle
goals.emptyText
goals.deleteConfirm
goals.deleteTitle
goals.deleteMessage
goals.completed
goals.remaining
goals.overdue
goals.daysLeft
goals.aiPlan
goals.mission
goals.completedMissions
goals.growthStudioEyebrow
goals.growthStudio
goals.growthStudioDescription
goals.generateAdvice
goals.refreshAdvice
goals.proposals
goals.proposalsOpen
goals.proposalsKind
goals.proposalsIntro
goals.sourcesTitle
goals.sourcesDescription
goals.sourcesRepository
goals.sourcesChooseRepository
goals.sourcesWebsite
goals.sourcesAdd
goals.sourcesRepoBadge
goals.sourcesWebBadge
goals.sourcesRemove
goals.sourcesInvalid
goals.sourcesLimit
goals.sourcesOptional
goals.mediaTitle
goals.mediaImage
goals.mediaVideo
goals.proposalsReadyTitle
goals.proposalsReadyText
goals.proposalsGenerate
goals.proposalsRetry
goals.proposalsLoading
goals.proposalsRegenerate
goals.proposalsRegenerateSources
goals.proposalsGeneratedAt
goals.proposalsNoAi
goals.proposalsOpenPreferences
goals.proposalsEmpty
goals.proposalFormat.x-thread
goals.proposalFormat.linkedin-post
goals.proposalFormat.mastodon-post
goals.proposalFormat.post
goals.proposalFormat.issue
goals.proposalFormat.discussion
goals.proposalFormat.email
goals.proposalFormat.checklist
goals.proposalFormat.message
goals.proposalFormat.doc
goals.copyThread
goals.copyPost
goals.aiFallback
```

Four of these keys are currently defined in both locales but have no source
consumer: `goals.chooseRepository`, `goals.deleteConfirm`,
`goals.sourcesRepository`, and `goals.proposalsRegenerateSources`. The proposal
format lookup is dynamic, so all `goals.proposalFormat.*` keys remain reachable
for legacy stored proposals even though new generation emits only three social
formats.

### 4.2 `goals` tab consumers in `src/App.tsx`

GS-012 must account for all of these direct consumers when it replaces the tab
with the external Growth Studio link:

| Concern | Current consumer |
|---|---|
| Imports | `fetchGoals`, `GoalIcon`, `GoalsView`, and the `RepositoryGoal` type exist only for the Goals tab in `App.tsx`. |
| Tab type and route tables | `Tab` includes `goals`; `TAB_ROUTES.goals` is `/goals`; `ROUTE_TABS` derives the reverse mapping; `tabFromPath` therefore selects `goals` for `/goals`. |
| View selection | `tab` comes from `location.pathname`; `view` mirrors it outside Preferences, enabling the Goals render branch. |
| State | `goals` and `goalsLoaded` hold the list and initial-load state. |
| Account lifecycle | `handleBaseAccountChange` clears `goals` and resets `goalsLoaded`; `handleLogout` does the same. |
| Refresh callback | `refreshGoals` calls `fetchGoals`, replaces `goals`, and marks them loaded; it is passed to `GoalsView` as `onChange`. |
| Route-triggered loading effect | When authenticated and `tab === "goals"`, an abortable effect calls `fetchGoals`; success stores the list and all non-abort failures still mark the initial load complete. The effect reruns for auth state, active account, or tab changes. |
| Dashboard data dependency | `tab` is passed to `useDashboardData`; `dataRequirementsForTab` (in `src/utils/dataRequirements.ts`) currently maps `goals` to the repositories resource used by the picker. Top-bar refresh calls the same helper with `tab`. |
| Body class | The body-class effect toggles `tab-goals` when `tab === "goals"`. |
| Search and filters | Goals shares `repoFilters.search` with repositories, insights, alerts, and digests. `setSearch` updates `repoFilters` and resets `repoPage`; `resetFilters` restores `defaultRepoFilters`. `GoalsView` nevertheless receives the unfiltered `repos` array. |
| Generic tab propagation | `tab` is passed to `SidebarControls`; `navigateTab` and `TAB_ROUTES[tab]` are used by tab buttons, modal closing, and `CommandPalette` navigation. These generic paths continue to compile only if their tab types remain compatible after `goals` is removed. |
| Tab-strip entry | `tabs` adds the `goals` item with `tabs.goals`, `goals.length`, `goalsLoaded`, and `GoalIcon`; the shared map renders it as a `<button>` and calls `navigateTab("goals")`. |
| View render | `view === "goals"` mounts `GoalsView` with `goals`, the full `repos` list, `loading={!goalsLoaded}`, and `onChange={refreshGoals}`. |

## 5. Target architecture

### 5.1 Shell and routing

- `src/main.tsx` mounts `GrowthStudioApp` when `location.pathname` starts with
  `/growth`, otherwise `App`. Both share the providers (i18n, accounts).
  Authentication reuses the existing auth state and `AuthGate`.
- `src/server/spa.ts` treats every `/growth` and `/growth/...` path as a client
  route. `/goals` stays in `APP_ROUTES` and the client redirects it to
  `/growth`.
- Routes:
  - `/growth` — home: repositories with a growth profile or active goals, quick
    stats, "open workspace", "unified calendar".
  - `/growth/calendar` — unified calendar (all repositories).
  - `/growth/review` — latest Growth Review across repositories.
  - `/growth/r/:owner/:repo` — workspace overview.
  - `/growth/r/:owner/:repo/missions|interventions|calendar|library|review`.
  - `/growth/settings` — growth-wide preferences (default cadence, default
    pillars, timezone), linking to the existing AI preferences page.
- Components live under `src/components/growth/` (shell, sidebar, top bar,
  panels) and `src/components/growth/calendar/`. Styles under
  `src/styles/growth/*.css`, imported from `src/styles.css`. Body class
  `mode-growth` is set by the shell; dashboard styles must not leak into it.
- The main application replaces the `goals` tab with an anchor styled as a tab
  that opens `/growth` in a new window. The `Tab` union loses `goals`; the
  `GoalsView` component moves into the Missions panel of the workspace.

### 5.2 Data model (SQLite, `src/server/growth/store.ts`)

All tables carry `account_id` and use the same account scoping as goals.

- `growth_profiles` (PK `account_id, repository`): `language`, `voice`,
  `audience`, `channels` JSON (`x`, `linkedin`, `mastodon`, `bluesky`,
  `discussion`, `blog`), `cadence` JSON (`{ channel: postsPerWeek }`),
  `pillars` JSON (`[{ id, label, weight, description }]`), `hashtags` JSON,
  `avoid` TEXT, `timezone`, `posting_windows` JSON (`[{ weekday, hour }]`),
  `color` (calendar color), `updated_at`.
- `growth_interventions`: `id`, `account_id`, `repository`, `goal_id` NULL,
  `category` (`product|community|engineering|marketing`), `title`, `action`,
  `origin` (`ai|rule|manual`), `rule_key` NULL, `dedupe_key`, `status`
  (`proposed|accepted|dismissed|done`), `created_at`, `updated_at`.
- `content_plans`: `id`, `account_id`, `repository`, `period_start`,
  `period_end`, `cadence` JSON snapshot, `pillars` JSON snapshot, `status`
  (`draft|active|archived`), `generated_at`, `created_at`.
- `content_items`: `id`, `account_id`, `repository`, `plan_id` NULL,
  `intervention_id` NULL, `goal_ids` JSON, `channel`, `format` (existing
  `GoalProposalFormat` values), `pillar`, `angle` (one-line brief), `title`,
  `summary`, `body` (markdown), `thread_posts` JSON, `media` JSON
  (`[{ assetId?, url?, kind, alt, caption? }]`), `sources` JSON (URLs cited),
  `status` (`idea|draft|ready|scheduled|published|skipped`), `scheduled_for`
  (ISO datetime, NULL for backlog), `published_at`, `published_url`,
  `generated_at`, `generation_version`, `evergreen` INTEGER (0/1),
  `created_at`, `updated_at`.
- `growth_assets`: `id`, `account_id`, `repository`, `kind` (`image|video`),
  `origin` (`upload|readme|website|generated`), `path` (relative to
  `DATA_DIR/growth-assets/`) or `url`, `title`, `alt`, `width`, `height`,
  `card_template` NULL, `card_data` JSON NULL, `created_at`.
- `content_performance`: `content_id`, `window` (`48h|7d`), `measured_at`,
  `metrics` JSON (`{ starsDelta, forksDelta, ... }`), PK (`content_id`,
  `window`).

Migration (one shot, idempotent, at first store access): every
`GoalSuggestion` in `repository_goals.suggestions` becomes a
`growth_interventions` row with `origin='ai'`, `status='proposed'`,
`goal_id` set, and each `GoalProposal` a `content_items` row with
`status='draft'` linked to that intervention. The JSON column is left in place
and no longer written. A `preferences` row (`growth`, `migratedSuggestionsV1`)
records completion.

### 5.3 Server modules (`src/server/growth/`)

- `store.ts` — schema, CRUD, migration.
- `signals.ts` — collects repository signals for AI prompts: repo metadata,
  open issues and PRs, releases, README excerpt and media URLs, content
  sources (move the fetchers out of `src/server/goals.ts`; keep the SSRF
  guards), recent commits (`/repos/:repo/commits?per_page=20`), star history
  from snapshots, goals with progress.
- `planner.ts` — builds a plan: deterministic slots from
  `src/utils/growth/planSlots.ts`, then one `generateStructured` call assigns
  an angle, pillar confirmation, sources and CTA to each slot; slots become
  `content_items` with `status='idea'`.
- `drafter.ts` — turns one idea into a draft (body, thread posts, media
  candidates from assets and signal media, alt text) with the platform rules
  already in `src/utils/socialProposals.ts`.
- `rules.ts` + `src/utils/growth/opportunityRules.ts` — deterministic
  opportunity detection producing interventions with `origin='rule'`:
  release without a post within 3 days; star milestone within 5 percent;
  unanswered good-first-issues older than 14 days; large PR merged without a
  post; goal overdue risk (pace below required); evergreen content older than
  60 days eligible for recycling.
- `attribution.ts` — computes `content_performance` from snapshots at 48h and
  7d after `published_at`; aggregates per pillar and channel.
- `review.ts` — weekly Growth Review: published items, deltas, misses,
  upcoming week, three proposed interventions; AI narrative optional.
- `cards.ts` — SVG templates for generated cards (release, milestone, stats,
  quote, "what's new"); returns SVG strings, the browser rasterizes.
- Routes in `src/server/routes/growth.ts`, prefix `/api/growth/`.

### 5.4 Client

- `src/api/growth.ts` — typed fetchers for all growth endpoints.
- Panels: Home, Workspace overview, Missions (existing goals UI), Interventions
  (backlog with filters and status actions), Calendar (month and week, drag
  and drop reschedule, item drawer), Queue ("this week" list with copy text,
  copy or download image, mark published), Library (sources, assets, profile,
  pillars and cadence), Review.
- Media copy: `navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])`
  with a download fallback. SVG cards are rendered to a canvas at 2x.
- ICS export endpoint `/api/growth/calendar.ics` for scheduled items.

### 5.5 Unified calendar

Same Calendar component without a repository filter: colour per repository
(`growth_profiles.color`), repository chip on each item, filters by
repository, channel, pillar and status. Multi-repository plan generation
staggers release-type items so two repositories never publish the same pillar
on the same day when avoidable.

## 6. Phases and task numbering

Task IDs are `GS-NNN`. Tens group phases. The last task of a phase authors the
next phase's task files and `PENDING` ledger rows when they do not exist yet.

| Phase | Tasks | Scope |
|---|---|---|
| 0 Governance | GS-000..GS-003 | baseline, inventory verification, decisions, gate baseline |
| 1 Shell | GS-010..GS-016 | `/growth` routing, shell chrome, main-menu link, `/goals` redirect, Missions panel, home and workspace overview |
| 2 Data model | GS-020..GS-026 | growth store and migration, API routes, interventions backlog UI, content items UI, profile and library panel, phase 3 authoring |
| 3 Editorial plan | GS-030..GS-038 | slot builder, AI planner, media-aware drafter, calendar views, queue, mark published, ICS, plan management |
| 4 Media | GS-040..GS-047 | assets library, imports from README and web sources, card templates, client rasterization and clipboard copy, media gate for `ready` |
| 5 Loop | GS-050..GS-05x | opportunity rules, attribution, Growth Review, evergreen recycling, plan re-weighting |
| 6 Unified and release | GS-060..GS-06x | unified calendar, multi-repository deconfliction, growth settings, README and CHANGELOG, final QA |

## 7. Standard task loop (every session)

1. Read the task file, this plan, `GS_FEATURE_MATRIX.md`, `GS_DECISIONS.md`
   and `PROGRESS.md`.
2. Inspect `git status`; preserve unrelated changes, never discard user work.
3. Set the task to `IN_PROGRESS` in `PROGRESS.md`.
4. Study the existing code listed in section 4 for the touched area before
   writing new code. Extend existing helpers instead of duplicating them.
5. Implement the smallest complete change for the task scope only. Add keys to
   both locale files. Put pure logic in `src/utils` with tests in `tests/utils`.
6. Run the validation gate: `growth-studio-project/scripts/validate-gs-task.sh`.
   It must end with `VALIDATION OK`.
7. Update `GS_FEATURE_MATRIX.md` rows touched by the task, and
   `GS_DECISIONS.md` when a task had to settle something new.
8. Review `git diff` and `git diff --check`.
9. Set the task to `COMPLETED` in `PROGRESS.md` with a one-line summary,
   verification evidence, and ISO date. Never use `|` inside fields.
10. Create the task's single conventional commit with scope `growth`, e.g.
    `feat(growth): add the /growth shell and navigation`. No push. No
    `Co-Authored-By` trailer.
11. If blocked, set the task to `BLOCKED` with the blocker, leave the repo in a
    safe state, and stop without claiming completion.

## 8. Quality bar

- Every server endpoint validates input and scopes by account, like
  `src/server/routes/goals.ts`.
- Every fetch of a user-supplied URL goes through the SSRF guards in
  `signals.ts`.
- AI calls use `generateStructured` with a JSON schema and a deterministic
  fallback when AI is not configured, like `fallbackSuggestions` today.
- UI states: loading, empty, error and "AI not configured" for every panel.
- Keyboard: Escape closes drawers and modals; calendar items are focusable.
- Dark and light themes via existing tokens in `src/styles/tokens.css`.
