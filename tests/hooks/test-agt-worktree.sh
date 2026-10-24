#!/usr/bin/env bash
# Real-git test of scripts/agt-worktree.sh in a throwaway repo: what it prints, re-attach (directory, then
# branch), what it refuses, which .env files it copies, node_modules copied and never linked. Then
# tests/hooks/tidy-real.mjs drives the mod's own guard and reaper over the same repo under node (skipped, and
# said so, where node is missing or older than 22.7). Exit 0 = all checks pass.
set -u
# A git hook (pre-push runs this suite) exports GIT_DIR and friends; they would point every git call at the
# real repo instead of the throwaway one.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX
cd "$(dirname "$0")/../.." || exit 2
SCRIPT="$PWD/scripts/agt-worktree.sh"
DRIVER="$PWD/tests/hooks/tidy-real.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
T=$(cd "$T" && pwd -P)
export HOME="$T/home" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
mkdir -p "$HOME"
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }

R="$T/proj"; mkdir -p "$R" && cd "$R" || exit 2
git init -q -b main
printf '.env\n.env.local\nnode_modules/\n' > .gitignore
echo 'EXAMPLE=1' > .env.example
git add . && git commit -qm init
echo 'SECRET=1' > .env; echo 'LOCAL=1' > .env.local; echo 'U=1' > .env.untracked
mkdir -p node_modules/pkg && echo 'module.exports = 1' > node_modules/pkg/index.js

# 1. a new tree: two stdout lines, the path as git lists it, the default agt/<slug> branch
out=$(bash "$SCRIPT" ui 2>"$T/err"); rc=$?
check "new: exit 0" '[ "$rc" = 0 ]'
check "new: exactly two stdout lines" '[ "$(printf "%s\n" "$out" | wc -l | tr -d " ")" = 2 ]'
check "new: path= is the sibling tree" '[ "$(printf "%s\n" "$out" | sed -n 1p)" = "path=$T/proj-ui" ]'
check "new: branch=agt/ui" '[ "$(printf "%s\n" "$out" | sed -n 2p)" = "branch=agt/ui" ]'
check "new: git lists the printed path" 'git worktree list --porcelain | grep -qxF "worktree $T/proj-ui"'
check "new: the tree is on agt/ui" '[ "$(git -C "$T/proj-ui" symbolic-ref --short HEAD)" = agt/ui ]'
check "new: git noise went to stderr" 'grep -q . "$T/err"'
check "env: the ignored .env and .env.local are copied" '[ -f "$T/proj-ui/.env" ] && [ -f "$T/proj-ui/.env.local" ]'
check "env: an un-ignored .env.untracked is not" '[ ! -e "$T/proj-ui/.env.untracked" ]'
check "env: the tracked .env.example is the branch's own" '[ "$(git -C "$T/proj-ui" status --porcelain -- .env.example)" = "" ]'
check "node_modules: copied" '[ -f "$T/proj-ui/node_modules/pkg/index.js" ]'
check "node_modules: never a symlink" '[ ! -L "$T/proj-ui/node_modules" ]'
check "node_modules: not a hardlink" '[ "$(ls -i "$T/proj-ui/node_modules/pkg/index.js" | cut -d" " -f1)" != "$(ls -i "$R/node_modules/pkg/index.js" | cut -d" " -f1)" ]'

# 2. re-attach: the directory, from the main checkout and from inside a worktree
rm -f "$T/proj-ui/.env"
out2=$(bash "$SCRIPT" ui 2>/dev/null); rc=$?
check "re-attach dir: exit 0, same two lines" '[ "$rc" = 0 ] && [ "$out2" = "$out" ]'
check "re-attach dir: .env copied again" '[ -f "$T/proj-ui/.env" ]'
out3=$(cd "$T/proj-ui" && bash "$SCRIPT" ui 2>/dev/null); rc=$?
check "re-attach from inside the tree: same two lines" '[ "$rc" = 0 ] && [ "$out3" = "$out" ]'
check "re-attach: still one tree for it" '[ "$(git worktree list --porcelain | grep -c "^worktree $T/proj-ui$")" = 1 ]'

# 3. re-attach: the branch, once the tree is gone
git -C "$T/proj-ui" commit -q --allow-empty -m 'slice work'
git worktree remove --force "$T/proj-ui"
out4=$(bash "$SCRIPT" ui 2>/dev/null); rc=$?
check "re-attach branch: exit 0, same two lines" '[ "$rc" = 0 ] && [ "$out4" = "$out" ]'
check "re-attach branch: the slice commit is there" '[ "$(git -C "$T/proj-ui" log -1 --format=%s)" = "slice work" ]'

# 4. --branch and --base
git branch -q dev main && git -C "$R" commit -q --allow-empty -m 'main moves on'
out5=$(bash "$SCRIPT" api --branch feat/api --base dev 2>/dev/null); rc=$?
check "branch+base: branch=feat/api" '[ "$rc" = 0 ] && [ "$(printf "%s\n" "$out5" | sed -n 2p)" = "branch=feat/api" ]'
check "branch+base: forked from dev" '[ "$(git rev-parse feat/api)" = "$(git rev-parse dev)" ]'

# 5. refusals: nothing on stdout, a nonzero exit
o=$(bash "$SCRIPT" "Bad Slug" 2>/dev/null); rc=$?
check "refuse: a slug that is not kebab-case exits 2" '[ "$rc" = 2 ] && [ -z "$o" ]'
o=$(bash "$SCRIPT" 2>/dev/null); rc=$?
check "refuse: no slug exits 2" '[ "$rc" = 2 ] && [ -z "$o" ]'
mkdir -p "$T/proj-mine"
o=$(bash "$SCRIPT" mine 2>/dev/null); rc=$?
check "refuse: a directory that is not a worktree of the repo" '[ "$rc" = 1 ] && [ -z "$o" ] && [ -z "$(ls -A "$T/proj-mine")" ]'
o=$(bash "$SCRIPT" ui --branch feat/other 2>/dev/null); rc=$?
check "refuse: the tree is on another branch" '[ "$rc" = 1 ] && [ -z "$o" ]'
o=$(cd "$T" && bash "$SCRIPT" ui 2>/dev/null); rc=$?
check "refuse: outside a repository" '[ "$rc" = 1 ] && [ -z "$o" ]'

# 6. the mod over the same repo: the guard records what the script printed, the sweep deletes the copies
skip=""
if ! command -v node >/dev/null 2>&1; then skip="node missing"
else
  v=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.stdout.write(a>22||(a===22&&b>=7)?"ok":process.versions.node)')
  [ "$v" = ok ] || skip="node $v is older than 22.7"
fi
if [ -z "$skip" ]; then
  dout=$(node "$DRIVER" "$R" "$SCRIPT" "$HOME" 2>&1); drc=$?
  while IFS= read -r line; do
    case "$line" in
      ok\ *) n=$((n+1)) ;;
      FAIL\ *) n=$((n+1)); bad=$((bad+1)); echo "$line" ;;
    esac
  done <<< "$dout"
  check "mod: the driver ran to the end" '[ "$drc" = 0 ] || [ "$bad" -gt 0 ]'
  [ "$drc" = 0 ] || [ "$bad" -gt 0 ] || printf '%s\n' "$dout" | tail -5
fi

note=""; [ -n "$skip" ] && note=" (mod checks skipped: $skip)"
# CI must never go green with the mod checks skipped (the validator's own rule for skipped hook tests).
[ -n "$skip" ] && [ "${CI:-}" = "true" ] && { echo "FAIL mod checks skipped under CI=true: $skip"; exit 1; }
[ "$bad" = 0 ] && echo "$n checks passed$note" || { echo "$bad of $n checks failed$note"; exit 1; }
