#!/usr/bin/env bash
# The oldest Claude Code the mod needs is written twice: hooks/skew.js MIN_HOST (what the session-start
# check enforces) and the README's Requirements row (what a reader is told). This keeps them equal.
# Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }

code=$(grep -oE "^export const MIN_HOST = '[0-9]+\.[0-9]+\.[0-9]+'" hooks/skew.js | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
readme=$(grep -oE '^\| Claude Code [0-9]+\.[0-9]+\.[0-9]+\+' README.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
check "skew.js names MIN_HOST" '[ -n "$code" ]'
check "README Requirements names a Claude Code version" '[ -n "$readme" ]'
check "the two agree ($code vs $readme)" '[ "$code" = "$readme" ]'

[ "$bad" = 0 ] && echo "min-version: $n checks pass" || { echo "min-version: $bad of $n checks fail"; exit 1; }
