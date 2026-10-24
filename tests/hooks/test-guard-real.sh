#!/usr/bin/env bash
# The Bash guard against real git (tests/hooks/guard-real.mjs): a scratch repo with a bare origin, the real git
# binary for every probe, and the allowed lines run for real. The mod's test kit has no process of its own, so
# this half of the guard's tests runs under node. Exit 0 = all checks pass (or node/git missing: skipped).
set -u
cd "$(dirname "$0")/../.." || exit 2
command -v git >/dev/null 2>&1 || { echo "guard-real: skipped (no git)"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "guard-real: skipped (no node)"; exit 0; }
if [ "$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=7)?1:0' 2>/dev/null)" != 1 ]; then
  echo "guard-real: skipped (node < 22.7)"; exit 0
fi
node tests/hooks/guard-real.mjs "$PWD"
