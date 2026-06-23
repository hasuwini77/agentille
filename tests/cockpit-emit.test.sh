#!/usr/bin/env bash
set -u
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/cockpit-emit.sh"
fails=0
check() { if [ "$1" = "$2" ]; then echo "PASS: $3"; else echo "FAIL: $3 (got '$1' want '$2')"; fails=$((fails+1)); fi; }

# --- Test 1: Appends a line ---
{
  TH=$(mktemp -d)
  HOME="$TH" bash "$SCRIPT" --run abc <<< '{"seq":0,"ts":1,"type":"phase"}'
  got=$(cat "$TH/.agentille/cockpit/runs/abc.jsonl" 2>/dev/null)
  check "$got" '{"seq":0,"ts":1,"type":"phase"}' "T1: appends line"
  rm -rf "$TH"
}

# --- Test 2: Permissions (dir 700, file 600) ---
{
  TH=$(mktemp -d)
  HOME="$TH" bash "$SCRIPT" --run abc <<< '{"seq":0}'
  dir_perm=$(stat -c '%a' "$TH/.agentille/cockpit" 2>/dev/null)
  file_perm=$(stat -c '%a' "$TH/.agentille/cockpit/runs/abc.jsonl" 2>/dev/null)
  check "$dir_perm" "700" "T2a: cockpit dir is 700"
  check "$file_perm" "600" "T2b: file is 600"
  rm -rf "$TH"
}

# --- Test 3: Path traversal rejected, exits 0 ---
{
  TH=$(mktemp -d)
  HOME="$TH" bash "$SCRIPT" --run '../evil' <<< '{"seq":0}'
  exit_code=$?
  check "$exit_code" "0" "T3a: path-traversal exits 0"
  # evil.jsonl must NOT exist anywhere under cockpit
  evil_exists="no"
  [ -f "$TH/.agentille/cockpit/evil.jsonl" ] && evil_exists="yes"
  check "$evil_exists" "no" "T3b: path-traversal writes nothing"
  rm -rf "$TH"
}

# --- Test 4: Always exits 0 even when dir is unwritable ---
{
  TH=$(mktemp -d)
  # Pre-create the dir with restrictive perms
  mkdir -p "$TH/.agentille/cockpit"
  chmod 500 "$TH/.agentille/cockpit"
  HOME="$TH" bash "$SCRIPT" --run abc <<< '{"seq":0}'
  exit_code=$?
  chmod 700 "$TH/.agentille/cockpit" 2>/dev/null
  check "$exit_code" "0" "T4: exits 0 when dir unwritable"
  rm -rf "$TH"
}

# --- Test 5: Append not truncate (2 emits → 2 lines) ---
{
  TH=$(mktemp -d)
  HOME="$TH" bash "$SCRIPT" --run abc <<< '{"seq":0}'
  HOME="$TH" bash "$SCRIPT" --run abc <<< '{"seq":1}'
  line_count=$(wc -l < "$TH/.agentille/cockpit/runs/abc.jsonl" 2>/dev/null)
  check "$line_count" "2" "T5: two emits yield 2 lines"
  rm -rf "$TH"
}

echo "----"
[ "$fails" -eq 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
