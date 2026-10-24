#!/usr/bin/env bash
# The Bash guard against real git (tests/hooks/guard-real.mjs): a scratch repo with a bare origin, the real git
# binary for every probe, and the allowed lines run for real. The mod's test kit has no process of its own, so
# this half of the guard's tests runs under node. Exit 0 = all checks pass; exit 3 with a `SKIP: <reason>` line =
# node or git missing (scripts/validate.sh: a WARN on a developer machine, a FAIL under CI=true).
set -u
cd "$(dirname "$0")/../.." || exit 2
command -v git >/dev/null 2>&1 || { echo "SKIP: guard-real needs git"; exit 3; }
command -v node >/dev/null 2>&1 || { echo "SKIP: guard-real needs node 22.7 or newer (no node)"; exit 3; }
if [ "$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=7)?1:0' 2>/dev/null)" != 1 ]; then
  echo "SKIP: guard-real needs node 22.7 or newer (node $(node -v 2>/dev/null))"; exit 3
fi
node tests/hooks/guard-real.mjs "$PWD"
