#!/usr/bin/env bash
# cockpit-hook.sh — deterministic cockpit emitter for Claude Code hooks.
#
# Invoked by Claude Code's PreToolUse / PostToolUse / Stop hooks (Agent
# matchers) via hooks/hooks.json. Reads the hook payload from stdin (JSON),
# resolves the run via the session→run mapping, and emits the correct cockpit
# event(s) to ~/.agentille/cockpit/runs/<run-id>.jsonl.
#
# Design principles:
#   • Fail-closed inputs: any missing/malformed state → silent no-op (exit 0).
#   • Single lock domain: one flock per run guards seq, flags, and mapping.
#   • run_end is owned SOLELY by the Stop hook (synthesises run_start if needed).
#   • Never emit into a wrong run; no mtime guessing.
#   • AGENTILLE_COCKPIT_DEBUG=1 → append one diagnostic line to hook-debug.log.
#
# ALWAYS exits 0 — a hook failure must never derail a Claude Code session.

set -u

# ── helpers ──────────────────────────────────────────────────────────────────

SESSIONS_DIR="${HOME}/.agentille/cockpit/sessions"
RUNS_DIR="${HOME}/.agentille/cockpit/runs"
DEBUG_LOG="${HOME}/.agentille/cockpit/hook-debug.log"
TTL_SECONDS=86400   # 24 h — orphan session mapping prune threshold

_dbg() {
  [ "${AGENTILLE_COCKPIT_DEBUG:-0}" = "1" ] || return 0
  printf '[cockpit-hook] %s\n' "$*" >> "$DEBUG_LOG" 2>/dev/null || true
}

_die() {
  _dbg "no-op: $*"
  exit 0
}

# Validate that a value is safe to use as a path component.
# Allows only [A-Za-z0-9_-]; rejects empty, spaces, slashes, unicode, dots.
_safe_id() {
  case "${1:-}" in
    ""|*[!A-Za-z0-9_-]*) return 1 ;;
    *) return 0 ;;
  esac
}

# Return current epoch seconds (POSIX).
_now() { date +%s 2>/dev/null || printf '0'; }

# Emit one JSON line to the run's .jsonl file (fail-silent, like cockpit-emit.sh).
_emit() {
  local run_dir="$1" json="$2"
  local runs_dir="${RUNS_DIR}"
  local file="${runs_dir}/${run_dir##*/}.jsonl"
  # run_dir is actually the run-id token; derive the file path properly:
  file="${RUNS_DIR}/${1}.jsonl"
  [ -e "$file" ] || { (umask 077; : >> "$file") 2>/dev/null || return 0; }
  printf '%s\n' "$json" >> "$file" 2>/dev/null || true
}

# TTL sweep: prune session mapping files older than TTL_SECONDS.
# Takes the flock on each entry individually (same lock protocol).
_ttl_sweep() {
  [ -d "$SESSIONS_DIR" ] || return 0
  local now; now=$(_now)
  local f run_dir lockfile
  for f in "$SESSIONS_DIR"/*; do
    [ -f "$f" ] || continue
    local mtime; mtime=$(stat -c '%Y' "$f" 2>/dev/null) || continue
    local age=$(( now - mtime ))
    [ "$age" -gt "$TTL_SECONDS" ] || continue
    # Read the run-id to find its lockfile before removing.
    run_dir=$(cat "$f" 2>/dev/null) || continue
    _safe_id "$run_dir" || continue
    lockfile="${RUNS_DIR}/${run_dir}.lock"
    (
      flock -w 2 200 2>/dev/null || exit 0
      rm -f "$f" 2>/dev/null || true
    ) 200>"$lockfile" 2>/dev/null || true
  done
}

# ── parse stdin payload ───────────────────────────────────────────────────────

RAW=$(cat 2>/dev/null) || _die "stdin read failed"
[ -n "$RAW" ] || _die "empty stdin"

# Require jq.
command -v jq >/dev/null 2>&1 || _die "jq not available"

_jq() { printf '%s' "$RAW" | jq -r "$@" 2>/dev/null; }

EVENT=$(_jq '.hook_event_name // empty')
[ -n "$EVENT" ] || _die "no hook_event_name in payload"

SESSION_ID=$(_jq '.session_id // empty')
_safe_id "$SESSION_ID" || _die "session_id absent or invalid: '${SESSION_ID}'"

# ── gate: session→run mapping ─────────────────────────────────────────────────

mkdir -p "$SESSIONS_DIR" 2>/dev/null || _die "cannot create sessions dir"
chmod 700 "$SESSIONS_DIR" 2>/dev/null || true

MAPPING_FILE="${SESSIONS_DIR}/${SESSION_ID}"

_ttl_sweep

[ -f "$MAPPING_FILE" ] || _die "no mapping for session $SESSION_ID — not an /agt run or already ended"

RUN_ID=$(cat "$MAPPING_FILE" 2>/dev/null) || _die "cannot read mapping file"
_safe_id "$RUN_ID" || _die "mapping contains invalid run-id: '${RUN_ID}'"

[ -d "${RUNS_DIR}/${RUN_ID}" ] || _die "run dir missing for $RUN_ID"

# ── single lock domain ────────────────────────────────────────────────────────

LOCK_FILE="${RUNS_DIR}/${RUN_ID}.lock"
RUN_DIR="${RUNS_DIR}/${RUN_ID}"

# Meta helpers (read cockpit-meta.json fields inside the lock).
_meta() {
  local field="$1"
  jq -r "${field} // empty" "${RUN_DIR}/cockpit-meta.json" 2>/dev/null || true
}

# Atomically increment and return the next seq number.
_next_seq() {
  local seq_file="${RUN_DIR}/.seq"
  local n=0
  [ -f "$seq_file" ] && n=$(cat "$seq_file" 2>/dev/null) || n=0
  n=$(( n + 1 ))
  printf '%d' "$n" > "$seq_file" 2>/dev/null || true
  printf '%d' "$n"
}

_emit_event() {
  local json="$1"
  local seq; seq=$(_next_seq)
  local ts; ts=$(_now)
  # Inject seq + ts (prepend fields by reconstruction).
  local final; final=$(printf '%s' "$json" | jq -c --argjson seq "$seq" --argjson ts "$ts" '. + {seq: $seq, ts: $ts}' 2>/dev/null) || final="$json"
  _emit "$RUN_ID" "$final"
}

# ── ensure run_start (call inside lock) ──────────────────────────────────────

_maybe_run_start() {
  local flag="${RUN_DIR}/.run_start_emitted"
  [ -f "$flag" ] && return 0
  # Synthesize run_start from cockpit-meta.json.
  local task mode template stations version schema
  task=$(_meta '.task')
  mode=$(_meta '.mode')
  template=$(_meta '.template')
  stations=$(_meta '.stations')
  version=$(_meta '.version')
  schema=$(_meta '.schema')
  local json
  json=$(jq -cn \
    --arg type "run_start" \
    --arg task "$task" \
    --arg mode "$mode" \
    --arg template "$template" \
    --argjson stations "${stations:-[]}" \
    --arg version "$version" \
    --argjson schema "${schema:-1}" \
    '{type: $type, task: $task, mode: $mode, template: $template, stations: $stations, version: $version, schema: $schema}' \
    2>/dev/null) || json='{"type":"run_start"}'
  _emit_event "$json"
  touch "$flag" 2>/dev/null || true
}

# ── dispatch per event type ───────────────────────────────────────────────────

case "$EVENT" in

  PreToolUse)
    TOOL=$(_jq '.tool_name // empty')
    [ "$TOOL" = "Agent" ] || _die "PreToolUse for non-Agent tool: $TOOL"

    AGENT_TYPE=$(_jq '.tool_input.subagent_type // .agent_type // empty')
    DESCRIPTION=$(_jq '.tool_input.description // empty')

    # Coarse sanitized slice label — never the raw prompt.
    SLICE=""
    if [ -n "$DESCRIPTION" ]; then
      # Truncate to 60 chars, strip anything that looks like PII / shell metacharacters.
      SLICE=$(printf '%s' "$DESCRIPTION" | \
        sed 's/[^A-Za-z0-9 .,_-]/ /g' | \
        tr -s ' ' | \
        cut -c1-60)
    fi

    (
      flock -w 5 200 2>/dev/null || exit 0

      _maybe_run_start

      local_json=""
      case "$AGENT_TYPE" in
        *agentille-planner*)
          local_json=$(jq -cn --arg type "phase" --arg station "plan" --arg status "active" \
            '{type: $type, station: $station, status: $status}' 2>/dev/null)
          ;;
        *agentille-executor*|*executor*)
          local_json=$(jq -cn --arg type "worker" --arg id "$AGENT_TYPE" \
            --arg status "editing" --arg slice "$SLICE" \
            '{type: $type, id: $id, status: $status, slice: $slice}' 2>/dev/null)
          ;;
        *)
          # Unknown agent type — emit a generic worker event.
          local_json=$(jq -cn --arg type "worker" \
            --arg id "${AGENT_TYPE:-unknown}" --arg status "running" \
            '{type: $type, id: $id, status: $status}' 2>/dev/null)
          ;;
      esac

      [ -n "$local_json" ] && _emit_event "$local_json"

    ) 200>"$LOCK_FILE" 2>/dev/null || _die "lock failed for PreToolUse"
    ;;

  PostToolUse)
    TOOL=$(_jq '.tool_name // empty')
    [ "$TOOL" = "Agent" ] || _die "PostToolUse for non-Agent tool: $TOOL"

    # Confirm mapping still exists (Stop may have won the race).
    [ -f "$MAPPING_FILE" ] || _die "mapping gone — Stop already ran"

    AGENT_TYPE=$(_jq '.tool_input.subagent_type // .agent_type // empty')

    # Detect error: tool_response may be a string or object; look for error signals.
    RESPONSE_RAW=$(_jq '.tool_response // empty')
    IS_ERROR="false"
    # Claude Code signals tool errors via is_error:true or an "error" key in tool_response.
    IS_ERR_FIELD=$(_jq '.tool_response.is_error // false')
    ERR_KEY=$(_jq '.tool_response.error // empty')
    if [ "$IS_ERR_FIELD" = "true" ] || [ -n "$ERR_KEY" ]; then
      IS_ERROR="true"
    fi

    # Verdict parse for reviewer agents.
    VERDICT=""
    case "$AGENT_TYPE" in
      *reviewer*)
        # Look for APPROVE/PASS/FAIL/BLOCK/REJECT in output text.
        OUTPUT_TEXT=$(_jq '.tool_response // "" | if type == "string" then . else (.output // .result // .content // "") end')
        case "${OUTPUT_TEXT^^}" in
          *APPROVE*|*APPROVED*|*PASS*|*CLEAN*) VERDICT="pass" ;;
          *BLOCK*|*REJECT*|*FAIL*) VERDICT="fail" ;;
          *REVISE*|*SHOULD-FIX*|*SHOULD_FIX*) VERDICT="revise" ;;
          *) VERDICT="unknown" ;;  # parse failure → unknown, never pass
        esac
        [ "$IS_ERROR" = "true" ] && VERDICT="unknown"
        ;;
    esac

    (
      flock -w 5 200 2>/dev/null || exit 0

      [ -f "$MAPPING_FILE" ] || exit 0  # Stop won race inside lock — drop this event

      local_json=""
      case "$AGENT_TYPE" in
        *agentille-planner*)
          local_json=$(jq -cn --arg type "phase" --arg station "plan" --arg status "done" \
            '{type: $type, station: $station, status: $status}' 2>/dev/null)
          ;;
        *agentille-executor*|*executor*)
          local_json=$(jq -cn --arg type "worker" --arg id "$AGENT_TYPE" \
            --arg status "done" \
            '{type: $type, id: $id, status: $status}' 2>/dev/null)
          ;;
        *reviewer*)
          local_json=$(jq -cn --arg type "verdict" --arg reviewer "$AGENT_TYPE" \
            --arg result "$VERDICT" \
            '{type: $type, reviewer: $reviewer, result: $result, findings: []}' 2>/dev/null)
          ;;
        *)
          local_json=$(jq -cn --arg type "worker" \
            --arg id "${AGENT_TYPE:-unknown}" --arg status "done" \
            '{type: $type, id: $id, status: $status}' 2>/dev/null)
          ;;
      esac

      [ -n "$local_json" ] && _emit_event "$local_json"

    ) 200>"$LOCK_FILE" 2>/dev/null || _die "lock failed for PostToolUse"
    ;;

  Stop)
    (
      flock -w 10 200 2>/dev/null || exit 0

      # (1) Ensure run_start exists.
      _maybe_run_start

      # (2) Emit run_end if not already emitted.
      end_flag="${RUN_DIR}/.run_end_emitted"
      if [ ! -f "$end_flag" ]; then
        outcome=$(_meta '.outcome')
        [ -n "$outcome" ] || outcome="unknown"
        local_json=$(jq -cn --arg type "run_end" --arg outcome "$outcome" \
          '{type: $type, outcome: $outcome}' 2>/dev/null) || \
          local_json='{"type":"run_end","outcome":"unknown"}'
        _emit_event "$local_json"
        touch "$end_flag" 2>/dev/null || true
      fi

      # (3) Remove mapping — terminal. Late Post hooks will no-op.
      rm -f "$MAPPING_FILE" 2>/dev/null || true

    ) 200>"$LOCK_FILE" 2>/dev/null || _die "lock failed for Stop"
    ;;

  *)
    _die "unhandled hook event: $EVENT"
    ;;
esac

exit 0
