#!/usr/bin/env bash
# Stop hook — safety-net reaper for Herdr panes agentille spawned.
#
# agentille spawns worker agents into Herdr panes named `agt-*`. The spawning
# session ("lead") normally closes them itself once their work is consumed,
# but when the lead's turn ends, crashes, or is interrupted, finished workers
# can stay idle/done and open forever. This script closes exactly those panes,
# and nothing else — it MUST NEVER touch an agent whose name doesn't match
# `^agt-`, no matter its status.
#
# Must NEVER error or block the session: every failure path is a silent exit 0.

# Never let an unexpected failure propagate past this script — a hook must
# never break the user's session. (Not paired with `set -e`, so this only
# catches unconditional command failures — that's the intended safety net,
# not a substitute for explicit error handling below.)
trap 'exit 0' ERR

DRY_RUN=0
VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --verbose) VERBOSE=1 ;;
  esac
done

log_v() {
  [[ "$VERBOSE" == "1" ]] && echo "[agentille-reap] $*" >&2
  return 0
}

# ── Portable timeout guard ────────────────────────────────────────────────
# `timeout` may not exist on macOS (no coreutils); fall back to `gtimeout`,
# and if neither exists, run without a hard timeout rather than failing.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

run_timed() {
  # $1 = seconds, rest = command
  local secs="$1"; shift
  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" "$secs" "$@"
  else
    "$@"
  fi
}

FETCH_TIMEOUT=5
CLOSE_TIMEOUT=5

# ── Hard no-op guards ────────────────────────────────────────────────────
# AGENTILLE_REAP_LIST_CMD overrides the command used to fetch agent JSON —
# lets tests feed synthetic data without a live herdr session. When it's
# unset (normal operation) we require the real prerequisites.
if [[ -z "${AGENTILLE_REAP_LIST_CMD:-}" ]]; then
  [[ "${HERDR_ENV:-}" == "1" ]] || exit 0
  command -v herdr >/dev/null 2>&1 || exit 0
fi
command -v jq >/dev/null 2>&1 || exit 0

fetch_agent_list() {
  if [[ -n "${AGENTILLE_REAP_LIST_CMD:-}" ]]; then
    run_timed "$FETCH_TIMEOUT" bash -c "$AGENTILLE_REAP_LIST_CMD" 2>/dev/null
  else
    run_timed "$FETCH_TIMEOUT" herdr agent list 2>/dev/null
  fi
}

LIST_JSON="$(fetch_agent_list)" || exit 0
[[ -n "$LIST_JSON" ]] || exit 0
printf '%s' "$LIST_JSON" | jq -e '.result.agents' >/dev/null 2>&1 || exit 0

# ── Config ───────────────────────────────────────────────────────────────
DONE_GRACE="${AGENTILLE_REAP_DONE_GRACE:-90}"
[[ "$DONE_GRACE" =~ ^[0-9]+$ ]] || DONE_GRACE=90
IDLE_GRACE="${AGENTILLE_REAP_IDLE_GRACE:-300}"
[[ "$IDLE_GRACE" =~ ^[0-9]+$ ]] || IDLE_GRACE=300

STATE_DIR="${AGENTILLE_REAP_STATE_DIR:-$HOME/.agentille/state/reaper}"
REAP_LOG="$STATE_DIR/reap.log"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

NOW="$(date +%s)" || exit 0

# ── Name/pane sanitizer — the tracking-file key must never let a crafted
# agent name or pane id escape $STATE_DIR (path traversal, weird chars). ──
safe_token() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '_'
}

# ── Pull every agt-* agent (any status) — needed both to act on reapable
# ones and to know which tracking files still correspond to a live agent. ──
# Portable read (macOS ships bash 3.2 — no `mapfile`/`readarray`).
AGT_LINES=()
while IFS= read -r __line; do
  [[ -n "$__line" ]] && AGT_LINES+=("$__line")
done < <(printf '%s' "$LIST_JSON" | jq -c '
  .result.agents[]
  | select(.name != null and (.name | test("^agt-")))
  | {name, status: .agent_status, pane: .pane_id, seq: .state_change_seq}
' 2>/dev/null)

CURRENT_KEYS=()

reapable_status() {
  case "$1" in
    done|idle) return 0 ;;
    *) return 1 ;;
  esac
}

trim_reap_log() {
  [[ -f "$REAP_LOG" ]] || return 0
  local n
  n=$(wc -l < "$REAP_LOG" 2>/dev/null | tr -d ' ')
  [[ "$n" =~ ^[0-9]+$ ]] || return 0
  if (( n > 500 )); then
    tail -n 500 "$REAP_LOG" > "$REAP_LOG.tmp" 2>/dev/null && mv "$REAP_LOG.tmp" "$REAP_LOG"
  fi
}

# ── Pass 1: index every agt-* agent this poll, and drop tracking files for
# any that are no longer reapable (rule: non-reapable status → forget it). ──
for line in "${AGT_LINES[@]:-}"; do
  [[ -z "$line" ]] && continue
  name=$(printf '%s' "$line" | jq -r '.name')
  status=$(printf '%s' "$line" | jq -r '.status')
  pane=$(printf '%s' "$line" | jq -r '.pane')
  key="$(safe_token "$name")__$(safe_token "$pane")"
  CURRENT_KEYS+=("$key")

  if ! reapable_status "$status"; then
    track_file="$STATE_DIR/$key"
    if [[ -f "$track_file" ]]; then
      rm -f "$track_file" 2>/dev/null || true
      log_v "reset timer for $name ($pane): status=$status is not reapable"
    fi
  fi
done

# ── Pass 2: grace-timer logic + actual reaping for done/idle agt-* agents ──
for line in "${AGT_LINES[@]:-}"; do
  [[ -z "$line" ]] && continue
  name=$(printf '%s' "$line" | jq -r '.name')
  status=$(printf '%s' "$line" | jq -r '.status')
  pane=$(printf '%s' "$line" | jq -r '.pane')
  seq=$(printf '%s' "$line" | jq -r '.seq')

  reapable_status "$status" || continue

  key="$(safe_token "$name")__$(safe_token "$pane")"
  track_file="$STATE_DIR/$key"

  stored_seq=""
  stored_ts=""
  if [[ -f "$track_file" ]]; then
    # shellcheck disable=SC1090
    stored_seq=$(grep -m1 '^seq=' "$track_file" 2>/dev/null | cut -d= -f2)
    stored_ts=$(grep -m1 '^ts=' "$track_file" 2>/dev/null | cut -d= -f2)
  fi

  if [[ -z "$stored_ts" || "$stored_seq" != "$seq" ]]; then
    # First time seen in this state, or the agent moved (state_change_seq
    # changed) since the last poll — reset the continuous-time timer.
    printf 'seq=%s\nts=%s\n' "$seq" "$NOW" > "$track_file" 2>/dev/null
    stored_ts="$NOW"
  fi

  elapsed=$(( NOW - stored_ts ))
  if [[ "$status" == "done" ]]; then
    grace="$DONE_GRACE"
  else
    grace="$IDLE_GRACE"
  fi

  if (( elapsed >= grace )); then
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "[dry-run] would reap: name=$name status=$status pane=$pane elapsed=${elapsed}s (grace=${grace}s)"
      # Dry-run must not mutate reap state — leave the tracking file as-is
      # so repeated dry-run polls keep accumulating elapsed time like a
      # real run would.
    else
      log_v "reaping $name ($pane): status=$status elapsed=${elapsed}s >= grace=${grace}s"
      if run_timed "$CLOSE_TIMEOUT" herdr pane close "$pane" >/dev/null 2>&1; then
        printf '%s name=%s pane=%s status=%s elapsed=%ss\n' \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$NOW")" \
          "$name" "$pane" "$status" "$elapsed" >> "$REAP_LOG" 2>/dev/null
        trim_reap_log
      else
        log_v "close failed for $name ($pane) — leaving tracking file in place"
        continue
      fi
      rm -f "$track_file" 2>/dev/null || true
    fi
  else
    log_v "not yet: $name ($pane) status=$status elapsed=${elapsed}s < grace=${grace}s"
  fi
done

# ── Pass 3: prune tracking files for agents no longer present at all ──────
if [[ -d "$STATE_DIR" ]]; then
  for f in "$STATE_DIR"/*; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == "reap.log" || "$base" == "reap.log.tmp" ]] && continue
    found=0
    for k in "${CURRENT_KEYS[@]:-}"; do
      if [[ "$base" == "$k" ]]; then
        found=1
        break
      fi
    done
    if [[ "$found" == "0" ]]; then
      rm -f "$f" 2>/dev/null || true
      log_v "pruned stale tracking file: $base"
    fi
  done
fi

exit 0
