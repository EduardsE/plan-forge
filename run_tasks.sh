#!/usr/bin/env bash
#
# run_tasks.sh — work through PROGRESS.md task-by-task using Claude Code headless mode.
#
# Each task runs as a COMPLETELY FRESH `claude -p` invocation (no --resume / --continue),
# so every task starts with a clean context. The loop re-reads PROGRESS.md each iteration,
# which makes it idempotent and safe to Ctrl-C and re-run: it simply picks up at whatever
# PROGRESS.md now says is the first unchecked task.
#
# Usage:
#   ./run_tasks.sh [--dry-run] [--max-tasks N] [--max-turns N]
#
# Flags:
#   --dry-run        Show the task that would run next, then stop (no Claude invocation).
#   --max-tasks N    Process at most N tasks this run (default: unlimited).
#   --max-turns N    Cap Claude's turns per task (default: $MAX_TURNS below / env MAX_TURNS).
#   -h, --help       Show this help.
#
# Env overrides:
#   PROGRESS_FILE    Path to the progress file      (default: <script dir>/PROGRESS.md)
#   PROMPT_FILE      Path to the task prompt         (default: <script dir>/task_prompt.txt)
#   LOG_FILE         Where to append run records     (default: <script dir>/task_runner.log)
#   MAX_TURNS        Turns per task                  (default: 60)
#   MODEL            Model to pass to `claude`       (default: unset — Claude's default)
#   ALLOWED_TOOLS    Comma-separated tool allowlist  (default: Read,Edit,Write,Bash,Grep,Glob)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROGRESS_FILE="${PROGRESS_FILE:-$SCRIPT_DIR/PROGRESS.md}"
PROMPT_FILE="${PROMPT_FILE:-$SCRIPT_DIR/task_prompt.txt}"
LOG_FILE="${LOG_FILE:-$SCRIPT_DIR/task_runner.log}"
MAX_TURNS="${MAX_TURNS:-60}"
MODEL="${MODEL:-}"
ALLOWED_TOOLS="${ALLOWED_TOOLS:-Read,Edit,Write,Bash,Grep,Glob}"

DRY_RUN=0
MAX_TASKS=0   # 0 = unlimited

usage() { sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# ---- arg parsing ------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=1; shift ;;
    --max-tasks)     MAX_TASKS="${2:?--max-tasks needs a number}"; shift 2 ;;
    --max-tasks=*)   MAX_TASKS="${1#*=}"; shift ;;
    --max-turns)     MAX_TURNS="${2:?--max-turns needs a number}"; shift 2 ;;
    --max-turns=*)   MAX_TURNS="${1#*=}"; shift ;;
    -h|--help)       usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; echo "Try --help." >&2; exit 2 ;;
  esac
done

for n in MAX_TASKS MAX_TURNS; do
  [[ "${!n}" =~ ^[0-9]+$ ]] || { echo "$n must be a non-negative integer (got '${!n}')" >&2; exit 2; }
done

# ---- preflight --------------------------------------------------------------
command -v claude >/dev/null || { echo "FATAL: 'claude' CLI not found on PATH." >&2; exit 1; }
command -v jq     >/dev/null || { echo "FATAL: 'jq' not found on PATH." >&2; exit 1; }
[[ -f "$PROGRESS_FILE" ]] || { echo "FATAL: progress file not found: $PROGRESS_FILE" >&2; exit 1; }
[[ -f "$PROMPT_FILE"   ]] || { echo "FATAL: prompt file not found: $PROMPT_FILE" >&2; exit 1; }

# Scope task detection to a "## Upcoming" section if the file has one; otherwise
# treat the first unchecked box anywhere as the next task.
if grep -qiE '^##[[:space:]]+Upcoming' "$PROGRESS_FILE"; then
  SCOPED=1
else
  SCOPED=0
fi

# Print the full text of the first "- [ ]" line (empty string if none remain).
first_incomplete_task() {
  awk -v scoped="$SCOPED" '
    scoped && /^##[[:space:]]+[Uu]pcoming/ { insec=1; next }
    scoped && /^## /                       { insec=0 }
    (!scoped || insec) && /^[[:space:]]*-[[:space:]]+\[ \]/ { print; exit }
  ' "$PROGRESS_FILE"
}

count_incomplete() {
  awk -v scoped="$SCOPED" '
    scoped && /^##[[:space:]]+[Uu]pcoming/ { insec=1; next }
    scoped && /^## /                       { insec=0 }
    (!scoped || insec) && /^[[:space:]]*-[[:space:]]+\[ \]/ { c++ }
    END { print c+0 }
  ' "$PROGRESS_FILE"
}

# Trim markdown scaffolding for a readable one-line label.
label_of() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]*-[[:space:]]+\[ \][[:space:]]*//; s/\*\*//g' | cut -c1-90
}

log() { printf '%s\n' "$*" | tee -a "$LOG_FILE"; }

# ---- main loop --------------------------------------------------------------
remaining="$(count_incomplete)"
log "── run_tasks started $(date '+%Y-%m-%dT%H:%M:%S') · $remaining unchecked task(s) · max-turns=$MAX_TURNS · dry-run=$DRY_RUN · max-tasks=$([[ $MAX_TASKS -eq 0 ]] && echo unlimited || echo $MAX_TASKS)"

processed=0
total_cost="0"

while :; do
  if [[ $MAX_TASKS -gt 0 && $processed -ge $MAX_TASKS ]]; then
    log "Reached --max-tasks=$MAX_TASKS after $processed task(s); stopping."
    break
  fi

  task="$(first_incomplete_task)"
  if [[ -z "$task" ]]; then
    log "No incomplete tasks remaining. All done."
    break
  fi

  lbl="$(label_of "$task")"
  echo ""
  echo "▶ Next task: $lbl"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "(dry-run) Would invoke a fresh 'claude -p' on this task. Not running."
    break
  fi

  before="$task"
  out_file="$(mktemp "${TMPDIR:-/tmp}/task_runner.XXXXXX.json")"
  err_file="$out_file.err"
  start=$(date +%s)

  # Fresh, isolated invocation — no --resume / --continue, so context is clean each time.
  set +e
  claude -p "$(cat "$PROMPT_FILE")" \
    --output-format json \
    --allowedTools "$ALLOWED_TOOLS" \
    --permission-mode acceptEdits \
    --max-turns "$MAX_TURNS" \
    ${MODEL:+--model "$MODEL"} \
    >"$out_file" 2>"$err_file"
  claude_exit=$?
  set -e

  end=$(date +%s)
  elapsed=$((end - start))
  ts="$(date '+%Y-%m-%dT%H:%M:%S')"

  # Must be valid JSON to trust it. If not, something crashed — stop and preserve output.
  if ! jq -e . "$out_file" >/dev/null 2>&1; then
    log "$ts | INVALID-JSON | ${elapsed}s | exit=$claude_exit | $lbl"
    echo "FATAL: 'claude' did not return valid JSON (exit $claude_exit)." >&2
    echo "  stdout: $out_file" >&2
    echo "  stderr: $err_file" >&2
    echo "  last stderr lines:" >&2
    tail -n 5 "$err_file" >&2 || true
    exit 1
  fi

  subtype="$(jq -r '.subtype // "unknown"' "$out_file")"
  is_error="$(jq -r '.is_error // false' "$out_file")"
  cost="$(jq -r '.total_cost_usd // 0' "$out_file")"
  turns="$(jq -r '.num_turns // 0' "$out_file")"
  result="$(jq -r '.result // ""' "$out_file")"

  total_cost="$(awk -v a="$total_cost" -v b="$cost" 'BEGIN { printf "%.4f", a + b }')"
  costf="$(awk -v c="$cost" 'BEGIN { printf "%.4f", c }')"

  log "$ts | $subtype | ${elapsed}s | \$$costf | ${turns} turns | $lbl"

  # Any non-success result stops the loop rather than marching to the next task.
  if [[ "$subtype" != "success" || "$is_error" == "true" ]]; then
    echo "" >&2
    echo "STOP: task did not complete successfully (subtype=$subtype, is_error=$is_error)." >&2
    echo "Claude's final message:" >&2
    echo "$result" | sed 's/^/  /' >&2
    echo "Raw JSON: $out_file" >&2
    exit 1
  fi

  # Stall guard: a "success" that left the same task still unchecked would loop forever
  # (e.g. Claude hit a block and wrote a BLOCKED note instead of finishing). Detect it.
  after="$(first_incomplete_task)"
  if [[ "$after" == "$before" ]]; then
    echo "" >&2
    echo "STOP: run reported success but the first unchecked task is unchanged — no progress." >&2
    echo "The task was likely blocked or left a note. Check PROGRESS.md for a BLOCKED marker." >&2
    echo "Claude's final message:" >&2
    echo "$result" | sed 's/^/  /' >&2
    exit 1
  fi

  processed=$((processed + 1))
  rm -f "$out_file" "$err_file"
  echo "✓ Task complete. Progressed to the next one."
done

echo ""
log "── run_tasks finished · processed $processed task(s) · total cost \$$total_cost · $(date '+%Y-%m-%dT%H:%M:%S')"
