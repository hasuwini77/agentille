#!/usr/bin/env bash
# spawn_pane and close_pane against a real tmux server (tests/hooks/tmux-real.mjs): a private server on its own
# socket (-L agt-test-<pid>, socket dir under a mktemp dir), HOME pointed at that dir, and a placeholder `claude`
# (exec sleep 30) first on the server's PATH, so the pane never starts the CLI. Asserts the pane appears in
# `tmux list-panes` as agt-<run>-<role> and is gone after close_pane, then kills the private server.
# Exit 0 = all checks pass; exit 3 with a `SKIP: <reason>` line = tmux or node 22.7+ missing
# (scripts/validate.sh: a WARN on a developer machine, a FAIL under CI=true).
set -u
# A git hook (pre-push runs this suite) exports GIT_DIR and friends; and a caller inside tmux exports TMUX and
# TMUX_PANE, which would point a bare tmux call at the caller's own server.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX TMUX TMUX_PANE
cd "$(dirname "$0")/../.." || exit 2
ROOT=$PWD
command -v tmux >/dev/null 2>&1 || { echo "SKIP: tmux-real needs tmux"; exit 3; }
command -v node >/dev/null 2>&1 || { echo "SKIP: tmux-real needs node 22.7 or newer (no node)"; exit 3; }
if [ "$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=7)?1:0' 2>/dev/null)" != 1 ]; then
  echo "SKIP: tmux-real needs node 22.7 or newer (node $(node -v 2>/dev/null))"; exit 3
fi
# mktemp -d, not a long scratch path: a unix socket path is capped at about 104 bytes on macOS.
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
SOCK="agt-test-$$"
export TMUX_TMPDIR="$T" HOME="$T/home"
mkdir -p "$HOME" "$T/bin" "$T/work"
t() { tmux -L "$SOCK" -f /dev/null "$@"; }
trap 't kill-server >/dev/null 2>&1; rm -rf "$T"' EXIT
printf '#!/bin/sh\nexec sleep 30\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
# The server copies this environment into every pane it starts: the placeholder claude comes first.
export PATH="$T/bin:$PATH"
LEAD=$(t new-session -d -P -F '#{pane_id}' -s lead -x 200 -y 50 'sleep 300') || { echo "tmux-real: could not start a private tmux server"; exit 1; }
case "$LEAD" in %*) ;; *) echo "tmux-real: no lead pane id ($LEAD)"; exit 1 ;; esac

n=0; bad=0
dout=$(node "$ROOT/tests/hooks/tmux-real.mjs" "$ROOT" "$SOCK" "$LEAD" "$HOME" "$T/work" 2>&1); drc=$?
while IFS= read -r line; do
  case "$line" in
    ok\ *) n=$((n+1)) ;;
    FAIL\ *) n=$((n+1)); bad=$((bad+1)); echo "$line" ;;
  esac
done <<< "$dout"
n=$((n+1)); if [ "$drc" = 0 ] || [ "$bad" -gt 0 ]; then :; else bad=$((bad+1)); echo "FAIL the driver exited $drc:"; printf '%s\n' "$dout" | tail -5; fi
# Nothing of the run may land outside the test HOME, and the private server holds only the lead again.
n=$((n+1)); [ "$(t list-panes -a -F '#{pane_id}')" = "$LEAD" ] || { bad=$((bad+1)); echo "FAIL the private server still holds a worker pane"; }
[ "$bad" = 0 ] && echo "tmux-real: $n checks pass" || { echo "tmux-real: $bad of $n checks fail"; exit 1; }
