#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
PROJECT_DIR="${ROOT_DIR}/growth-studio-project"
PLAN_FILE="${PROJECT_DIR}/docs/GS_PLAN.md"
MATRIX_FILE="${PROJECT_DIR}/docs/GS_FEATURE_MATRIX.md"
DECISIONS_FILE="${PROJECT_DIR}/docs/GS_DECISIONS.md"
TASK_DIR="${PROJECT_DIR}/tasks"
PROGRESS_FILE="${TASK_DIR}/PROGRESS.md"
GATE="${PROJECT_DIR}/scripts/validate-gs-task.sh"
GATE_REL="growth-studio-project/scripts/validate-gs-task.sh"
RUN_DIR="${PROJECT_DIR}/.runtime"
LOG_DIR="${RUN_DIR}/logs"
STATE_FILE="${RUN_DIR}/state.tsv"
LOCK_DIR="${RUN_DIR}/lock"
BRANCH="${GS_LOOP_BRANCH:-feat/growth-studio}"
AGENT="${GS_LOOP_AGENT:-pi}"
MODEL="${GS_LOOP_MODEL:-}"
THINKING="${GS_LOOP_THINKING:-high}"   # pi agent only
REPAIR_ATTEMPTS="${GS_LOOP_REPAIR_ATTEMPTS:-3}"
MAX_TASKS="${GS_LOOP_MAX_TASKS:-0}"   # 0 = run until no PENDING task remains
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_PREFIX="[gitdeck-gs]"
NOTIFY=1
DRY_RUN=0
FORCE=0
LIVE="${GS_LOOP_LIVE:-}"   # empty = auto (enabled when stdout is a TTY)
TASKS=()

usage() {
  cat <<'USAGE'
Usage: growth-studio-project/scripts/run-gs-tasks.sh [options] [GS-NNN ...]

Runs one non-interactive agent session per task, sequentially, on the loop
branch (feat/growth-studio by default, override with GS_LOOP_BRANCH). With no
task IDs the runner re-scans growth-studio-project/tasks/PROGRESS.md after
every task and picks the first PENDING one, so tasks authored mid-run (by
phase-closing tasks) are picked up automatically. The runner stops at the
first failed or unvalidated task. Runtime logs and state live under
growth-studio-project/.runtime/ (ignored by Git).

After each session the runner re-runs the validation gate itself
(scripts/validate-gs-task.sh). A failed gate starts a focused repair session
that amends the same task commit, up to GS_LOOP_REPAIR_ATTEMPTS times
(default 3).

Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to receive a Telegram message for
each task state change. Both must be set together. Dry runs do not send
external notifications.

Options:
  --agent AGENT       CLI agent: pi or claude (default: pi)
  --model MODEL       Model override for the selected agent
  --thinking LEVEL    Thinking level, pi agent only (default: high)
  --live              Stream the agent's activity live to the terminal
                      (default: auto — enabled when stdout is a TTY). With the
                      claude agent this uses stream-json output rendered via jq;
                      pi output is always streamed.
  --no-live           Disable live streaming (plain final-output mode)
  --no-notify         Disable desktop notifications
  --dry-run           Print the sessions that would run
  --force             Run tasks even when PROGRESS.md says COMPLETED
  -h, --help          Show this help

Environment:
  GS_LOOP_AGENT             Default for --agent (pi or claude)
  GS_LOOP_MODEL             Default for --model
  GS_LOOP_THINKING          Default for --thinking (pi only)
  GS_LOOP_BRANCH            Loop branch (default: feat/growth-studio)
  GS_LOOP_LIVE              Default for --live: 1/0 (unset = auto by TTY)
  GS_LOOP_REPAIR_ATTEMPTS   Maximum repair sessions per task (default: 3)
  GS_LOOP_MAX_TASKS         Stop after N tasks in auto mode (default: 0 = all)
  GS_VALIDATION_CACHE       Reuse successful checks for unchanged inputs (default: 1)
  GS_VALIDATION_CACHE_TTL   Cache lifetime in seconds (default: 21600; 0 disables hits)
USAGE
}

iso_now() {
  date +%Y-%m-%dT%H:%M:%S%z
}

notify() {
  local title="$1" message="$2"
  printf '\a[%s] %s: %s\n' "$(iso_now)" "$title" "$message"
  if (( NOTIFY )); then
    if command -v notify-send >/dev/null 2>&1; then
      notify-send "$title" "$message" >/dev/null 2>&1 || true
    elif command -v osascript >/dev/null 2>&1; then
      osascript \
        -e 'on run argv' \
        -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
        -e 'end run' \
        "$title" "$message" >/dev/null 2>&1 || true
    fi
  fi
}

notify_telegram() {
  local title="$1" message="$2"
  [[ -n "$TELEGRAM_BOT_TOKEN" ]] || return 0
  if ! curl --silent --show-error --fail \
    --connect-timeout 5 --max-time 15 --retry 2 \
    --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${TELEGRAM_PREFIX} ${title}: ${message}" \
    >/dev/null; then
    echo "Warning: failed to send Telegram notification." >&2
  fi
}

record_task_state() {
  local task="$1" state="$2" reference="$3" title="$4" message="$5"
  printf '%s\t%s\t%s\t%s\n' \
    "$(iso_now)" "$task" "$state" "$reference" >> "$STATE_FILE"
  notify "$title" "$message"
  if (( ! DRY_RUN )); then
    notify_telegram "$title" "$message"
  fi
}

completion_progress() {
  awk -F '|' '
    function trim(v) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", v); return v }
    {
      task = trim($2); status = trim($3)
      if (task ~ /^GS-[0-9][0-9][0-9]$/) {
        total++
        if (status == "COMPLETED") completed++
      }
    }
    END {
      percentage = total == 0 ? 0 : completed * 100 / total
      printf "%.1f%% (%d/%d)", percentage, completed, total
    }
  ' "$PROGRESS_FILE"
}

progress_field() {
  local task="$1" column="$2"
  awk -F '|' -v task="$task" -v column="$column" '
    function trim(v) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", v); return v }
    trim($2) == task { print trim($column) }
  ' "$PROGRESS_FILE"
}

first_pending_task() {
  while IFS= read -r task_file; do
    local task
    task="$(basename "$task_file" .md)"
    if [[ "$(progress_field "$task" 3)" == "PENDING" ]]; then
      printf '%s\n' "$task"
      return 0
    fi
  done < <(find "$TASK_DIR" -maxdepth 1 -type f -name 'GS-[0-9][0-9][0-9].md' | sort)
  return 1
}

validate_progress_entry() {
  local task="$1"
  local row_count status summary verification updated

  row_count="$(awk -F '|' -v task="$task" '
    function trim(v) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", v); return v }
    trim($2) == task { count++ }
    END { print count + 0 }
  ' "$PROGRESS_FILE")"
  [[ "$row_count" == "1" ]] || {
    echo "PROGRESS.md must contain exactly one row for $task." >&2
    return 1
  }

  status="$(progress_field "$task" 3)"
  summary="$(progress_field "$task" 4)"
  verification="$(progress_field "$task" 5)"
  updated="$(progress_field "$task" 6)"

  [[ "$status" == "COMPLETED" ]] || {
    echo "$task is not COMPLETED in PROGRESS.md (status: $status)." >&2
    return 1
  }
  [[ -n "$summary" && "$summary" != "—" ]] || {
    echo "$task has no completion summary in PROGRESS.md." >&2
    return 1
  }
  [[ -n "$verification" && "$verification" != "—" ]] || {
    echo "$task has no verification evidence in PROGRESS.md." >&2
    return 1
  }
  [[ "$updated" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
    echo "$task has no valid ISO completion date in PROGRESS.md." >&2
    return 1
  }
  if ! git diff --quiet -- "$PROGRESS_FILE" || \
    ! git diff --cached --quiet -- "$PROGRESS_FILE"; then
    echo "PROGRESS.md has uncommitted changes; the $task record must be committed." >&2
    return 1
  fi
}

# Render claude stream-json events as readable live output: assistant text,
# tool invocations and the final result. Non-JSON lines pass through untouched.
format_claude_stream() {
  jq -Rr --unbuffered '
    . as $raw | (try fromjson catch null) as $ev |
    if ($ev | type) != "object" then $raw
    elif $ev.type == "assistant" then
      ([$ev.message.content[]? |
        if .type == "text" then .text
        elif .type == "tool_use" then
          "→ " + .name + " " + ((.input | tojson) | .[0:200])
        else empty end
      ] | join("\n") | select(length > 0))
    elif $ev.type == "result" then
      "\n■ session " + ($ev.subtype // "done") +
      (if $ev.total_cost_usd then
        " (cost: $" + ($ev.total_cost_usd | tostring | .[0:6]) + ")"
      else "" end)
    else empty end'
}

run_agent() {
  # $1 = session name, $2 = prompt, $3 = log file, $4.. = context files (pi only)
  local name="$1" prompt="$2" log_file="$3" status
  shift 3
  local cmd=()

  if [[ "$AGENT" == "pi" ]]; then
    cmd=(pi --print --approve --name "$name" --thinking "$THINKING")
    [[ -z "$MODEL" ]] || cmd+=(--model "$MODEL")
    local ctx
    for ctx in "$@"; do
      cmd+=("@${ctx}")
    done
    cmd+=("$prompt")
    set +e
    env -u PI_SESSION_ID -u PI_SESSION_FILE -u PI_PROVIDER -u PI_MODEL \
      -u PI_REASONING_LEVEL "${cmd[@]}" 2>&1 | tee -a "$log_file"
    status=${PIPESTATUS[0]}
    set -e
  else
    cmd=(claude -p --dangerously-skip-permissions)
    [[ -z "$MODEL" ]] || cmd+=(--model "$MODEL")
    if (( LIVE )) && command -v jq >/dev/null 2>&1; then
      cmd+=(--verbose --output-format stream-json)
      set +e
      "${cmd[@]}" "$prompt" 2>&1 | format_claude_stream | tee -a "$log_file"
      status=${PIPESTATUS[0]}
      set -e
    else
      set +e
      "${cmd[@]}" "$prompt" 2>&1 | tee -a "$log_file"
      status=${PIPESTATUS[0]}
      set -e
    fi
  fi

  printf '\n[%s] session %s (%s) exited with status %s\n' \
    "$(iso_now)" "$name" "$AGENT" "$status" >> "$log_file"
  return "$status"
}

run_task() {
  local task="$1"
  local task_file="${TASK_DIR}/${task}.md"
  local timestamp log_file status gate_status repair_attempt repair_status

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  log_file="${LOG_DIR}/${timestamp}-${task}.log"

  local prompt
  read -r -d '' prompt <<PROMPT || true
Execute exactly task ${task} from ${task_file} in the current repository.

Mandatory workflow:
- Read ${task_file}, ${PLAN_FILE}, ${MATRIX_FILE}, ${DECISIONS_FILE}, ${PROGRESS_FILE} and AGENTS.md before editing anything.
- Work only on ${task}; do not start later tasks and do not invoke the task runner or spawn parallel agents.
- Stay on the ${BRANCH} branch. Inspect git status first; preserve unrelated changes and never discard user work.
- Hard constraints from the plan: the rest of GitDeck keeps its routes, layout and behavior; English for code, comments, docs and commit messages; pure logic in src/utils with tests in tests/utils; no tests under src; forge API access only through server endpoints; every new UI string in both src/i18n/en.ts and src/i18n/it.ts; no new native dependencies; additive idempotent schema changes; no outbound social posting.
- Set ${task} to IN_PROGRESS in ${PROGRESS_FILE} before implementation.
- Study the existing code listed in the plan for the touched area before writing new code; extend existing helpers instead of duplicating them.
- Implement the smallest complete change for the task scope, then run the validation gate: ${GATE_REL}. It must end with VALIDATION OK.
- Update ${MATRIX_FILE} rows touched by the task, and ${DECISIONS_FILE} when the task had to settle a new decision.
- Review the full diff and git diff --check.
- When verified, set ${task} to COMPLETED in PROGRESS.md with a concise single-line summary, verification evidence, and an ISO date. Do not use the | character in progress fields.
- Create the task's single conventional commit with scope growth (for example feat(growth): ...) including its PROGRESS.md update. Do not add a Co-Authored-By trailer. Commit only when the gate is green. Do not push.
- If blocked, set ${task} to BLOCKED with the blocker and available verification evidence, commit nothing half-done, and stop without claiming completion.
- Finish with a concise summary containing status (COMPLETED or BLOCKED), commit hash if completed, tests run, and remaining concerns.
PROMPT

  record_task_state "$task" "STARTED" "$log_file" \
    "GS task started" "$task (progress: $(completion_progress); log: $log_file)"

  set +e
  run_agent "gs-${task}" "$prompt" "$log_file" \
    "$PLAN_FILE" "$DECISIONS_FILE" "$task_file" "$PROGRESS_FILE"
  status=$?
  set -e

  if ! validate_progress_entry "$task"; then
    if (( status == 0 )); then
      record_task_state "$task" "FAILED(PROGRESS)" "$log_file" \
        "GS task not validated" \
        "$task did not complete its PROGRESS.md record (progress: $(completion_progress))"
    else
      record_task_state "$task" "FAILED(${status})" "$log_file" \
        "GS task failed" "$task session exited with status $status (progress: $(completion_progress))"
    fi
    return 1
  fi

  repair_attempt=0
  while :; do
    set +e
    "$GATE" 2>&1 | tee -a "$log_file"
    gate_status=${PIPESTATUS[0]}
    set -e
    (( gate_status != 0 )) || break

    if (( repair_attempt >= REPAIR_ATTEMPTS )); then
      record_task_state "$task" "FAILED(GATE)" "$log_file" \
        "GS task gate failed" \
        "$task exhausted $REPAIR_ATTEMPTS repair attempts (progress: $(completion_progress))"
      return 1
    fi

    repair_attempt=$((repair_attempt + 1))
    record_task_state "$task" "REPAIR(${repair_attempt})" "$log_file" \
      "GS task repair" \
      "$task repair $repair_attempt/$REPAIR_ATTEMPTS after failed validation gate (progress: $(completion_progress))"

    local repair_prompt
    read -r -d '' repair_prompt <<PROMPT || true
Repair the failed validation gate for exactly task ${task} in the current repository.

Mandatory workflow:
- Run ${GATE_REL} and diagnose the root cause of every failure instead of merely rerunning it.
- Read ${task_file}, ${PLAN_FILE}, ${DECISIONS_FILE} and ${PROGRESS_FILE}. Respect the plan's hard constraints and AGENTS.md.
- Change only what is required to make ${task} and the gate pass. Preserve unrelated work.
- Keep the task's single-commit requirement: amend the existing ${task} commit rather than creating another commit. No Co-Authored-By trailer. Keep PROGRESS.md truthful.
- Do not push and do not start other tasks. Return only after the gate ends with VALIDATION OK, or clearly report a blocker.
PROMPT
    set +e
    run_agent "gs-${task}-repair-${repair_attempt}" "$repair_prompt" "$log_file" \
      "$PLAN_FILE" "$DECISIONS_FILE" "$task_file" "$PROGRESS_FILE"
    repair_status=$?
    set -e
    if (( repair_status != 0 )); then
      record_task_state "$task" "FAILED(REPAIR-${repair_status})" "$log_file" \
        "GS task repair failed" \
        "$task repair $repair_attempt exited with status $repair_status (progress: $(completion_progress))"
      return 1
    fi
    if ! validate_progress_entry "$task"; then
      record_task_state "$task" "FAILED(REPAIR-PROGRESS)" "$log_file" \
        "GS task repair not validated" \
        "$task repair $repair_attempt left an invalid progress record (progress: $(completion_progress))"
      return 1
    fi
  done

  record_task_state "$task" "FINISHED" "$log_file" \
    "GS task finished" "$task completed and gate green (progress: $(completion_progress))"
}

while (($#)); do
  case "$1" in
    --agent)
      [[ $# -ge 2 ]] || { echo "Missing value for --agent" >&2; exit 2; }
      AGENT="$2"; shift 2 ;;
    --model)
      [[ $# -ge 2 ]] || { echo "Missing value for --model" >&2; exit 2; }
      MODEL="$2"; shift 2 ;;
    --thinking)
      [[ $# -ge 2 ]] || { echo "Missing value for --thinking" >&2; exit 2; }
      THINKING="$2"; shift 2 ;;
    --live) LIVE=1; shift ;;
    --no-live) LIVE=0; shift ;;
    --no-notify) NOTIFY=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    GS-[0-9][0-9][0-9]) TASKS+=("$1"); shift ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$ROOT_DIR" ]] || { echo "Run this script inside the GitDeck repository." >&2; exit 1; }
mkdir -p "$LOG_DIR"
[[ -f "$PLAN_FILE" ]] || { echo "Missing tracked plan: $PLAN_FILE" >&2; exit 1; }
[[ -f "$PROGRESS_FILE" ]] || { echo "Missing tracked progress ledger: $PROGRESS_FILE" >&2; exit 1; }
[[ -x "$GATE" ]] || { echo "Validation gate missing or not executable: $GATE" >&2; exit 1; }
case "$AGENT" in
  claude|pi) ;;
  *) echo "Invalid --agent: $AGENT (expected pi or claude)." >&2; exit 2 ;;
esac
command -v "$AGENT" >/dev/null 2>&1 || { echo "$AGENT is not available in PATH." >&2; exit 1; }
if [[ -z "$LIVE" ]]; then
  [[ -t 1 ]] && LIVE=1 || LIVE=0
fi
[[ "$LIVE" =~ ^[01]$ ]] || { echo "GS_LOOP_LIVE must be 0 or 1." >&2; exit 1; }
if (( LIVE )) && [[ "$AGENT" == "claude" ]] && ! command -v jq >/dev/null 2>&1; then
  echo "Note: jq not found; live streaming disabled (plain claude output)." >&2
fi
[[ "$REPAIR_ATTEMPTS" =~ ^[0-9]+$ ]] || {
  echo "GS_LOOP_REPAIR_ATTEMPTS must be a non-negative integer." >&2; exit 1
}
[[ "$MAX_TASKS" =~ ^[0-9]+$ ]] || {
  echo "GS_LOOP_MAX_TASKS must be a non-negative integer." >&2; exit 1
}
if [[ -n "$TELEGRAM_BOT_TOKEN" || -n "$TELEGRAM_CHAT_ID" ]]; then
  [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]] || {
    echo "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together." >&2; exit 1
  }
  command -v curl >/dev/null 2>&1 || { echo "curl is required for Telegram notifications." >&2; exit 1; }
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  if (( DRY_RUN )); then
    echo "Note: dry run on branch $current_branch; real runs require $BRANCH (GS_LOOP_BRANCH)." >&2
  else
    echo "The runner must be started on $BRANCH (current: $current_branch). Set GS_LOOP_BRANCH to override." >&2
    exit 1
  fi
fi

cd "$ROOT_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another GS task runner appears to be active: $LOCK_DIR" >&2
  exit 1
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

if ((${#TASKS[@]} > 0)); then
  for task in "${TASKS[@]}"; do
    task_file="${TASK_DIR}/${task}.md"
    [[ -f "$task_file" ]] || { echo "Task file not found: $task_file" >&2; exit 2; }
    progress_status="$(progress_field "$task" 3)"
    case "$progress_status" in
      PENDING|IN_PROGRESS|BLOCKED|COMPLETED) ;;
      *) echo "Invalid PROGRESS.md status for $task: $progress_status" >&2; exit 2 ;;
    esac
    if [[ "$progress_status" == "COMPLETED" ]] && (( ! FORCE )); then
      validate_progress_entry "$task" || exit 1
      record_task_state "$task" "SKIPPED(COMPLETED)" "$task_file" \
        "GS task skipped" "$task is already completed (progress: $(completion_progress))"
      continue
    fi
    if (( DRY_RUN )); then
      echo "DRY RUN: would run $task via $AGENT (model: ${MODEL:-default})"
      printf '%s\t%s\tDRY-RUN\t%s\n' \
        "$(iso_now)" "$task" "$task_file" >> "$STATE_FILE"
      continue
    fi
    run_task "$task" || exit 1
  done
  exit 0
fi

# Auto mode: re-scan the ledger after every task so tasks authored mid-run
# (by phase-closing tasks) enter the loop automatically.
ran=0
while task="$(first_pending_task)"; do
  if (( MAX_TASKS > 0 && ran >= MAX_TASKS )); then
    echo "Reached GS_LOOP_MAX_TASKS=$MAX_TASKS; stopping."
    exit 0
  fi
  if (( DRY_RUN )); then
    echo "DRY RUN: would run $task via $AGENT (model: ${MODEL:-default}) — auto mode stops here (the task list evolves at runtime)."
    exit 0
  fi
  run_task "$task" || exit 1
  ran=$((ran + 1))
done

notify "GS loop" "No PENDING tasks remain (progress: $(completion_progress))."
notify_telegram "GS loop" "No PENDING tasks remain (progress: $(completion_progress))."
