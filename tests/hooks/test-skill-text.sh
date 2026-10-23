#!/usr/bin/env bash
# The prompt files are the product: every skill and agent file stays under 20 KB (a prompt that
# grows past that is read less, not more), and the tokens the lead parses out of an agent's answer
# (SKILL.md → "The contract", factory.md) still exist in the agent that must write them.
# Exit 0 = all checks pass.
set -u
cd "$(dirname "$0")/../.." || exit 2
n=0; bad=0
check() { n=$((n+1)); if eval "$2"; then :; else echo "FAIL $1"; bad=$((bad+1)); fi; }
has() { grep -qF -- "$2" "$1"; }

# 1. size
for f in skills/*/SKILL.md skills/agt/*.md skills/storm/*.md agents/agentille-*.md; do
  size=$(wc -c < "$f" | tr -d ' ')
  check "$f is under 20 KB ($size bytes)" '[ "$size" -lt 20480 ]'
done

# 2. frontmatter: every agent names a model that is an alias, never a pinned id
for f in agents/agentille-*.md; do
  check "$f has a model alias" 'grep -qE "^model: (sonnet|opus|haiku)$" "$f"'
  check "$f is dispatched only by /agt" 'has "$f" "Dispatched only by /agt"'
done

# 3. the verdict tokens the lead reads
for f in agents/agentille-{code,design,perf,payments,seo,security}-reviewer.md; do
  check "$f writes VERDICT:" 'has "$f" "VERDICT:"'
  check "$f writes FIX: lines" 'has "$f" "FIX:"'
done
check "plan-reviewer answers APPROVE or REVISE" 'has agents/agentille-plan-reviewer.md "APPROVE" && has agents/agentille-plan-reviewer.md "REVISE"'
check "adversary answers BROKEN or HELD" 'has agents/agentille-adversary.md "BROKEN" && has agents/agentille-adversary.md "HELD"'
for tok in "FIX:" "BLOCKED:" "CONTEXT" "CONTRACT:" "ACCEPTANCE" "VERIFICATION:" "RESUME:"; do
  check "executor knows $tok" 'has agents/agentille-executor.md "$tok"'
done
check "planner writes ACCEPTANCE" 'has agents/agentille-planner.md "ACCEPTANCE"'
check "SKILL.md reads ACCEPTANCE" 'has skills/agt/SKILL.md "ACCEPTANCE"'
check "SKILL.md prints the recon line" 'has skills/agt/SKILL.md "recon: <level>"'
check "factory.md handles BLOCKED: and CONTEXT" 'has skills/agt/factory.md "BLOCKED:" && has skills/agt/factory.md "CONTEXT"'

# 4. one vocabulary: "slice" in prose; "piece" only as the header key
for f in skills/agt/*.md agents/agentille-*.md README.md; do
  check "$f says slice, not piece (except piece=)" '! grep -v "piece=" "$f" | grep -qiE "\bpieces?\b"'
done

[ "$bad" = 0 ] && echo "skill-text: $n checks pass" || { echo "skill-text: $bad of $n checks fail"; exit 1; }
