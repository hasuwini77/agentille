#!/usr/bin/env bash
# Appends one line per completed agentille run to ./docs/agentille-log.md.
# Reads hook input as JSON on stdin per Claude Code hooks contract.
set -euo pipefail

LOG_DIR="docs"
LOG_FILE="${LOG_DIR}/agentille-log.md"

# Parse hook input (best-effort — fail silently so we don't block the run)
INPUT="$(cat || true)"
TASK_FIRST_LINE="$(echo "$INPUT" | head -n 1 | head -c 120)"

TODAY="$(date +%Y-%m-%d)"
RUN_START_TIME="${AGENTILLE_RUN_START_TIME:-$(date +%s)}"
NOW="$(date +%s)"
DURATION_MIN=$(( (NOW - RUN_START_TIME) / 60 ))

MODE="${AGENTILLE_MODE:-subagent}"
TEAM_NAME="${AGENTILLE_TEAM:-}"
TEAMMATE_COUNT="${AGENTILLE_TEAMMATE_COUNT:-1}"
VERB_PREFIX="${AGENTILLE_VERB:-task}"

if [[ -n "$TEAM_NAME" ]]; then
  META="${TEAM_NAME} (${TEAMMATE_COUNT} teammates · ${DURATION_MIN}m)"
else
  META="subagent · ${DURATION_MIN}m"
fi
ENTRY="- **${VERB_PREFIX}:** ${TASK_FIRST_LINE} — \`${META}\`"

# Optional sub-bullets driven by git/gh checks (objective only)
SUB_BULLETS=""
if command -v git >/dev/null 2>&1; then
  CHANGED_PATHS="$(git diff --name-only HEAD 2>/dev/null | head -n 5 | tr '\n' ' ' || true)"
  if [[ -n "$CHANGED_PATHS" ]]; then
    SUB_BULLETS+=$'\n  - Files: '"${CHANGED_PATHS}"
  fi
fi
if command -v gh >/dev/null 2>&1; then
  PR_NUM="$(gh pr view --json number --jq .number 2>/dev/null || true)"
  if [[ -n "$PR_NUM" ]]; then
    SUB_BULLETS+=$'\n  - PR: #'"${PR_NUM}"
  fi
fi

mkdir -p "$LOG_DIR"

if [[ ! -f "$LOG_FILE" ]]; then
  {
    echo "# Agentille Log"
    echo ""
    echo "## ${TODAY}"
    echo ""
    echo "${ENTRY}${SUB_BULLETS}"
  } >> "$LOG_FILE"
else
  LAST_HEADING="$(grep -E '^## [0-9]{4}-' "$LOG_FILE" | tail -n 1 | sed 's/^## //')"
  if [[ "$LAST_HEADING" == "$TODAY" ]]; then
    echo "${ENTRY}${SUB_BULLETS}" >> "$LOG_FILE"
  else
    {
      echo ""
      echo "## ${TODAY}"
      echo ""
      echo "${ENTRY}${SUB_BULLETS}"
    } >> "$LOG_FILE"
  fi
fi

exit 0
