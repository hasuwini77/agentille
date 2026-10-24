#!/usr/bin/env bash
# SessionEnd hook — closes the worker panes THIS lead opened (Herdr or tmux) once their answers are saved, so none
# stay open after the session, and on Herdr the idle sessions it opened with open_sessions.
#
# Ownership is the list the mod wrote while the session ran: ~/.agentille/state/lead-<pane>.panes (one agt-<run>-<role>
# name per line). A pane another session opened in the same tab is never touched, whatever its name or state.
# A pane closes only when it is idle, done or dead AND its answer is on disk (its answer file or done marker): one
# that finished with its output only on screen stays open and is left to the person. /clear is not an exit: the
# session goes on, so nothing closes. A worker pane never sweeps. Must NEVER error or block: every path exits 0.
set -u

# stdin: the SessionEnd payload. Only `reason` is read; "clear" means the session continues.
payload=$(cat 2>/dev/null || true)
case "$payload" in *'"reason"'*'"clear"'*) exit 0 ;; esac

# A pane id made filename-safe (w1:p3 -> w1-p3, %5 -> 5): the key of the lead's state files, and of a worker's answer file.
pane_key() {
  local key
  key=$(printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '-')
  key=${key#"${key%%[!-]*}"}; key=${key%"${key##*[!-]}"}
  printf '%s' "$key"
}

lead_key() { pane_key "${HERDR_PANE_ID:-${TMUX_PANE:-}}"; }

# One recorded list of this lead, one entry per line, filtered to safe values; nothing when there is no file.
lead_list() { # <suffix> <pattern>
  local key file
  key=$(lead_key)
  [ -n "$key" ] || return 0
  file="$HOME/.agentille/state/lead-$key.$1"
  [ -f "$file" ] || return 0
  grep -E "$2" "$file" 2>/dev/null
}
lead_panes() { lead_list panes '^agt-[A-Za-z0-9_-]+$'; }
lead_tabs() { lead_list tabs '^[A-Za-z0-9:_-]+$'; }
lead_sessions() { lead_list sessions '^s-[A-Za-z0-9_-]+$'; }

# A worker's answer is saved: its own answer file (pane-<role>.<pane key>.md), the legacy pane-<role>.md, or its done marker.
answer_saved() { # <pane name> <pane id>
  local run role key dir
  run=${1#agt-}; run=${run%%-*}
  role=${1#agt-"$run"-}
  case "$run" in *[!A-Za-z0-9_-]* | "") return 1 ;; esac
  case "$role" in *[!a-z0-9-]* | "") return 1 ;; esac
  dir="$HOME/.agentille/state/run-$run"
  key=$(pane_key "$2")
  [ -n "$key" ] && [ -f "$dir/agents/pane-$role.$key.md" ] && return 0
  [ -f "$dir/agents/pane-$role.md" ] && return 0
  [ -f "$dir/done-$role" ] && return 0
  return 1
}

# stdin: Herdr JSON. Prints "<pane id>\t<name>\t<status>" for the agt-* panes this lead owns (by name) that sit idle, done
# or dead, plus "<pane id>\t<session name>\tsession" for its own sessions that are idle and unfocused (a done one holds
# an answer nobody has seen yet, so it stays). Nothing when this pane is itself a worker.
herdr_candidates() {
  local json="$1" panes="${2:-}" sess="${3:-}"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r --arg self "${HERDR_PANE_ID:-}" --arg panes "$panes" --arg sess "$sess" '
      (.result.agents // []) as $a
      | ($panes | split("\n") | map(select(. != ""))) as $own
      | ($sess | split("\n") | map(select(. != ""))) as $mine
      | if any($a[]; .pane_id == $self and ((.name // "") | startswith("agt-"))) then empty
        else ($a[] | select((.name // "") as $n | any($own[]; . == $n)) | select(.pane_id != $self and (.agent_status == "idle" or .agent_status == "done" or .agent_status == "dead"))
                   | [.pane_id, .name, .agent_status] | @tsv),
             ($a[] | select((.name // "") as $n | any($mine[]; . == $n)) | select(.agent_status == "idle" and .focused != true and .pane_id != $self)
                   | [.pane_id, .name, "session"] | @tsv) end' 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | SELF="${HERDR_PANE_ID:-}" PANES="$panes" SESS="$sess" node -e '
      let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
        try {
          const a = JSON.parse(s).result?.agents ?? []
          const own = (process.env.PANES || "").split("\n").filter(Boolean)
          const mine = (process.env.SESS || "").split("\n").filter(Boolean)
          const named = (x) => typeof x.name === "string" && x.name.startsWith("agt-")
          if (a.some((x) => x.pane_id === process.env.SELF && named(x))) return
          for (const x of a) if (own.includes(x.name) && x.pane_id !== process.env.SELF && ["idle", "done", "dead"].includes(x.agent_status)) console.log([x.pane_id, x.name, x.agent_status].join("\t"))
          for (const x of a) if (mine.includes(x.name) && x.agent_status === "idle" && x.focused !== true && x.pane_id !== process.env.SELF) console.log([x.pane_id, x.name, "session"].join("\t"))
        } catch {}
      })' 2>/dev/null
  fi
}

sweep_herdr() {
  [ -n "${HERDR_TAB_ID:-}" ] || return 0
  local json id name status panes sess key
  panes=$(lead_panes)
  sess=$(lead_sessions)
  [ -n "$panes$sess" ] || return 0 # this session opened nothing: nothing to close, nothing to read
  json=$(herdr agent list 2>/dev/null) || return 0
  herdr_candidates "$json" "$panes" "$sess" | while IFS=$'\t' read -r id name status; do
    case "$id" in *[!A-Za-z0-9:_-]* | "") continue ;; esac
    case "$status" in
      session | dead) ;;
      *) answer_saved "$name" "$id" || continue ;;
    esac
    herdr pane close "$id" >/dev/null 2>&1 || true
  done
  key=$(lead_key)
  [ -n "$key" ] && rm -f "$HOME/.agentille/state/lead-$key.panes" "$HOME/.agentille/state/lead-$key.tabs" "$HOME/.agentille/state/lead-$key.sessions" 2>/dev/null
  return 0
}

sweep_tmux() {
  local self="${TMUX_PANE:-}" own id agt dead win mywin panes key
  [ -n "$self" ] || return 0
  panes=$(lead_panes)
  [ -n "$panes" ] || return 0
  mywin=$(tmux display-message -p -t "$self" '#{window_id}' 2>/dev/null) || return 0
  own=$(tmux display-message -p -t "$self" '#{@agt}' 2>/dev/null) || return 0
  case "$own" in agt-*) return 0 ;; esac # a worker never sweeps
  tmux list-panes -a -F "#{pane_id}	#{@agt}	#{pane_dead}	#{window_id}" 2>/dev/null | while IFS=$'\t' read -r id agt dead win; do
    [ "$win" = "$mywin" ] && [ "$id" != "$self" ] || continue
    case "$id" in %[0-9]*) ;; *) continue ;; esac
    printf '%s\n' "$panes" | grep -qxF -- "$agt" || continue
    if [ "$dead" != "1" ]; then answer_saved "$agt" "$id" || continue; fi
    tmux kill-pane -t "$id" >/dev/null 2>&1
  done
  key=$(lead_key)
  [ -n "$key" ] && rm -f "$HOME/.agentille/state/lead-$key.panes" 2>/dev/null
  return 0
}

if [ "${HERDR_ENV:-}" = "1" ] && command -v herdr >/dev/null 2>&1; then
  sweep_herdr
elif [ -n "${TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
  sweep_tmux
fi
exit 0
