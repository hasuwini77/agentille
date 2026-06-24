#!/usr/bin/env bash
# cockpit-hook.test.sh — tests for scripts/cockpit-hook.sh
#
# Tests the gating, session_id safety, concurrency, terminal-invariant matrix,
# verdict parsing, privacy (slice label sanitization), and cross-repo schema
# compatibility with agentille-cockpit's parser/reducer.
#
# Usage: bash tests/cockpit-hook.test.sh
# Exit:  0 = all pass · 1 = at least one failure

set -u
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/cockpit-hook.sh"
COCKPIT_REPO="${COCKPIT_REPO:-${HOME}/dev/agentille-cockpit}"

fails=0
total=0

_pass() { printf 'PASS: %s\n' "$1"; total=$((total+1)); }
_fail() { printf 'FAIL: %s\n' "$1"; fails=$((fails+1)); total=$((total+1)); }
_check() {
  total=$((total+1))
  if [ "$1" = "$2" ]; then
    printf 'PASS: %s\n' "$3"
  else
    printf 'FAIL: %s (got %q want %q)\n' "$3" "$1" "$2"
    fails=$((fails+1))
  fi
}

# ── helpers ───────────────────────────────────────────────────────────────────

# Create a minimal run dir + cockpit-meta.json + session mapping.
# Prints the temp HOME dir.
_mk_env() {
  local TH; TH=$(mktemp -d)
  local SESSION_ID="${1:-sess-abc}"
  local RUN_ID="${2:-run-001}"
  local SESSIONS="${TH}/.agentille/cockpit/sessions"
  local RUNS="${TH}/.agentille/cockpit/runs/${RUN_ID}"
  mkdir -p "$SESSIONS" "$RUNS"
  chmod 700 "$SESSIONS"
  printf '%s' "$RUN_ID" > "${SESSIONS}/${SESSION_ID}"
  cat > "${RUNS}/cockpit-meta.json" <<'METAEOF'
{
  "task": "test task",
  "mode": "subagent",
  "template": "",
  "stations": ["recon","plan","build","gate","ship"],
  "version": "1.29.0",
  "schema": 1
}
METAEOF
  printf '%s' "$TH"
}

# Build a hook payload JSON string.
_pre_payload() {
  local session_id="$1" agent_type="${2:-agentille:agentille-executor}" desc="${3:-implement feature X}"
  jq -cn \
    --arg sid "$session_id" \
    --arg at "$agent_type" \
    --arg desc "$desc" \
    '{hook_event_name:"PreToolUse",tool_name:"Agent",session_id:$sid,tool_input:{subagent_type:$at,description:$desc}}'
}

_post_payload() {
  local session_id="$1" agent_type="${2:-agentille:agentille-executor}" output="${3:-done}"
  jq -cn \
    --arg sid "$session_id" \
    --arg at "$agent_type" \
    --arg out "$output" \
    '{hook_event_name:"PostToolUse",tool_name:"Agent",session_id:$sid,tool_input:{subagent_type:$at},tool_response:$out}'
}

_stop_payload() {
  local session_id="$1"
  jq -cn --arg sid "$session_id" '{hook_event_name:"Stop",session_id:$sid}'
}

_run_hook() {
  # $1=HOME, rest=payload string piped to hook
  local home="$1"; shift
  HOME="$home" bash "$SCRIPT" <<< "$*" 2>/dev/null
  return $?
}

_jsonl_lines() {
  local TH="$1" RUN_ID="$2"
  local f="${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl"
  [ -f "$f" ] && wc -l < "$f" | tr -d ' ' || printf '0'
}

_jsonl_types() {
  local TH="$1" RUN_ID="$2"
  local f="${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl"
  [ -f "$f" ] && jq -r '.type' "$f" | sort || true
}

_jsonl_type_count() {
  local TH="$1" RUN_ID="$2" type="$3"
  local f="${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl"
  [ -f "$f" ] && jq -r '.type' "$f" | grep -c "^${type}$" || printf '0'
}

# ── Section 1: Gating (no mapping → zero output) ─────────────────────────────
printf '\n=== 1. GATING (no mapping → zero output) ===\n'

{
  TH=$(mktemp -d)
  # No mapping file for this session.
  mkdir -p "${TH}/.agentille/cockpit/runs/run-001"
  cat > "${TH}/.agentille/cockpit/runs/run-001/cockpit-meta.json" <<'METAEOF'
{"task":"x","mode":"subagent","template":"","stations":[],"version":"1.0.0","schema":1}
METAEOF
  PAY=$(_pre_payload "no-such-session")
  exit_code=0
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null; exit_code=$?
  _check "$exit_code" "0" "G1: exits 0 when no mapping (non-/agt Agent call)"
  lines=$(_jsonl_lines "$TH" "run-001")
  _check "$lines" "0" "G2: no .jsonl written when no mapping"
  rm -rf "$TH"
}

{
  TH=$(mktemp -d)
  mkdir -p "${TH}/.agentille/cockpit/sessions" "${TH}/.agentille/cockpit/runs/run-002"
  printf 'run-002' > "${TH}/.agentille/cockpit/sessions/foreign-session"
  cat > "${TH}/.agentille/cockpit/runs/run-002/cockpit-meta.json" <<'METAEOF'
{"task":"x","mode":"subagent","template":"","stations":[],"version":"1.0.0","schema":1}
METAEOF
  # Use a *different* session_id that has no mapping.
  PAY=$(_pre_payload "another-session")
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null
  lines=$(_jsonl_lines "$TH" "run-002")
  _check "$lines" "0" "G3: foreign session → zero output"
  rm -rf "$TH"
}

{
  # Orphaned run dir (run dir missing) → no-op.
  TH=$(mktemp -d)
  SESSIONS="${TH}/.agentille/cockpit/sessions"
  mkdir -p "$SESSIONS"
  printf 'run-orphan' > "${SESSIONS}/sess-orphan"
  # No run dir created.
  PAY=$(_pre_payload "sess-orphan")
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null
  jsonl_count=$(find "$TH" -name '*.jsonl' 2>/dev/null | wc -l)
  _check "$jsonl_count" "0" "G4: orphaned run dir → zero output"
  rm -rf "$TH"
}

# ── Section 2: session_id adversarial inputs ──────────────────────────────────
printf '\n=== 2. SESSION_ID ADVERSARIAL INPUTS ===\n'

_adversarial_session_id_test() {
  local label="$1" sid="$2"
  TH=$(mktemp -d)
  mkdir -p "${TH}/.agentille/cockpit/sessions"
  PAY=$(jq -cn --arg sid "$sid" \
    '{hook_event_name:"PreToolUse",tool_name:"Agent",session_id:$sid,tool_input:{subagent_type:"agentille:agentille-executor"}}')
  exit_code=0
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null; exit_code=$?
  _check "$exit_code" "0" "${label}: exits 0"
  # Nothing must be written outside the TH sandbox (check only within TH).
  jsonl_count=$(find "$TH" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
  _check "$jsonl_count" "0" "${label}: no .jsonl written (no mapping → no-op)"
  rm -rf "$TH"
}

_adversarial_session_id_test "A1: path-traversal ../../evil" "../../evil"
_adversarial_session_id_test "A2: empty session_id" ""
_adversarial_session_id_test "A3: spaces in session_id" "foo bar"
_adversarial_session_id_test "A4: slash in session_id" "foo/bar"
_adversarial_session_id_test "A5: unicode in session_id" "sëssion"
_adversarial_session_id_test "A6: null bytes (via jq)" "$(printf 'foo\x00bar')"

# ── Section 3: Concurrency (parallel Pre+Post → unique ordered seqs, one run_start) ──
printf '\n=== 3. CONCURRENCY ===\n'

{
  TH=$(_mk_env "sess-conc" "run-conc")
  RUN_ID="run-conc"

  # Fire 5 PreToolUse hooks in parallel (all executor type).
  pids=()
  for i in 1 2 3 4 5; do
    PAY=$(_pre_payload "sess-conc" "agentille:agentille-executor" "slice-${i}")
    HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null || true; done

  lines=$(_jsonl_lines "$TH" "$RUN_ID")
  run_start_count=$(_jsonl_type_count "$TH" "$RUN_ID" "run_start")
  _check "$run_start_count" "1" "C1: exactly one run_start emitted across 5 parallel Pre hooks"

  # Seqs must be unique across all events.
  f="${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl"
  total_seqs=$(jq -r '.seq' "$f" 2>/dev/null | wc -l | tr -d ' ')
  unique_seqs=$(jq -r '.seq' "$f" 2>/dev/null | sort -u | wc -l | tr -d ' ')
  _check "$total_seqs" "$unique_seqs" "C2: all seq values are unique (no collisions)"

  # Seqs should be monotonically increasing when sorted.
  sorted_seqs=$(jq -r '.seq' "$f" 2>/dev/null | sort -n | tr '\n' ',')
  ordered_seqs=$(jq -r '.seq' "$f" 2>/dev/null | tr '\n' ',' )
  # Just check they're all positive integers (ordering is best-effort under concurrency).
  bad_seq=$(jq -r '.seq' "$f" 2>/dev/null | grep -vE '^[0-9]+$' | wc -l | tr -d ' ')
  _check "$bad_seq" "0" "C3: all seqs are non-negative integers"

  rm -rf "$TH"
}

# ── Section 4: Terminal-invariant matrix ──────────────────────────────────────
printf '\n=== 4. TERMINAL-INVARIANT MATRIX ===\n'

# T-NORM: Normal success — Pre + Post + Stop → exactly one run_start + run_end.
{
  TH=$(_mk_env "sess-norm" "run-norm")
  RUN_ID="run-norm"
  PRE=$(_pre_payload "sess-norm" "agentille:agentille-executor" "implement auth module")
  POST=$(_post_payload "sess-norm" "agentille:agentille-executor" "done")
  STOP=$(_stop_payload "sess-norm")
  HOME="$TH" bash "$SCRIPT" <<< "$PRE" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$POST" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$STOP" 2>/dev/null
  rs=$(_jsonl_type_count "$TH" "$RUN_ID" "run_start")
  re=$(_jsonl_type_count "$TH" "$RUN_ID" "run_end")
  _check "$rs" "1" "T-NORM: exactly one run_start"
  _check "$re" "1" "T-NORM: exactly one run_end"
  # Mapping must be removed after Stop.
  [ ! -f "${TH}/.agentille/cockpit/sessions/sess-norm" ] && \
    _pass "T-NORM: mapping removed after Stop" || \
    _fail "T-NORM: mapping still present after Stop"
  rm -rf "$TH"
}

# T-ABORT-BEFORE: Stop fires before any Pre/Post (abort before first Agent).
{
  TH=$(_mk_env "sess-abort-before" "run-abort-before")
  RUN_ID="run-abort-before"
  STOP=$(_stop_payload "sess-abort-before")
  HOME="$TH" bash "$SCRIPT" <<< "$STOP" 2>/dev/null
  rs=$(_jsonl_type_count "$TH" "$RUN_ID" "run_start")
  re=$(_jsonl_type_count "$TH" "$RUN_ID" "run_end")
  _check "$rs" "1" "T-ABORT-BEFORE: run_start synthesized by Stop"
  _check "$re" "1" "T-ABORT-BEFORE: exactly one run_end"
  rm -rf "$TH"
}

# T-ABORT-AFTER: Pre fires, then Stop (no Post).
{
  TH=$(_mk_env "sess-abort-after" "run-abort-after")
  RUN_ID="run-abort-after"
  PRE=$(_pre_payload "sess-abort-after" "agentille:agentille-planner" "draft plan")
  STOP=$(_stop_payload "sess-abort-after")
  HOME="$TH" bash "$SCRIPT" <<< "$PRE" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$STOP" 2>/dev/null
  rs=$(_jsonl_type_count "$TH" "$RUN_ID" "run_start")
  re=$(_jsonl_type_count "$TH" "$RUN_ID" "run_end")
  _check "$rs" "1" "T-ABORT-AFTER: exactly one run_start"
  _check "$re" "1" "T-ABORT-AFTER: exactly one run_end (Stop emits even with no Post)"
  rm -rf "$TH"
}

# T-POST-VS-STOP: Post and Stop race (Stop removes mapping; late Post no-ops).
{
  TH=$(_mk_env "sess-race" "run-race")
  RUN_ID="run-race"
  PRE=$(_pre_payload "sess-race" "agentille:agentille-executor" "slice A")
  POST=$(_post_payload "sess-race" "agentille:agentille-executor" "done")
  STOP=$(_stop_payload "sess-race")
  # Pre first.
  HOME="$TH" bash "$SCRIPT" <<< "$PRE" 2>/dev/null
  # Stop wins before Post.
  HOME="$TH" bash "$SCRIPT" <<< "$STOP" 2>/dev/null
  # Late Post — should no-op (mapping gone).
  HOME="$TH" bash "$SCRIPT" <<< "$POST" 2>/dev/null
  rs=$(_jsonl_type_count "$TH" "$RUN_ID" "run_start")
  re=$(_jsonl_type_count "$TH" "$RUN_ID" "run_end")
  _check "$rs" "1" "T-POST-VS-STOP: exactly one run_start"
  _check "$re" "1" "T-POST-VS-STOP: exactly one run_end"
  rm -rf "$TH"
}

# T-DOUBLE-STOP: Stop fires twice (idempotent via .run_end_emitted flag).
{
  TH=$(_mk_env "sess-double-stop" "run-double-stop")
  RUN_ID="run-double-stop"
  STOP=$(_stop_payload "sess-double-stop")
  # First Stop: mapping exists → emits run_end, removes mapping.
  HOME="$TH" bash "$SCRIPT" <<< "$STOP" 2>/dev/null
  # Second Stop: mapping gone → no-ops.
  HOME="$TH" bash "$SCRIPT" <<< "$STOP" 2>/dev/null
  re=$(_jsonl_type_count "$TH" "$RUN_ID" "run_end")
  _check "$re" "1" "T-DOUBLE-STOP: idempotent — exactly one run_end on double Stop"
  rm -rf "$TH"
}

# T-DEBRIEF-VS-STOP: Debrief writes outcome then Stop reads it.
{
  TH=$(_mk_env "sess-debrief" "run-debrief")
  RUN_ID="run-debrief"
  # Debrief writes outcome into cockpit-meta.json (agt skill does this).
  jq '. + {outcome: "success"}' \
    "${TH}/.agentille/cockpit/runs/${RUN_ID}/cockpit-meta.json" > /tmp/agt-hook-meta.tmp \
    && mv /tmp/agt-hook-meta.tmp \
       "${TH}/.agentille/cockpit/runs/${RUN_ID}/cockpit-meta.json"
  STOP=$(_stop_payload "sess-debrief")
  HOME="$TH" bash "$SCRIPT" <<< "$STOP" 2>/dev/null
  outcome=$(jq -r '.outcome' "${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl" 2>/dev/null | tail -1)
  _check "$outcome" "success" "T-DEBRIEF-VS-STOP: run_end carries outcome from cockpit-meta.json"
  rm -rf "$TH"
}

# ── Section 5: Verdict parse failure → unknown ────────────────────────────────
printf '\n=== 5. VERDICT PARSE FAILURE → unknown ===\n'

{
  TH=$(_mk_env "sess-verd" "run-verd")
  RUN_ID="run-verd"
  # Reviewer post with unparseable output.
  PAY=$(jq -cn --arg sid "sess-verd" \
    '{hook_event_name:"PostToolUse",tool_name:"Agent",session_id:$sid,
      tool_input:{subagent_type:"agentille:agentille-code-reviewer"},
      tool_response:"Some ambiguous reviewer output with no verdict keywords"}')
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null
  verdict=$(jq -r 'select(.type=="verdict") | .result' \
    "${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl" 2>/dev/null | head -1)
  _check "$verdict" "unknown" "V1: unparseable reviewer output → verdict=unknown"
  rm -rf "$TH"
}

{
  TH=$(_mk_env "sess-verd-pass" "run-verd-pass")
  RUN_ID="run-verd-pass"
  PAY=$(jq -cn --arg sid "sess-verd-pass" \
    '{hook_event_name:"PostToolUse",tool_name:"Agent",session_id:$sid,
      tool_input:{subagent_type:"agentille:agentille-code-reviewer"},
      tool_response:"APPROVE — all checks pass, diff is clean"}')
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null
  verdict=$(jq -r 'select(.type=="verdict") | .result' \
    "${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl" 2>/dev/null | head -1)
  _check "$verdict" "pass" "V2: APPROVE keyword → verdict=pass"
  rm -rf "$TH"
}

{
  TH=$(_mk_env "sess-verd-fail" "run-verd-fail")
  RUN_ID="run-verd-fail"
  PAY=$(jq -cn --arg sid "sess-verd-fail" \
    '{hook_event_name:"PostToolUse",tool_name:"Agent",session_id:$sid,
      tool_input:{subagent_type:"agentille:agentille-security-reviewer"},
      tool_response:"BLOCKER found: SQL injection in query builder"}')
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null
  verdict=$(jq -r 'select(.type=="verdict") | .result' \
    "${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl" 2>/dev/null | head -1)
  _check "$verdict" "fail" "V3: BLOCKER keyword → verdict=fail"
  rm -rf "$TH"
}

{
  # Error signal in tool_response → verdict=unknown regardless of output text.
  TH=$(_mk_env "sess-verd-err" "run-verd-err")
  RUN_ID="run-verd-err"
  PAY=$(jq -cn --arg sid "sess-verd-err" \
    '{hook_event_name:"PostToolUse",tool_name:"Agent",session_id:$sid,
      tool_input:{subagent_type:"agentille:agentille-plan-reviewer"},
      tool_response:{is_error:true,output:"APPROVE (but errored)"}}')
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null
  verdict=$(jq -r 'select(.type=="verdict") | .result' \
    "${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl" 2>/dev/null | head -1)
  _check "$verdict" "unknown" "V4: is_error:true → verdict=unknown even if output says APPROVE"
  rm -rf "$TH"
}

# ── Section 6: Privacy — slice label is sanitized, never raw prompt ───────────
printf '\n=== 6. PRIVACY — slice label sanitized ===\n'

{
  TH=$(_mk_env "sess-priv" "run-priv")
  RUN_ID="run-priv"
  # Test that the sanitizer strips shell metacharacters and truncates to 60 chars.
  # Use a description with special chars that must be removed.
  SENSITIVE_DESC="implement feature; rm -rf /tmp && exec bash >$(printf '%.0s-' {1..80})"
  PAY=$(_pre_payload "sess-priv" "agentille:agentille-executor" "$SENSITIVE_DESC")
  HOME="$TH" bash "$SCRIPT" <<< "$PAY" 2>/dev/null
  JSONL="${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl"
  # Semicolons, >$(), and other metacharacters must be stripped from the slice label.
  has_semicolon=$(jq -r '.slice // ""' "$JSONL" 2>/dev/null | grep -cF ';' || true)
  has_subshell=$(jq -r '.slice // ""' "$JSONL" 2>/dev/null | grep -cF '$(' || true)
  _check "$has_semicolon" "0" "P1: semicolons stripped from slice label"
  _check "$has_subshell" "0" "P2: shell subshell syntax stripped from slice label"
  # Slice must be non-empty and ≤ 60 chars.
  slice_len=$(jq -r '.slice // ""' "$JSONL" 2>/dev/null | head -1 | wc -c | tr -d ' ')
  # wc -c includes newline, so ≤ 61 means ≤ 60 chars.
  [ "$slice_len" -le 61 ] && _pass "P3: slice label ≤ 60 chars" || _fail "P3: slice label too long (${slice_len})"
  rm -rf "$TH"
}

# ── Section 7: Cross-repo schema check ───────────────────────────────────────
printf '\n=== 7. CROSS-REPO SCHEMA CHECK ===\n'

{
  # Generate a realistic run-active.hook.jsonl from synthetic hook payloads.
  TH=$(_mk_env "sess-schema" "run-schema")
  RUN_ID="run-schema"
  OUTFILE="${TH}/run-active.hook.jsonl"

  # Fire a realistic sequence: Pre(planner) → Post(planner) → Pre(executor) → Post(executor)
  # → Pre(reviewer) → Post(reviewer) → Stop (with outcome from cockpit-meta.json).

  jq '. + {outcome: "success"}' \
    "${TH}/.agentille/cockpit/runs/${RUN_ID}/cockpit-meta.json" > /tmp/agt-schema-meta.tmp \
    && mv /tmp/agt-schema-meta.tmp \
       "${TH}/.agentille/cockpit/runs/${RUN_ID}/cockpit-meta.json"

  HOME="$TH" bash "$SCRIPT" <<< "$(_pre_payload "sess-schema" "agentille:agentille-planner" "draft plan")" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$(_post_payload "sess-schema" "agentille:agentille-planner" "plan drafted")" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$(_pre_payload "sess-schema" "agentille:agentille-executor" "implement auth")" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$(_post_payload "sess-schema" "agentille:agentille-executor" "done")" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$(_pre_payload "sess-schema" "agentille:agentille-code-reviewer" "review diff")" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$(jq -cn --arg sid "sess-schema" \
    '{hook_event_name:"PostToolUse",tool_name:"Agent",session_id:$sid,
      tool_input:{subagent_type:"agentille:agentille-code-reviewer"},
      tool_response:"APPROVE — clean diff"}')" 2>/dev/null
  HOME="$TH" bash "$SCRIPT" <<< "$(_stop_payload "sess-schema")" 2>/dev/null

  cp "${TH}/.agentille/cockpit/runs/${RUN_ID}.jsonl" "$OUTFILE"

  # Structural check: required event types present.
  has_run_start=$(jq -rs '[.[] | .type] | map(select(. == "run_start")) | length' "$OUTFILE" 2>/dev/null)
  has_run_end=$(jq -rs '[.[] | .type] | map(select(. == "run_end")) | length' "$OUTFILE" 2>/dev/null)
  has_phase=$(jq -rs '[.[] | .type] | map(select(. == "phase")) | length' "$OUTFILE" 2>/dev/null)
  has_worker=$(jq -rs '[.[] | .type] | map(select(. == "worker")) | length' "$OUTFILE" 2>/dev/null)
  has_verdict=$(jq -rs '[.[] | .type] | map(select(. == "verdict")) | length' "$OUTFILE" 2>/dev/null)

  _check "$has_run_start" "1" "S1: exactly one run_start in generated fixture"
  _check "$has_run_end" "1" "S2: exactly one run_end in generated fixture"
  [ "${has_phase:-0}" -ge 1 ] && _pass "S3: at least one phase event" || _fail "S3: no phase events"
  [ "${has_worker:-0}" -ge 1 ] && _pass "S4: at least one worker event" || _fail "S4: no worker events"
  _check "${has_verdict:-0}" "1" "S5: exactly one verdict event"

  # Every line must be valid JSON with seq, ts, type fields.
  invalid=0
  while IFS= read -r line; do
    ok=$(printf '%s' "$line" | jq -e 'has("seq") and has("ts") and has("type")' 2>/dev/null)
    [ "$ok" = "true" ] || invalid=$((invalid+1))
  done < "$OUTFILE"
  _check "$invalid" "0" "S6: every event line has seq + ts + type"

  # Seqs must be unique.
  total_seqs=$(jq -r '.seq' "$OUTFILE" 2>/dev/null | wc -l | tr -d ' ')
  unique_seqs=$(jq -r '.seq' "$OUTFILE" 2>/dev/null | sort -u | wc -l | tr -d ' ')
  _check "$total_seqs" "$unique_seqs" "S7: all seq values unique in fixture"

  # schema:1 on run_start.
  schema_val=$(jq -r 'select(.type=="run_start") | .schema' "$OUTFILE" 2>/dev/null | head -1)
  _check "$schema_val" "1" "S8: run_start.schema == 1 (schema:1 compat)"

  # Outcome on run_end.
  outcome_val=$(jq -r 'select(.type=="run_end") | .outcome' "$OUTFILE" 2>/dev/null | head -1)
  _check "$outcome_val" "success" "S9: run_end.outcome == success (from cockpit-meta.json)"

  # Cross-repo: pipe the fixture through an inline port of the cockpit reducer
  # (agentille-cockpit/web/src/lib/reduce.ts — logic inlined to avoid TS compilation).
  # Requires node; tries the nvm v24 path then falls back to PATH.
  # Locate node: try known nvm paths first (nvm uses lazy-loading so node may
  # not be on PATH even when installed), then fall back to whatever is on PATH.
  NODE_BIN=""
  if [ -x "$HOME/.nvm/versions/node/v24.14.0/bin/node" ]; then
    NODE_BIN="$HOME/.nvm/versions/node/v24.14.0/bin/node"
  elif command -v node >/dev/null 2>&1; then
    NODE_BIN=$(command -v node)
  fi

  REDUCER="${COCKPIT_REPO}/web/src/lib/reduce.ts"
  if [ -z "$NODE_BIN" ]; then
    printf 'SKIP: S10: node not found (tried nvm v24 and PATH) — set PATH or install node\n'
  elif [ ! -f "$REDUCER" ]; then
    printf 'SKIP: S10: agentille-cockpit repo not at %s — set COCKPIT_REPO env to run\n' "$COCKPIT_REPO"
  else
    # Inline port of reduce.ts (pure logic, no TS required).
    # Feeds our hook-generated fixture through the reducer and asserts the
    # resulting view-model is correct: task populated, mode populated,
    # stations non-empty, at least one worker, at least one verdict, ended=true,
    # outcome non-null, schema=1.
    REDUCE_TEST=$(cat <<'NODEEOF'
const fs = require('fs');
// When invoked as: node -e "..." <fixture>, argv layout is:
//   [0]=node [1]=<fixture> (no argv[2] with -e)
const fixture = process.argv[1];

// Inline port of agentille-cockpit/web/src/lib/reduce.ts
function emptyRunVM(run) {
  return { run, stations: [], stationStatus: {}, workers: {}, verdicts: [],
           ended: false, lastSeq: -1, seen: new Set() };
}
function applyEvent(m, e) {
  if (m.seen.has(e.seq)) return m;
  m.seen.add(e.seq);
  if (e.seq > m.lastSeq) m.lastSeq = e.seq;
  if (typeof e.ts === 'number') {
    if (m.startedTs === undefined || e.ts < m.startedTs) m.startedTs = e.ts;
    if (m.lastTs === undefined || e.ts > m.lastTs) m.lastTs = e.ts;
  }
  const a = e;
  switch (e.type) {
    case 'run_start':
      m.version = a.version; m.schema = a.schema;
      m.task = a.task; m.mode = a.mode; m.template = a.template;
      m.stations = Array.isArray(a.stations) ? a.stations : [];
      break;
    case 'phase':
      if (typeof a.station === 'string') m.stationStatus[a.station] = a.status;
      break;
    case 'fanout':
      for (const w of (a.workers ?? [])) m.workers[w.id] = { id: w.id, slice: w.slice };
      break;
    case 'worker': {
      const w = m.workers[a.id] ?? { id: a.id };
      if (typeof a.status === 'string') w.status = a.status;
      if (typeof a.context_pct === 'number') w.contextPct = a.context_pct;
      m.workers[a.id] = w;
      break;
    }
    case 'verdict':
      m.verdicts.push({ reviewer: a.reviewer, result: a.result, findings: a.findings ?? [] });
      break;
    case 'debrief':
      if (typeof a.tokens === 'number') m.tokens = a.tokens;
      break;
    case 'run_end':
      m.outcome = a.outcome; m.ended = true;
      break;
  }
  return m;
}

const lines = fs.readFileSync(fixture, 'utf8').trim().split('\n').filter(Boolean);
const events = lines.map(l => JSON.parse(l));
const vm = emptyRunVM('hook-test-run');
for (const e of events) applyEvent(vm, e);

const errs = [];
if (!vm.task) errs.push('task is empty');
if (!vm.mode) errs.push('mode is empty');
if (!Array.isArray(vm.stations) || vm.stations.length === 0) errs.push('stations is empty');
if (Object.keys(vm.workers).length === 0) errs.push('no workers in vm');
if (vm.verdicts.length === 0) errs.push('no verdicts in vm');
if (!vm.ended) errs.push('vm.ended is false (run_end not processed)');
if (!vm.outcome) errs.push('vm.outcome is falsy');
if (vm.schema !== 1) errs.push('vm.schema !== 1 (schema compat broken)');
if (vm.lastSeq < 0) errs.push('no events processed (lastSeq < 0)');

if (errs.length > 0) {
  console.log('REDUCER_FAIL: ' + errs.join('; '));
  process.exit(1);
} else {
  console.log('REDUCER_OK: task=' + JSON.stringify(vm.task)
    + ' mode=' + vm.mode
    + ' workers=' + Object.keys(vm.workers).length
    + ' verdicts=' + vm.verdicts.length
    + ' ended=' + vm.ended
    + ' outcome=' + vm.outcome
    + ' schema=' + vm.schema);
}
NODEEOF
)
    CROSS_RESULT=$("$NODE_BIN" -e "$REDUCE_TEST" "$OUTFILE" 2>&1)
    NODE_EXIT=$?
    if [ "$NODE_EXIT" -eq 0 ]; then
      _pass "S10: cross-repo reducer (inline port) processed fixture correctly: $CROSS_RESULT"
    else
      _fail "S10: cross-repo reducer check failed: $CROSS_RESULT"
    fi
  fi

  # Save the authoritative fixture for B's acceptance gate.
  FIXTURE_DEST="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures"
  mkdir -p "$FIXTURE_DEST"
  cp "$OUTFILE" "${FIXTURE_DEST}/run-active.hook.jsonl"
  printf 'INFO: authoritative fixture written to tests/fixtures/run-active.hook.jsonl\n'

  rm -rf "$TH"
}

# ── Summary ────────────────────────────────────────────────────────────────────
printf '\n=== SUMMARY ===\n'
printf '%d/%d tests passed\n' "$((total - fails))" "$total"
[ "$fails" -eq 0 ] && echo "ALL PASS" || { echo "${fails} FAILED"; exit 1; }
