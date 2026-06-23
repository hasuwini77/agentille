#!/usr/bin/env bash
# cockpit-emit.sh — fail-silent observability append for agentille-cockpit.
# Appends one JSON line (read from stdin) to ~/.agentille/cockpit/runs/<run>.jsonl.
# ALWAYS exits 0: a write failure must never derail an /agt run.
set -u

run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

case "$run" in
  ""|*[!A-Za-z0-9_-]*) exit 0 ;;
esac

dir="${HOME}/.agentille/cockpit/runs"
mkdir -p "$dir" 2>/dev/null || exit 0
chmod 700 "$dir" 2>/dev/null
chmod 700 "${HOME}/.agentille/cockpit" 2>/dev/null
file="${dir}/${run}.jsonl"
[ -e "$file" ] || { (umask 077; : >> "$file") 2>/dev/null || exit 0; }
cat >> "$file" 2>/dev/null || true
exit 0
