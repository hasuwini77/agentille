#!/usr/bin/env bash
# Deterministic test of hooks/agentille-compact.sh: a fake HOME with a seeded run, the SessionStart payload on stdin.
# With this session's run in flight it prints the re-entry block (run id, one line per slice, what to re-read);
# otherwise it prints nothing. Every case exits 0. No network, no real ~/.agentille. Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
HOOK="$PWD/hooks/agentille-compact.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"
STATE="$HOME/.agentille/state"; mkdir -p "$STATE"
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }
payload() { printf '{"session_id":"%s","transcript_path":"/x.jsonl","cwd":"/w","hook_event_name":"SessionStart","source":"compact"}' "$1"; }
run() { payload "$1" | CLAUDE_PLUGIN_ROOT="$T/plugin" bash "$HOOK" 2>&1; }

# 1. no run named for this session: silent
out=$(run sid-none); rc=$?
check "no run: exit 0" '[ "$rc" = 0 ]'
check "no run: silent" '[ -z "$out" ]'

# 2. a run in flight: the block names the run, the transport, each slice and what to re-read
R="$STATE/run-k7f2ab"; mkdir -p "$R"
printf 'k7f2ab\n' > "$STATE/session-sid-1.run"
printf '{"role":"planner","kind":"sub"}\n{"role":"executor","kind":"pane","pane":"agt-k7f2ab-exec-1"}\n' > "$R/routing.jsonl"
cat > "$R/ledger.json" <<'JSON'
{ "run": "k7f2ab", "roles": {}, "total": {}, "panes": {},
  "slices": { "api": { "executor": "done", "code-reviewer": "working" }, "web": { "executor": "working" } } }
JSON
out=$(run sid-1); rc=$?
check "in flight: exit 0" '[ "$rc" = 0 ]'
check "in flight: names the run and transport" '[[ "$out" == *"/agt run k7f2ab in flight · transport: panes"* ]]'
check "in flight: one line per slice" '[ "$(printf "%s\n" "$out" | grep -c "^- slice ")" = 2 ]'
check "in flight: slice api state" 'printf "%s\n" "$out" | grep -qxF -- "- slice api: executor done, code-reviewer working"'
check "in flight: slice web state" 'printf "%s\n" "$out" | grep -qxF -- "- slice web: executor working"'
check "in flight: re-read instruction" '[[ "$out" == *"Read skills/agt/SKILL.md → \"Hard rules\""* && "$out" == *"context-pack.md ($R/context-pack.md) before the next dispatch. Trust the ledger"* && "$out" == *"and git log over memory."* ]]'

# 3. another session's id: silent, even with a run in flight on this machine
out=$(run sid-2)
check "other session: silent" '[ -z "$out" ]'

# 4. a ledger with no slices yet says so; a subagent-only log says subagent
printf '{ "run": "k7f2ab", "slices": {} }\n' > "$R/ledger.json"
printf '{"role":"planner"}\n' > "$R/routing.jsonl"
out=$(run sid-1)
check "no slices: says none recorded" '[[ "$out" == *"- no slice recorded yet"* ]]'
check "no slices: transport subagent" '[[ "$out" == *"transport: subagent"* ]]'

# 5. without jq the slice lines come from node
if command -v node >/dev/null 2>&1; then
  mkdir -p "$T/bin"
  for c in cat tr sed head find grep dirname node; do ln -sf "$(command -v "$c")" "$T/bin/$c"; done
  printf '{ "slices": { "api": { "executor": "working" } } }\n' > "$R/ledger.json"
  out=$(payload sid-1 | PATH="$T/bin" CLAUDE_PLUGIN_ROOT="$T/plugin" "$BASH" "$HOOK" 2>&1)
  check "no jq: node reads the ledger" 'printf "%s\n" "$out" | grep -qxF -- "- slice api: executor working"'
fi

# 6. a finished run (report.md written) is not in flight: silent
: > "$R/report.md"
out=$(run sid-1)
check "finished run: silent" '[ -z "$out" ]'
rm -f "$R/report.md"

# 7. a run untouched for over a day is not in flight: silent
find "$R" -type f -exec touch -t 202001010000 {} +
out=$(run sid-1)
check "stale run: silent" '[ -z "$out" ]'
touch "$R/ledger.json"

# 8. bad input never prints and never fails: empty stdin, garbage, a session id or run id with path characters
out=$(CLAUDE_PLUGIN_ROOT="$T/plugin" bash "$HOOK" </dev/null 2>&1); rc=$?
check "empty stdin: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
out=$(printf 'not json' | bash "$HOOK" 2>&1); rc=$?
check "garbage stdin: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
out=$(run '../state/session-sid-1'); rc=$?
check "path in session id: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
printf '../run-k7f2ab\n' > "$STATE/session-sid-3.run"
out=$(run sid-3); rc=$?
check "path in run id: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'

[ "$bad" = 0 ] && echo "compact: $n checks pass" || { echo "compact: $bad of $n checks fail"; exit 1; }
