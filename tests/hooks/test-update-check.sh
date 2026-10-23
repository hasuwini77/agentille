#!/usr/bin/env bash
# Deterministic test of hooks/agentille-update-check.sh: a fake HOME, a fake plugin root and
# file:// fixtures in place of GitHub. No network, no real ~/.agentille. Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
HOOK="$PWD/hooks/agentille-update-check.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
ROOT="$T/plugin"; mkdir -p "$ROOT/.claude-plugin"
printf '{ "name": "agentille", "version": "1.0.0" }\n' > "$ROOT/.claude-plugin/plugin.json"
CACHE="$HOME/.agentille/.update-check.json"
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }
run() { CLAUDE_PLUGIN_ROOT="$ROOT" AGENTILLE_RAW_URL="file://$1" bash "$HOOK" </dev/null; }

# 1. a newer remote prints the notice and caches update_available: true
printf '{ "version": "1.2.0" }\n' > "$T/newer.json"
out=$(run "$T/newer.json"); rc=$?
check "newer: exit 0" '[ "$rc" = 0 ]'
check "newer: notice printed" '[[ "$out" == *"agentille 1.2.0 available (you'"'"'re on 1.0.0)"* ]]'
check "newer: cache written" 'grep -q "\"update_available\": true" "$CACHE"'

# 2. within the TTL the cache answers, even when the remote is gone
out=$(run "$T/missing.json")
check "cached: notice from cache" '[[ "$out" == *"1.2.0 available"* ]]'

# 3. a same-version remote is silent and caches update_available: false
rm -f "$CACHE"; printf '{ "version": "1.0.0" }\n' > "$T/same.json"
out=$(run "$T/same.json")
check "same: silent" '[ -z "$out" ]'
check "same: cache false" 'grep -q "\"update_available\": false" "$CACHE"'

# 4. AGENTILLE_UPDATE_CHECK=0 fetches nothing and writes nothing
rm -f "$CACHE"
out=$(AGENTILLE_UPDATE_CHECK=0 run "$T/newer.json"); rc=$?
check "opt-out: exit 0" '[ "$rc" = 0 ]'
check "opt-out: silent" '[ -z "$out" ]'
check "opt-out: no cache" '[ ! -e "$CACHE" ]'

# 5. garbage or an unreachable remote never prints, never errors, never poisons the cache
printf 'version: "9.9.9"; <html>' > "$T/garbage.json"
out=$(run "$T/garbage.json" 2>&1); rc=$?
check "garbage: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
check "garbage: no cache" '[ ! -e "$CACHE" ]'
out=$(run "$T/missing.json" 2>&1); rc=$?
check "unreachable: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'

# 6. a corrupt cache is ignored, not parsed into a bash error
mkdir -p "$HOME/.agentille"; printf 'not json' > "$CACHE"
out=$(run "$T/newer.json" 2>&1); rc=$?
check "corrupt cache: exit 0, no stderr noise" '[ "$rc" = 0 ] && [[ "$out" != *"syntax error"* ]]'
check "corrupt cache: replaced" 'grep -q "\"remote\": \"1.2.0\"" "$CACHE"'

[ "$bad" = 0 ] && echo "$n checks passed" || { echo "$bad of $n checks failed"; exit 1; }
