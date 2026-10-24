#!/usr/bin/env bash
# Deterministic test of hooks/agentille-update-check.sh: a fake HOME, a fake plugin root and
# file:// fixtures in place of GitHub. No network, no real ~/.agentille. Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
HOOK="$PWD/hooks/agentille-update-check.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
# The opt-out switches are tested below; a shell that sets them must not skip every other check.
unset CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_TELEMETRY AGENTILLE_UPDATE_CHECK
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

# 4b. Claude Code's non-essential-traffic and telemetry switches skip it too (1 or true, any case)
for kv in CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=true DISABLE_TELEMETRY=1 DISABLE_TELEMETRY=TRUE; do
  rm -f "$CACHE"
  out=$(env "$kv" CLAUDE_PLUGIN_ROOT="$ROOT" AGENTILLE_RAW_URL="file://$T/newer.json" bash "$HOOK" </dev/null); rc=$?
  check "$kv: exit 0, silent" '[ "$rc" = 0 ] && [ -z "$out" ]'
  check "$kv: no fetch, no cache" '[ ! -e "$CACHE" ]'
done
# 4c. set to 0 or empty, they do not opt out
rm -f "$CACHE"
out=$(CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=0 DISABLE_TELEMETRY= run "$T/newer.json")
check "switches off: still checks" '[[ "$out" == *"1.2.0 available"* ]]'
rm -f "$CACHE"

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

# 7. a cache written at an older local version is stale: after the plugin updates, refetch
mkdir -p "$HOME/.agentille"
printf '{\n  "checked_at": %s,\n  "local": "3.23.0",\n  "remote": "3.24.0",\n  "update_available": true,\n  "message": "agentille 3.24.0 available (you'"'"'re on 3.23.0) - run /plugin to update"\n}\n' "$(date +%s)" > "$CACHE"
printf '{ "name": "agentille", "version": "3.24.0" }\n' > "$ROOT/.claude-plugin/plugin.json"
printf '{ "version": "3.24.0" }\n' > "$T/now.json"
out=$(run "$T/now.json" 2>&1); rc=$?
check "updated plugin: exit 0" '[ "$rc" = 0 ]'
check "updated plugin: stale 'newer version' notice gone" '[ -z "$out" ]'
check "updated plugin: cache refetched at 3.24.0" 'grep -q "\"local\": \"3.24.0\"" "$CACHE" && grep -q "\"update_available\": false" "$CACHE"'
printf '{ "name": "agentille", "version": "1.0.0" }\n' > "$ROOT/.claude-plugin/plugin.json"

[ "$bad" = 0 ] && echo "$n checks passed" || { echo "$bad of $n checks failed"; exit 1; }
