#!/usr/bin/env bash
# SessionStart hook — checks for a newer agentille version once per day.
# Must NEVER error or block the session: every failure path is a silent exit 0.

# Discard stdin (Claude Code passes JSON on stdin)
cat >/dev/null 2>&1 || true

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RAW_URL="${AGENTILLE_RAW_URL:-https://raw.githubusercontent.com/hasuwini77/agentille/main/.claude-plugin/plugin.json}"
CACHE_DIR="$HOME/.agentille"
CACHE_FILE="$CACHE_DIR/.update-check.json"
TTL=86400

mkdir -p "$CACHE_DIR" 2>/dev/null

# ── Local version ────────────────────────────────────────────────────────────
LOCAL_JSON="$ROOT/.claude-plugin/plugin.json"
LOCAL=""
if [[ -f "$LOCAL_JSON" ]]; then
  LOCAL=$(grep -m1 '"version"' "$LOCAL_JSON" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
fi
[[ -z "$LOCAL" ]] && exit 0

# ── Cache logic ───────────────────────────────────────────────────────────────
NOW=$(date +%s)

if [[ -f "$CACHE_FILE" ]]; then
  CHECKED_AT=$(grep -m1 '"checked_at"' "$CACHE_FILE" | sed -E 's/.*"checked_at"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/')
  CACHED_LOCAL=$(grep -m1 '"local"' "$CACHE_FILE" | sed -E 's/.*"local"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  CACHED_UPDATE=$(grep -m1 '"update_available"' "$CACHE_FILE" | sed -E 's/.*"update_available"[[:space:]]*:[[:space:]]*(true|false).*/\1/')
  CACHED_MSG=$(grep -m1 '"message"' "$CACHE_FILE" | sed -E 's/.*"message"[[:space:]]*:[[:space:]]*"(.*)".*/\1/')
  AGE=$(( NOW - CHECKED_AT ))

  if [[ -n "$CHECKED_AT" && "$AGE" -lt "$TTL" && "$CACHED_LOCAL" == "$LOCAL" ]]; then
    if [[ "$CACHED_UPDATE" == "true" ]]; then
      echo "$CACHED_MSG"
    fi
    exit 0
  fi
fi

# ── Network fetch ─────────────────────────────────────────────────────────────
REMOTE_JSON=$(curl -fsS --max-time 3 "$RAW_URL" 2>/dev/null)
if [[ -z "$REMOTE_JSON" ]]; then
  exit 0
fi

REMOTE=$(echo "$REMOTE_JSON" | grep -m1 '"version"' | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
[[ -z "$REMOTE" ]] && exit 0

# ── Semver compare ────────────────────────────────────────────────────────────
NEWEST=$(printf '%s\n%s\n' "$LOCAL" "$REMOTE" | sort -V | tail -n1)
UPDATE_AVAILABLE="false"
MESSAGE=""
if [[ "$REMOTE" != "$LOCAL" && "$NEWEST" == "$REMOTE" ]]; then
  UPDATE_AVAILABLE="true"
  MESSAGE="agentille $REMOTE available (you're on $LOCAL) — run /plugin to update"
fi

# ── Write cache atomically ────────────────────────────────────────────────────
CACHE_TMP="$CACHE_FILE.tmp$$"
cat >"$CACHE_TMP" <<ENDJSON
{
  "checked_at": $NOW,
  "local": "$LOCAL",
  "remote": "$REMOTE",
  "update_available": $UPDATE_AVAILABLE,
  "message": "$MESSAGE"
}
ENDJSON
mv "$CACHE_TMP" "$CACHE_FILE"

# ── Notify if update available ────────────────────────────────────────────────
if [[ "$UPDATE_AVAILABLE" == "true" ]]; then
  echo "$MESSAGE"
fi

exit 0
