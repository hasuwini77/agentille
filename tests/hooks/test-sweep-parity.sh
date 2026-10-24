#!/usr/bin/env bash
# hooks/agentille-sweep.sh re-implements two things hooks/panes.js defines: the pane key (pane_key vs paneKey)
# and where a worker's answer lands (answer_saved vs answerFile/doneFile, plus the lead's own state files). If
# the two drift, the session-end sweep looks for an answer the worker never wrote, or misses one it did, and a
# finished pane stays open or a lead's ownership list is never found. This runs both sides over the same
# fixtures and compares them: the shell functions are extracted from the sweep script (sourcing it would run
# the hook), the JS side is one node call importing hooks/panes.js. Known divergences are pinned with each
# side's exact current output, so a change on either side shows up here. Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
export LC_ALL=C # tr works per byte under C on BSD and GNU alike; the non-ASCII pins below depend on it
SWEEP=hooks/agentille-sweep.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }

command -v node >/dev/null 2>&1 || { echo "sweep-parity: node not found, cannot run the JS side"; exit 1; }

# ── the shell side: the sweep's own function bodies, verbatim ────────────────
extract() { # <function name>: a one-line definition, or the block up to the first line that is just "}"
  awk -v fn="$1" '
    !on && index($0, fn "() {") == 1 { on = 1; print; if ($0 ~ /}[[:space:]]*$/) exit; next }
    on { print; if ($0 == "}") exit }' "$SWEEP"
}
for fn in pane_key lead_key lead_list lead_panes lead_tabs lead_sessions answer_saved; do
  body=$(extract "$fn")
  check "sweep defines $fn()" '[ -n "$body" ]'
  eval "$body"
done

# ── fixtures ─────────────────────────────────────────────────────────────────
# Pane ids that must key the same on both sides: herdr ids, tmux ids, and odd ASCII. One per line; the empty
# line is the empty id. Both sides print "" for no key (JS null).
cat > "$T/ids" <<'EOF'
pane:abc123
w1:p3
w1:p0
p5
%12
%0
pane:ABC_def-9
x_
a.b.c
w 1/p 3
--x--
::w1::p3::
a$b
a'b"c
a\b
*
:::

aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
# <pane name> <TAB> <pane id>: answer paths that must agree. Every name here passes the sweep's own
# ownership filter (^agt-[A-Za-z0-9_-]+$); the last rows are names both sides refuse.
printf '%s\t%s\n' \
  agt-r1-exec-1 'w1:p3' \
  agt-r1-exec-1 '%12' \
  agt-r2-code-reviewer 'pane:abc123' \
  agt-Ab9-exec-2 'p5' \
  agt-r1-spawn ':::' \
  agt-r1-x '' \
  agt-r1-exec_1 'p5' \
  agt-r1- 'p5' \
  agt--exec 'p5' \
  > "$T/pairs"
# Known divergences, pinned: <input> <TAB> <shell output> <TAB> <JS output>. Both differ today; see the notes.
#  - a key starting with "_": the shell keeps it, paneKey needs an alphanumeric first character → null.
#  - a key over 64 characters: the shell has no cap, paneKey caps at 64 → null.
#  - non-ASCII: tr replaces each byte, JS each UTF-16 unit ("é" is 2 bytes, 1 unit; an emoji 4 bytes, 2 units).
# A worker whose paneKey is null writes the legacy pane-<role>.md (worker.js), which answer_saved also checks,
# so none of these leaves a pane open; the shell just looks for one extra file that never exists.
long=$(printf 'b%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65)
printf '%s\t%s\t%s\n' \
  '_x' '_x' '' \
  '_p1:w2' '_p1-w2' '' \
  ':_x' '_x' '' \
  "$long" "$long" '' \
  "$(printf 'a\303\251b')" 'a--b' 'a-b' \
  "$(printf 'a\360\237\230\200b')" 'a----b' 'a--b' \
  > "$T/known"

# ── the JS side: one node call for every fixture ─────────────────────────────
PANES_URL=$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$PWD/hooks/panes.js")
export FIX="$T" PANES_URL FAKE_HOME="$T/home"
node --input-type=module -e '
  const fs = await import("node:fs")
  const { paneKey, splitName, answerFile, doneFile, panesFile, tabsFile, sessionsFile } = await import(process.env.PANES_URL)
  const dir = process.env.FIX, home = process.env.FAKE_HOME
  const lines = (f) => fs.readFileSync(dir + "/" + f, "utf8").replace(/\n$/, "").split("\n")
  const out = (f, rows) => fs.writeFileSync(dir + "/" + f, rows.map((r) => r + "\n").join(""))
  out("ids.js", lines("ids").map((id) => paneKey(id) ?? ""))
  out("lead.js", lines("ids").map((id) => [panesFile(home, id), tabsFile(home, id), sessionsFile(home, id)].map((p) => p ?? "").join("\t")))
  out("pairs.js", lines("pairs").map((l) => {
    const [name, id] = l.split("\t")
    const n = splitName(name)
    const c = n ? [answerFile(home, n.run, n.role, paneKey(id)), answerFile(home, n.run, n.role), doneFile(home, n.run, n.role)] : []
    return [...new Set(c.filter(Boolean))].join("\t") // a null key falls back to the legacy file: listed once
  }))
  out("known.js", lines("known").map((l) => paneKey(l.split("\t")[0]) ?? ""))
' || { echo "sweep-parity: the JS side did not run"; exit 1; }

# ── 1. pane key ──────────────────────────────────────────────────────────────
i=0
while IFS= read -r id; do
  i=$((i+1))
  js=$(sed -n "${i}p" "$T/ids.js"); sh=$(pane_key "$id")
  check "pane key of [$id]: shell [$sh] = JS [$js]" '[ "$sh" = "$js" ]'
done < "$T/ids"
check "every pane id fixture was compared" '[ "$i" -ge 18 ] && [ "$i" = "$(wc -l < "$T/ids.js" | tr -d " ")" ]'

# ── 2. the lead's state files (lead-<key>.panes / .tabs / .sessions) ─────────
# lead_list reads "$HOME/.agentille/state/lead-<key>.<suffix>": write each file at the path JS names and the
# sweep must read it back under that lead id; with no JS path, the sweep must find nothing.
i=0
while IFS= read -r id; do
  i=$((i+1))
  IFS=$'\t' read -r jp jt js <<EOF
$(sed -n "${i}p" "$T/lead.js")
EOF
  rm -rf "$FAKE_HOME"; mkdir -p "$FAKE_HOME/.agentille/state"
  if [ -n "$jp" ]; then
    printf 'agt-r1-exec-1\nnot a pane\n' > "$jp"; printf 't9\n' > "$jt"; printf 's-r1-1\n' > "$js"
    got=$(HOME="$FAKE_HOME" HERDR_PANE_ID="$id" lead_panes); check "lead [$id]: sweep reads panesFile" '[ "$got" = agt-r1-exec-1 ]'
    got=$(HOME="$FAKE_HOME" HERDR_PANE_ID="$id" lead_tabs); check "lead [$id]: sweep reads tabsFile" '[ "$got" = t9 ]'
    got=$(HOME="$FAKE_HOME" HERDR_PANE_ID="" TMUX_PANE="$id" lead_sessions); check "lead [$id] (tmux): sweep reads sessionsFile" '[ "$got" = s-r1-1 ]'
  else
    : > "$FAKE_HOME/.agentille/state/lead-.panes"
    got=$(HOME="$FAKE_HOME" HERDR_PANE_ID="$id" lead_panes); check "lead [$id]: no JS path, sweep reads nothing" '[ -z "$got" ]'
  fi
done < "$T/ids"

# ── 3. saved-answer paths (answer_saved vs answerFile + doneFile) ────────────
# Exact list: the paths answer_saved tests with -f, in order, read from xtrace, must be the JS candidates.
# Behaviour: each JS candidate alone on disk makes answer_saved succeed; none on disk, or another pane's
# answer file, does not.
probe() { ( PS4='+ '; set -x; answer_saved "$1" "$2" ) 2>&1 >/dev/null | sed -n "s/^+\{1,\} \[ -f \(.*\) \]\$/\1/p; s/^+\{1,\} '\[' -f \(.*\) '\]'\$/\1/p" | paste -sd '\t' -; }
saved() { HOME="$FAKE_HOME" answer_saved "$1" "$2"; }
i=0
while IFS=$'\t' read -r name id; do
  i=$((i+1))
  js=$(sed -n "${i}p" "$T/pairs.js")
  rm -rf "$FAKE_HOME"; mkdir -p "$FAKE_HOME"
  sh=$(HOME="$FAKE_HOME" probe "$name" "$id")
  check "answer paths of $name in [$id]: shell = JS
      shell: $sh
      JS:    $js" '[ "$sh" = "$js" ]'
  check "$name in [$id]: nothing on disk, not saved" '! saved "$name" "$id"'
  if [ -n "$js" ]; then
    printf '%s\n' "$js" | tr '\t' '\n' | while IFS= read -r p; do
      mkdir -p "$(dirname "$p")"; : > "$p"
      saved "$name" "$id" || echo "FAIL $name in [$id]: $p on disk but answer_saved says no"
      rm -f "$p"
    done > "$T/miss"
    check "$name in [$id]: every JS path counts as saved" '[ ! -s "$T/miss" ] || { cat "$T/miss"; false; }'
    own=$(printf '%s\n' "$js" | cut -f1)
    case "$own" in *.md)
      other=$(printf '%s' "$own" | sed 's/\.[^./]*\.md$/.zz9.md/')
      if [ "$other" != "$own" ]; then mkdir -p "$(dirname "$other")"; : > "$other"
        check "$name in [$id]: another pane's answer file does not count" '! saved "$name" "$id"'; rm -f "$other"; fi ;;
    esac
  fi
done < "$T/pairs"
check "every name/id pair was compared" '[ "$i" -ge 9 ]'

# ── 4. known divergences, pinned ─────────────────────────────────────────────
# A failure here means one side changed. If the two now agree, move the input up into the fixtures above.
i=0
while IFS=$'\t' read -r in want_sh want_js; do
  i=$((i+1))
  js=$(sed -n "${i}p" "$T/known.js"); sh=$(pane_key "$in")
  check "known divergence [$in]: shell still [$want_sh] (got [$sh])" '[ "$sh" = "$want_sh" ]'
  check "known divergence [$in]: JS still [$want_js] (got [$js])" '[ "$js" = "$want_js" ]'
done < "$T/known"
# A run id over 64 characters: splitName refuses it (SAFE_RUN caps at 64), answer_saved has no cap and looks.
rm -rf "$FAKE_HOME"; mkdir -p "$FAKE_HOME"
sh=$(HOME="$FAKE_HOME" probe "agt-$long-exec" p5)
check "known divergence: a 65-char run id is checked by the shell" '[ -n "$sh" ]'
js=$(NAME="agt-$long-exec" node --input-type=module -e 'const { splitName } = await import(process.env.PANES_URL); process.stdout.write(String(splitName(process.env.NAME)))')
check "known divergence: a 65-char run id is refused by splitName (got [$js])" '[ "$js" = null ]'

[ "$bad" = 0 ] && echo "sweep-parity: $n checks pass" || { echo "sweep-parity: $bad of $n checks fail"; exit 1; }
