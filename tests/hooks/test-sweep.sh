#!/usr/bin/env bash
# Deterministic test of hooks/agentille-sweep.sh with fake herdr and tmux binaries that log every
# call. Checks what gets closed and, above all, what never does: another session's panes, a pane
# whose answer is not saved, anything on /clear. Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
HOOK="$PWD/hooks/agentille-sweep.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.agentille/state" "$T/bin"
LOG="$T/calls.log"; : > "$LOG"
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }
closed() { grep -E "^$1\$" "$LOG" >/dev/null; }

# fake herdr: `agent list` prints $HERDR_FIXTURE (and is logged); every other call is logged
cat > "$T/bin/herdr" <<'H'
#!/usr/bin/env bash
echo "herdr $*" >> "$CALLS"
if [ "$1" = agent ] && [ "$2" = list ]; then cat "$HERDR_FIXTURE"; exit 0; fi
exit 0
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
# run <VAR=value ...>: the hook in a clean multiplexer environment plus the given variables; stdin is $PAYLOAD
PAYLOAD='{"session_id":"s1","reason":"other"}'
run() { ( unset HERDR_ENV HERDR_TAB_ID HERDR_PANE_ID TMUX TMUX_PANE SELF_AGT; for kv in "$@"; do export "$kv"; done; printf '%s' "$PAYLOAD" | bash "$HOOK" ); }
S="$HOME/.agentille/state"
seed() { # the lead w1:p0's state: panes it opened, its run tab, its sessions, and the saved answers on disk
  rm -rf "$S"; mkdir -p "$S/run-r1/agents" "$S/run-r2/agents"
  printf 'agt-r1-exec-1\nagt-r1-exec-2\nagt-r1-exec-4\nagt-r1-exec-5\nagt-r2-exec-1\n' > "$S/lead-w1-p0.panes"
  printf 't2\n' > "$S/lead-w1-p0.tabs"
  printf 's-r1-1\ns-r1-2\n' > "$S/lead-w1-p0.sessions"
  : > "$S/run-r1/done-exec-1"                 # exec-1: done marker
  : > "$S/run-r2/agents/pane-exec-1.p5.md"    # r2 exec-1 in pane p5: its own answer file
  : > "$S/run-r1/agents/pane-exec-6.md"       # a saved answer of a pane this lead never opened
}

# 1. outside any multiplexer: nothing runs
out=$(run 2>&1); rc=$?
check "no mux: exit 0, silent, no calls" '[ "$rc" = 0 ] && [ -z "$out" ] && [ ! -s "$LOG" ]'

# 2. Herdr: of the panes this lead opened, the finished ones with a saved answer close; everything else stays
cat > "$T/herdr.json" <<'J'
{"result":{"agents":[
 {"pane_id":"p0","name":"lead","tab_id":"t1","agent_status":"idle"},
 {"pane_id":"p1","name":"agt-r1-exec-1","tab_id":"t1","agent_status":"done"},
 {"pane_id":"p2","name":"agt-r1-exec-2","tab_id":"t1","agent_status":"working"},
 {"pane_id":"p3","name":"agt-r1-exec-3","tab_id":"t1","agent_status":"idle"},
 {"pane_id":"p4","name":"agt-r1-exec-4","tab_id":"t1","agent_status":"done"},
 {"pane_id":"p5","name":"agt-r2-exec-1","tab_id":"t2","agent_status":"idle"},
 {"pane_id":"p6","name":"s-r1-1","tab_id":"t1","agent_status":"idle","focused":false},
 {"pane_id":"p7","name":"s-r1-2","tab_id":"t1","agent_status":"done","focused":false},
 {"pane_id":"p8","name":"agt-r1-exec-6","tab_id":"t1","agent_status":"done"},
 {"pane_id":"p9","name":"agt-notes","tab_id":"t1","agent_status":"idle"},
 {"pane_id":"p10","name":"scratch","tab_id":"t1","agent_status":"idle"},
 {"pane_id":"p11","name":"agt-r1-exec-5","tab_id":"t1","agent_status":"dead"}
]}}
J
seed; : > "$LOG"
out=$(run HERDR_ENV=1 HERDR_TAB_ID=t1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/herdr.json" 2>&1); rc=$?
check "herdr: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
check "herdr: own done worker with a done marker closed" 'closed "herdr pane close p1"'
check "herdr: own idle worker in the run tab with its answer file closed" 'closed "herdr pane close p5"'
check "herdr: own dead worker closed" 'closed "herdr pane close p11"'
check "herdr: own idle unfocused session closed" 'closed "herdr pane close p6"'
check "herdr: own working worker kept" '! closed "herdr pane close p2"'
check "herdr: own done worker with no saved answer kept" '! closed "herdr pane close p4"'
check "herdr: another session's idle worker in the same tab kept" '! closed "herdr pane close p3"'
check "herdr: another session's done worker, answer saved, kept" '! closed "herdr pane close p8"'
check "herdr: a person's pane named agt-notes kept" '! closed "herdr pane close p9"'
check "herdr: non-agt pane kept" '! closed "herdr pane close p10"'
check "herdr: session with an unread answer kept" '! closed "herdr pane close p7"'
check "herdr: self kept" '! closed "herdr pane close p0"'
check "herdr: lead state files removed" '[ ! -e "$S/lead-w1-p0.panes" ] && [ ! -e "$S/lead-w1-p0.tabs" ] && [ ! -e "$S/lead-w1-p0.sessions" ]'

# 3. /clear is not an exit: nothing closes, the lists stay
seed; : > "$LOG"
PAYLOAD='{"session_id":"s1","reason":"clear"}' run HERDR_ENV=1 HERDR_TAB_ID=t1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/herdr.json" >/dev/null 2>&1
check "herdr: /clear makes no call" '[ ! -s "$LOG" ]'
check "herdr: /clear keeps the lead's lists" '[ -e "$S/lead-w1-p0.panes" ] && [ -e "$S/lead-w1-p0.sessions" ]'

# 4. a session that opened nothing reads nothing and closes nothing, whatever sits in its tab
rm -rf "$S"; mkdir -p "$S"; : > "$LOG"
run HERDR_ENV=1 HERDR_TAB_ID=t1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/herdr.json" >/dev/null 2>&1
check "herdr: no lists, no calls (not even agent list)" '[ ! -s "$LOG" ]'

# 5. Herdr without a tab id (not a real lead pane): no call at all
seed; : > "$LOG"
run HERDR_ENV=1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/herdr.json" >/dev/null 2>&1
check "herdr: no tab id, no calls" '[ ! -s "$LOG" ]'

# 6. a worker pane never sweeps its siblings, even with a list under its key
seed; printf 'agt-r1-exec-1\n' > "$S/lead-w1-p0.panes"; : > "$LOG"
printf '{"result":{"agents":[{"pane_id":"w1:p0","name":"agt-r1-exec-9","tab_id":"t1","agent_status":"idle"},{"pane_id":"p1","name":"agt-r1-exec-1","tab_id":"t1","agent_status":"done"}]}}' > "$T/worker.json"
run HERDR_ENV=1 HERDR_TAB_ID=t1 HERDR_PANE_ID=w1:p0 HERDR_FIXTURE="$T/worker.json" >/dev/null 2>&1
check "herdr: a worker closes nothing" '! grep -q "pane close" "$LOG"'

# 7. tmux: of the lead's own panes in its window, done-marker and dead ones die; the rest and every stranger stay
printf '%%1\tagt-r1-exec-1\t0\t@1\n%%2\tagt-r1-exec-2\t1\t@1\n%%3\tagt-r1-exec-3\t0\t@1\n%%4\tnotes\t1\t@1\n%%5\tagt-r1-exec-5\t1\t@2\n%%6\tagt-r1-exec-6\t0\t@1\n%%0\t\t0\t@1\n' > "$T/tmux.txt"
rm -rf "$S"; mkdir -p "$S/run-r1/agents"
printf 'agt-r1-exec-1\nagt-r1-exec-2\nagt-r1-exec-3\nagt-r1-exec-5\n' > "$S/lead-0.panes"
: > "$S/run-r1/done-exec-1"; : > "$S/run-r1/done-exec-6"
: > "$LOG"
out=$(run TMUX=1 TMUX_PANE=%0 TMUX_FIXTURE="$T/tmux.txt" 2>&1); rc=$?
check "tmux: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
check "tmux: own pane with a done marker closes" 'closed "tmux kill-pane -t %1"'
check "tmux: own dead pane closes" 'closed "tmux kill-pane -t %2"'
check "tmux: own live worker with no answer kept" '! closed "tmux kill-pane -t %3"'
check "tmux: non-agt pane kept" '! closed "tmux kill-pane -t %4"'
check "tmux: other window kept" '! closed "tmux kill-pane -t %5"'
check "tmux: another session's done pane kept" '! closed "tmux kill-pane -t %6"'
check "tmux: self kept" '! closed "tmux kill-pane -t %0"'
check "tmux: the lead's pane list removed" '[ ! -e "$S/lead-0.panes" ]'

# 8. tmux: a worker pane never sweeps; a lead with no list makes no tmux call
printf 'agt-r1-exec-1\n' > "$S/lead-0.panes"; : > "$LOG"
run SELF_AGT=agt-r1-exec-7 TMUX=1 TMUX_PANE=%0 TMUX_FIXTURE="$T/tmux.txt" >/dev/null 2>&1
check "tmux: a worker kills nothing" '! grep -q kill-pane "$LOG"'
rm -f "$S/lead-0.panes"; : > "$LOG"
run TMUX=1 TMUX_PANE=%0 TMUX_FIXTURE="$T/tmux.txt" >/dev/null 2>&1
check "tmux: no list, nothing killed" '[ ! -s "$LOG" ]'

[ "$bad" = 0 ] && echo "$n checks passed" || { echo "$bad of $n checks failed"; exit 1; }
