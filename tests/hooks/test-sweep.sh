#!/usr/bin/env bash
# Deterministic test of hooks/agentille-sweep.sh with fake herdr and tmux binaries that log every
# call. Checks what gets closed and, above all, what never does. Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
HOOK="$PWD/hooks/agentille-sweep.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.agentille/state" "$T/bin"
LOG="$T/calls.log"; : > "$LOG"
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }
closed() { grep -E "^$1\$" "$LOG" >/dev/null; }

# fake herdr: `agent list` prints $HERDR_FIXTURE; every other call is logged
cat > "$T/bin/herdr" <<'H'
#!/usr/bin/env bash
if [ "$1" = agent ] && [ "$2" = list ]; then cat "$HERDR_FIXTURE"; exit 0; fi
echo "herdr $*" >> "$CALLS"; exit 0
H
# fake tmux: display-message answers from env, list-panes prints $TMUX_FIXTURE, kill-pane is logged
cat > "$T/bin/tmux" <<'M'
#!/usr/bin/env bash
case "$1" in
  display-message) case "$*" in *'#{window_id}'*) echo "@1";; *'#{@agt}'*) echo "${SELF_AGT:-}";; esac; exit 0;;
  list-panes) cat "$TMUX_FIXTURE"; exit 0;;
  kill-pane) echo "tmux $*" >> "$CALLS"; exit 0;;
esac
exit 0
M
chmod +x "$T/bin/herdr" "$T/bin/tmux"
export PATH="$T/bin:$PATH" CALLS="$LOG"
# run <VAR=value ...>: the hook in a clean multiplexer environment plus the given variables
run() { ( unset HERDR_ENV HERDR_TAB_ID HERDR_PANE_ID TMUX TMUX_PANE SELF_AGT; for kv in "$@"; do export "$kv"; done; bash "$HOOK" </dev/null ); }

# 1. outside any multiplexer: nothing runs
out=$(run 2>&1); rc=$?
check "no mux: exit 0, silent, no calls" '[ "$rc" = 0 ] && [ -z "$out" ] && [ ! -s "$LOG" ]'

# 2. Herdr: finished agt-* panes in the lead's tab close; working, foreign-tab, non-agt and self never do
cat > "$T/herdr.json" <<'J'
{"result":{"agents":[
 {"pane_id":"p0","name":"lead","tab_id":"t1","agent_status":"idle"},
 {"pane_id":"p1","name":"agt-r1-exec-1","tab_id":"t1","agent_status":"done"},
 {"pane_id":"p2","name":"agt-r1-exec-2","tab_id":"t1","agent_status":"working"},
 {"pane_id":"p3","name":"agt-r1-exec-3","tab_id":"t9","agent_status":"idle"},
 {"pane_id":"p4","name":"scratch","tab_id":"t1","agent_status":"idle"},
 {"pane_id":"p5","name":"agt-r2-exec-1","tab_id":"t2","agent_status":"idle"},
 {"pane_id":"p6","name":"s-r1-1","tab_id":"t1","agent_status":"idle","focused":false},
 {"pane_id":"p7","name":"s-r1-2","tab_id":"t1","agent_status":"done","focused":false}
]}}
J
printf 't2\n' > "$HOME/.agentille/state/lead-w1-p0.tabs"
printf 's-r1-1\ns-r1-2\n' > "$HOME/.agentille/state/lead-w1-p0.sessions"
: > "$LOG"
out=$(run HERDR_ENV=1 HERDR_TAB_ID=t1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/herdr.json" 2>&1); rc=$?
check "herdr: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
check "herdr: done worker in own tab closed" 'closed "herdr pane close p1"'
check "herdr: idle worker in a recorded run tab closed" 'closed "herdr pane close p5"'
check "herdr: idle unfocused session closed" 'closed "herdr pane close p6"'
check "herdr: working worker kept" '! closed "herdr pane close p2"'
check "herdr: worker in a foreign tab kept" '! closed "herdr pane close p3"'
check "herdr: non-agt pane kept" '! closed "herdr pane close p4"'
check "herdr: session with an unread answer kept" '! closed "herdr pane close p7"'
check "herdr: self kept" '! closed "herdr pane close p0"'
check "herdr: lead state files removed" '[ ! -e "$HOME/.agentille/state/lead-w1-p0.tabs" ] && [ ! -e "$HOME/.agentille/state/lead-w1-p0.sessions" ]'

# 3. Herdr without a tab id (not a real lead pane): no call at all
: > "$LOG"
run HERDR_ENV=1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/herdr.json" >/dev/null 2>&1
check "herdr: no tab id, no calls" '[ ! -s "$LOG" ]'

# 4. a worker pane never sweeps its siblings
: > "$LOG"
printf '{"result":{"agents":[{"pane_id":"w1:p0","name":"agt-r1-exec-9","tab_id":"t1","agent_status":"idle"},{"pane_id":"p1","name":"agt-r1-exec-1","tab_id":"t1","agent_status":"done"}]}}' > "$T/worker.json"
run HERDR_ENV=1 HERDR_TAB_ID=t1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/worker.json" >/dev/null 2>&1
check "herdr: a worker sweeps nothing" '[ ! -s "$LOG" ]'

# 5. tmux: dead or done agt-* panes in the lead's window die; live, other-window and non-agt panes stay
printf '%%1\tagt-r1-exec-1\t0\t@1\n%%2\tagt-r1-exec-2\t1\t@1\n%%3\tagt-r1-exec-3\t0\t@1\n%%4\tnotes\t1\t@1\n%%5\tagt-r1-exec-5\t1\t@2\n%%0\t\t0\t@1\n' > "$T/tmux.txt"
mkdir -p "$HOME/.agentille/state/run-r1"; : > "$HOME/.agentille/state/run-r1/done-exec-1"
: > "$LOG"
out=$(run TMUX=1 TMUX_PANE=%0 TMUX_FIXTURE="$T/tmux.txt" 2>&1); rc=$?
check "tmux: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
check "tmux: done marker closes" 'closed "tmux kill-pane -t %1"'
check "tmux: dead pane closes" 'closed "tmux kill-pane -t %2"'
check "tmux: live worker kept" '! closed "tmux kill-pane -t %3"'
check "tmux: non-agt pane kept" '! closed "tmux kill-pane -t %4"'
check "tmux: other window kept" '! closed "tmux kill-pane -t %5"'
check "tmux: self kept" '! closed "tmux kill-pane -t %0"'

# 6. tmux: a worker pane never sweeps
: > "$LOG"
run SELF_AGT=agt-r1-exec-7 TMUX=1 TMUX_PANE=%0 TMUX_FIXTURE="$T/tmux.txt" >/dev/null 2>&1
check "tmux: a worker sweeps nothing" '[ ! -s "$LOG" ]'

[ "$bad" = 0 ] && echo "$n checks passed" || { echo "$bad of $n checks failed"; exit 1; }
