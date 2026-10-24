#!/usr/bin/env bash
# SessionStart hook for a compaction: when this session has an /agt run in flight, print a short re-entry block for
# the model (the run, each slice and its state, what to re-read before the next dispatch). Otherwise print nothing.
#
# This session's run is the one the mod named in ~/.agentille/state/session-<session id>.run at the run's first
# dispatch (dispatch.js markRun); the session id is the `session_id` of the SessionStart payload on stdin. A worker
# session never writes that file, so it prints nothing. A run is in flight while its report.md is missing and a file
# in its directory changed in the last 24 hours. The slice lines come from the `slices` map of the run's ledger.json.
# No network. Must NEVER error or block the session: every path exits 0.
set -u

payload=$(cat 2>/dev/null || true)
sid=$(printf '%s' "$payload" | tr -d '\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-]\{1,128\}\)".*/\1/p')
[ -n "$sid" ] || exit 0

state="$HOME/.agentille/state"
run=$(head -n 1 "$state/session-$sid.run" 2>/dev/null | tr -d '[:space:]')
case "$run" in "" | adhoc | *[!A-Za-z0-9_-]*) exit 0 ;; esac
[ "${#run}" -le 64 ] || exit 0
dir="$state/run-$run"
[ -d "$dir" ] || exit 0
[ -e "$dir/report.md" ] && exit 0
[ -n "$(find "$dir" -maxdepth 1 -type f -mmin -1440 2>/dev/null | head -n 1)" ] || exit 0

# How the run's workers run, from its routing log: a pane or workflow line names its kind.
transport=subagent
if grep -qF '"kind":"pane"' "$dir/routing.jsonl" 2>/dev/null; then transport=panes
elif grep -qF '"kind":"workflow"' "$dir/routing.jsonl" 2>/dev/null; then transport=workflow
fi

# One line per slice: "- slice <slug>: <role> <state>, <role> <state>". jq first, node when jq is missing.
slices=""
if [ -f "$dir/ledger.json" ]; then
  if command -v jq >/dev/null 2>&1; then
    slices=$(jq -r '(.slices // {}) | to_entries[] | "- slice \(.key): " + ([.value | to_entries[] | "\(.key) \(.value)"] | join(", "))' "$dir/ledger.json" 2>/dev/null)
  elif command -v node >/dev/null 2>&1; then
    slices=$(node -e '
      try {
        const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
        for (const [s, roles] of Object.entries(l.slices ?? {})) console.log("- slice " + s + ": " + Object.entries(roles).map(([r, st]) => r + " " + st).join(", "))
      } catch {}' "$dir/ledger.json" 2>/dev/null)
  fi
fi
# The ledger is the mod's, but this text reaches the model: keep plain words only.
slices=$(printf '%s\n' "$slices" | LC_ALL=C tr -cd 'A-Za-z0-9 :,._\n-' | grep -E '^- slice ' | head -n 20)
[ -n "$slices" ] || slices="- no slice recorded yet (still planning, or a single-slice run)"

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)}"
printf '[agt re-entry] This session has /agt run %s in flight · transport: %s\n' "$run" "$transport"
printf '%s\n' "$slices"
printf 'Read skills/agt/SKILL.md → "Hard rules" (%s/skills/agt/SKILL.md) and the run'"'"'s context-pack.md (%s/context-pack.md) before the next dispatch. Trust the ledger (%s/ledger.json) and git log over memory.\n' "$ROOT" "$dir" "$dir"
exit 0
