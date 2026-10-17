#!/usr/bin/env bash
# SessionEnd hook — closes this lead's finished agt-* worker panes (Herdr or tmux) so none stay
# open after the session. Touches only agt-* panes in the lead's own tab/window that are idle,
# done or dead. A worker pane never sweeps. Must NEVER error or block: every path exits 0.
set -u

cat >/dev/null 2>&1 || true

# stdin: Herdr JSON. Prints the pane ids to close, one per line.
herdr_targets() {
  local json="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r --arg self "${HERDR_PANE_ID:-}" --arg tab "${HERDR_TAB_ID:-}" '
      (.result.agents // []) as $a
      | if any($a[]; .pane_id == $self and ((.name // "") | startswith("agt-"))) then empty
        else $a[] | select(((.name // "") | startswith("agt-")) and .tab_id == $tab and .pane_id != $self
                           and (.agent_status == "idle" or .agent_status == "done")) | .pane_id end' 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | SELF="${HERDR_PANE_ID:-}" TAB="${HERDR_TAB_ID:-}" node -e '
      let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
        try {
          const a = JSON.parse(s).result?.agents ?? []
          const named = (x) => typeof x.name === "string" && x.name.startsWith("agt-")
          if (a.some((x) => x.pane_id === process.env.SELF && named(x))) return
          for (const x of a) if (named(x) && x.tab_id === process.env.TAB && x.pane_id !== process.env.SELF && (x.agent_status === "idle" || x.agent_status === "done")) console.log(x.pane_id)
        } catch {}
      })' 2>/dev/null
  fi
}

sweep_herdr() {
  [ -n "${HERDR_TAB_ID:-}" ] || return 0
  local json id
  json=$(herdr agent list 2>/dev/null) || return 0
  herdr_targets "$json" | while IFS= read -r id; do
    case "$id" in *[!A-Za-z0-9:_-]* | "") continue ;; esac
    herdr pane close "$id" >/dev/null 2>&1 || true
  done
}

sweep_tmux() {
  local self="${TMUX_PANE:-}" own id agt dead win mywin line
  [ -n "$self" ] || return 0
  mywin=$(tmux display-message -p -t "$self" '#{window_id}' 2>/dev/null) || return 0
  own=$(tmux display-message -p -t "$self" '#{@agt}' 2>/dev/null) || return 0
  case "$own" in agt-*) return 0 ;; esac # a worker never sweeps
  tmux list-panes -a -F "#{pane_id}	#{@agt}	#{pane_dead}	#{window_id}" 2>/dev/null | while IFS=$'\t' read -r id agt dead win; do
    [ "$win" = "$mywin" ] && [ "$id" != "$self" ] || continue
    case "$agt" in agt-*) ;; *) continue ;; esac
    case "$id" in %[0-9]*) ;; *) continue ;; esac
    local run role finished=0
    if [ "$dead" = "1" ]; then
      finished=1
    else
      run=${agt#agt-}; run=${run%%-*}
      role=${agt#agt-"$run"-}
      case "$run" in *[!A-Za-z0-9_-]* | "") continue ;; esac
      case "$role" in *[!a-z0-9-]* | "") continue ;; esac
      [ -f "$HOME/.agentille/state/run-$run/done-$role" ] && finished=1
    fi
    [ "$finished" = "1" ] && tmux kill-pane -t "$id" >/dev/null 2>&1
  done
}

if [ "${HERDR_ENV:-}" = "1" ] && command -v herdr >/dev/null 2>&1; then
  sweep_herdr
elif [ -n "${TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
  sweep_tmux
fi
exit 0
