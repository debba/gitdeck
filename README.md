# Gitdeck

> The initial scaffolding of this repository was produced in an AI-assisted session with [Claude Code](https://claude.com/claude-code). From here on, code is reviewed and maintained by humans, and contributions are welcome.

<p align="center">
  <a href="https://discord.gg/YrZPHAwMSG"><img src="https://img.shields.io/discord/1470772941296894128?color=5865F2&logo=discord&logoColor=white&label=Discord" alt="Discord" /></a>
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=debba%2Fgh-dashboard&theme=dark"><img src="https://repostars.dev/api/embed?repo=debba%2Fgh-dashboard&theme=dark" alt="RepoStars" /></a>
</p>

An open-source, local dashboard to explore repositories, issues, pull requests, traffic, and CI activity across multiple accounts on GitHub, GitLab, and Forgejo-compatible forges (Codeberg, self-hosted) — from a single interface.

## Demo

<div align="center">
  <img src="public/demo.gif" alt="Gitdeck demo" />
</div>

## What it does

The dashboard pulls data from the GitHub REST and GraphQL APIs and organizes it into a few different views:

- **Repositories** — paginated grid with description, language, stars, forks, open issues, last push and a per-repo health score. Filter by organization, language, visibility, forks/archived; sort by stars, recent activity, etc.
- **Issues / Pull Requests** — cross-repo lists with the same filter sidebar, useful for triage across many projects.
- **Insights** — overview of all repos with alerts ("issues need attention", "security alerts need attention", "no push for X days"), opportunities, and correlations between traffic and recent activity. Each repo gets a status (Strong / Watch / Risky).
- **Alerts** — dedicated security-alert view for Dependabot and code scanning findings, so you can jump straight to the repos that need attention.
- **Daily digest** — short per-repo summary of the day's movement (stars, forks, issues), with an executive summary you can copy as Markdown. Optionally augmented by an OpenAI-generated narrative when `OPENAI_API_KEY` is configured.
- **Board** — Kanban-style view that groups issues into columns (Backlog, To-do, In progress, Ready, In review, etc.).

### Per-repository view

Open any repository to see:

- **Overview** — stars, forks, open issues, owner, license, default branch, last push.
- **Security and quality** — Dependabot and code scanning alert summaries for the repository, with a fallback note when GitHub does not expose the data.
- **Actions** — recent workflow runs.
- **PRs** and **Issues** — open and recent items, paginated.
- **Releases** — release history.
- **Forks** — list of forks, sortable by most stars or recent push.
- **Traffic** — views and clones for the last 14 days, unique visitors/cloners, top referrers, popular paths.
- **Mentions** — references to the repo found via GitHub code/issue search, including previous names of the project.
- **Dependents** — repository relationships, where available.
- **Languages and trend charts** — language breakdown and stars/forks history.
- **Contributors** — paginated list with commit counts.

## Architecture

The app is a single repository with two cooperating processes:

- **Backend** — a Node HTTP server (`src/server.ts` + `src/server/*`) that handles GitHub OAuth (Device Flow), proxies all REST/GraphQL calls, caches responses on disk, and exposes a small JSON API under `/api/*`. The GitHub token is stored locally under `~/.gitdeck/` and **never exposed to the browser**.
- **Frontend** — a React 19 + Vite SPA (`src/main.tsx`, `src/App.tsx`, `src/components/*`, `src/api/*`) that consumes the backend's `/api/*` endpoints.

In production both are served by the Node process: Vite builds the SPA into `dist/client/` and the server falls back to `index.html` for non-API routes.

### Tech stack

| Layer       | Tech                                           |
| ----------- | ---------------------------------------------- |
| Language    | TypeScript                                     |
| Frontend    | React 19, Vite 8                               |
| Backend     | Node `http` + `tsx` watch (dev), compiled JS in production |
| Tests       | Vitest + jsdom                                 |
| Tooling     | `concurrently`, `tsc`                          |

### Translations

UI translations live in `src/i18n/`, with one dictionary file per language. See [docs/translations.md](docs/translations.md) for the workflow to edit text or add another language.

## Prerequisites

- **Node.js 20+** (anything that supports native `fetch` and ESM is fine).
- A **GitHub OAuth App** with **Device Flow enabled** (see next section).
- (Optional) An **OpenAI API key** if you want AI-generated daily digest summaries.

## Configure GitHub

The dashboard talks to GitHub using a personal **OAuth App** with the **Device Authorization Flow**. This means you keep ownership of the credentials and there is no client secret to manage. You only have to do this once.

### 1. Create the OAuth App

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
   (For an org-owned app, use **Settings → Developer settings → OAuth Apps** on the organization instead.)
2. Fill in the form:
   - **Application name** — anything, e.g. `Gitdeck (local)`.
   - **Homepage URL** — `http://127.0.0.1:8765` (or any URL you control; this is informational).
   - **Authorization callback URL** — `http://127.0.0.1:8765` will do. Device Flow does not actually use a redirect, but GitHub requires the field.
3. Click **Register application**.

### 2. Enable Device Flow

On the OAuth App's settings page, tick **Enable Device Flow** and **Update application**. This is required — without it, sign-in will fail with `unsupported_grant_type`.

### 3. Copy the Client ID

You only need the **Client ID** (it looks like `Iv1.xxxxxxxxxxxxxxxx` or `Ov23li...`). **Do not** generate a client secret — Device Flow does not use one, and the dashboard never reads it.

### 4. Export it before starting the server

```bash
export GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
```

You can also put it in a `.env` file or your shell profile. The server reads `process.env.GITHUB_CLIENT_ID` at startup and will refuse to start the OAuth flow without it.

### 5. Sign in from the UI

When you open the dashboard for the first time, it will:

1. call the backend, which asks GitHub for a **device code**;
2. show you a short **user code** and a verification URL (typically <https://github.com/login/device>);
3. you paste the code on GitHub and approve the requested scopes;
4. the backend exchanges the device code for an access token and stores it in `~/.gitdeck/` — **the token never reaches the browser**.

Granted scopes default to `repo read:org project read:user user:email`. To narrow them, set `GITHUB_OAUTH_SCOPES` (see [Configuration](#configuration)). If you ever want to revoke access, remove the app from <https://github.com/settings/applications> and delete the local token file under `~/.gitdeck/`.

## Configuration

The server reads its configuration from environment variables:

| Variable               | Required | Default                                        | Purpose                                          |
| ---------------------- | -------- | ---------------------------------------------- | ------------------------------------------------ |
| `GH_AUTH_MODE`         | no       | `device`                                       | Auth source: `device` (OAuth Device Flow), `gh-cli` (reuse local `gh` CLI), or `token` (use `GITHUB_TOKEN`). Aliases accepted: `GITHUB_AUTH_MODE`, `GITHUB_MODE`. |
| `GITHUB_CLIENT_ID`     | only `device` | —                                         | Client ID of your GitHub OAuth App (Device Flow) |
| `GITHUB_OAUTH_SCOPES`  | no       | `repo read:org project read:user user:email`   | OAuth scopes requested at sign-in (Device Flow)  |
| `GITHUB_TOKEN`         | only `token` | —                                          | Personal access token used when `GH_AUTH_MODE=token` |
| `HOST`                 | no       | `127.0.0.1`                                    | Interface the server binds to                    |
| `PORT`                 | no       | `8765`                                         | Port the server listens on                       |
| `OPENAI_API_KEY`       | no       | —                                              | Enables AI-generated daily digest narratives     |
| `GITLAB_CLIENT_ID`     | no       | —                                              | Enables GitLab OAuth when paired with `GITLAB_CLIENT_SECRET` |
| `GITLAB_CLIENT_SECRET` | no       | —                                              | OAuth application secret for the selected GitLab instance |
| `GITLAB_REDIRECT_URI`  | no       | inferred from request                          | Exact GitLab OAuth callback URL, ending in `/api/auth/gitlab/callback` |
| `GITLAB_OAUTH_INSTANCE_URL` | no  | `https://gitlab.com`                           | GitLab instance on which the configured OAuth app is registered |
| `OPENAI_DIGEST_MODEL`  | no       | `gpt-4.1-mini`                                 | Model used for digest narratives                 |
| `GITDECK_DIAGNOSTICS`  | no       | —                                              | Set to `1` to log provider call durations        |

### Authentication modes

The dashboard can obtain a GitHub token in three different ways. Pick the one that fits your setup:

- **`device` (default)** — OAuth App + Device Flow, as described above. The token is stored under `~/.gitdeck/` and refreshed via the in-app sign-in screen. Requires `GITHUB_CLIENT_ID`.
- **`gh-cli`** — if you already use the [GitHub CLI](https://cli.github.com/), set `GH_AUTH_MODE=gh-cli` and the server will read the token by running `gh auth token` on each request (cached in-process for 60s). No OAuth App is needed; the scopes are whatever your `gh` session already has. Run `gh auth refresh -h github.com -s repo,read:org,project` if you need extra scopes.
- **`token`** — bring-your-own personal access token. Set `GH_AUTH_MODE=token` and export `GITHUB_TOKEN=<your-pat>`. Useful for headless / CI-style deployments.

In `gh-cli` and `token` modes the device-flow sign-in screen is hidden; the server treats the configured source as authoritative.

Tokens and snapshots are persisted under `~/.gitdeck/`. If you previously ran an older build that stored data in `~/.gh-issues-dashboard/`, the server migrates it automatically on first start.

### GitLab accounts

Choose **GitLab** from the account picker. The instance URL defaults to `https://gitlab.com`; replace it to connect a self-hosted instance, including installations hosted under a URL path. You can always authenticate with a personal access token carrying the `api` scope.

OAuth is shown when `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET` are configured. Register an OAuth application on the target GitLab instance with scopes `api`, `read_user`, and `read_repository`. Its redirect URI must be `http(s)://<gitdeck-host>/api/auth/gitlab/callback`; set `GITLAB_REDIRECT_URI` when the URL cannot be inferred from the incoming request. OAuth application credentials are instance-specific: set `GITLAB_OAUTH_INSTANCE_URL` for a self-hosted instance. Other instances remain available through personal access tokens.

The initial integration supports repositories, issues, merge requests, and pending todos in the inbox. GitLab CI, traffic, and repository detail APIs are not enabled yet.

### Quick env setup

```bash
export GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
# optional
export OPENAI_API_KEY=sk-...
```

## Install

```bash
npm install
```

## Run in development

Starts the API server (with file-watch reload) and the Vite dev server in parallel. The Vite dev server proxies `/api` to the backend on port `8765`.

```bash
npm run dev
```

Then open <http://127.0.0.1:5173>. On first launch the UI will walk you through the GitHub Device Flow sign-in.

If you only want one of the two processes:

```bash
npm run api    # backend only, on http://127.0.0.1:8765
```

## Build

Type-checks the server, compiles it to `dist/`, and produces the production frontend bundle under `dist/client/`:

```bash
npm run build
```

## Run the production build

After `npm run build`, the Node server can serve both the API and the built SPA from a single port:

```bash
npm start
# or, equivalently
npm run serve
```

Then open <http://127.0.0.1:8765>.

`npm run preview` is also available if you want to preview only the static frontend through Vite (no backend).

## Run with Docker

A multi-stage `Dockerfile` and a `docker-compose.yml` are provided. The image builds the server + SPA bundle and runs as a non-root user; tokens and snapshots are persisted to a named volume mounted at `/home/node/.gitdeck`.

If you already have an older compose file, make sure the persistent volume is mounted at `/home/node/.gitdeck` and not the legacy `/home/node/.gh-issues-dashboard` path, otherwise the login state will not survive restarts.

With Docker Compose (recommended):

```bash
cat > .env <<'EOF'
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
# Optional — enables AI-generated daily digest narratives
OPENAI_API_KEY=sk-...
# Optional overrides
# OPENAI_DIGEST_MODEL=gpt-4.1-mini
# GITHUB_OAUTH_SCOPES=repo read:org project read:user user:email
EOF
docker compose up -d --build
# open http://127.0.0.1:8765
```

With plain Docker:

```bash
docker build -t gitdeck .
docker run -d --name gitdeck \
  -p 8765:8765 \
  -e GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx \
  -e OPENAI_API_KEY=sk-... \
  -v gitdeck-data:/home/node/.gitdeck \
  gitdeck
```

The container forwards `GITHUB_CLIENT_ID`, `GITHUB_OAUTH_SCOPES`, `OPENAI_API_KEY` and `OPENAI_DIGEST_MODEL` from the host environment (or `.env` with Compose) — see [Configuration](#configuration) for the full list. It sets `HOST=0.0.0.0` so the server is reachable from outside. To wipe the stored token (full logout) remove the volume: `docker volume rm gitdeck-data`.

## Test & type-check

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Tests live under `tests/` and mirror the structure of `src/` (see [AGENTS.md](AGENTS.md)).

### Load diagnostics

Base dashboard loads retain the latest 50 measurements in memory, including time to first content, total duration, cache hits, deduplicated requests, and network requests. In the browser console, enable per-load logging with:

```js
localStorage.setItem("gh-dash.diagnostics", "1")
```

Provider-side call counts and timings are available from `GET /api/diagnostics/provider-metrics`. Set `GITDECK_DIAGNOSTICS=1` to also log every measured provider operation on the server.

## Project layout

```
.
├── index.html                 # SPA entrypoint consumed by Vite
├── src/
│   ├── main.tsx               # React bootstrap
│   ├── App.tsx                # Top-level component & routing
│   ├── api/                   # Browser-side API client (calls /api/*)
│   ├── components/            # UI: views, modals, common, sidebar, top bar
│   ├── styles/                # CSS modules (tokens, layout, views, modals, …)
│   ├── server.ts              # Node HTTP server entrypoint
│   ├── server/                # OAuth, GitHub client, caches, digests, insights
│   ├── types/github.ts        # Shared TypeScript types
│   └── utils/                 # Pure logic (covered by unit tests)
├── tests/                     # Vitest suites mirroring src/
├── docs/                      # Contributor documentation
├── public/                    # Static assets (demo media)
├── vite.config.ts
├── tsconfig.json              # Frontend TS config
└── tsconfig.server.json       # Server TS config (build → dist/)
```

## Status

Early scaffolding. APIs, modules, and the UI are still being shaped — expect rapid changes. Star the repo and join Discord to follow along.

## Community

- [Discord server](https://discord.gg/YrZPHAwMSG) — suggest features, report issues, or just say hi.

## Contributing

Before opening a PR, please skim [AGENTS.md](AGENTS.md) for the project conventions (English-only identifiers, pure logic in `src/utils/` with mirrored tests, no GitHub tokens on the browser, etc.) and run `npm test` + `npm run build`.

## License

MIT License — see [LICENSE](LICENSE).
