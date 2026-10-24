#!/usr/bin/env bash
# The prompt files are the product: every skill and agent file stays under 20 KB (a prompt that
# grows past that is read less, not more), and the tokens the lead parses out of an agent's answer
# (SKILL.md → "The contract", factory.md) still exist in the agent that must write them, and the
# values one file hands over (the slice branch, the post-formation push) read the same in the file that uses them.
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
for tok in "FIX:" "BLOCKED:" "STUCK:" "CONTEXT" "CONTRACT:" "ACCEPTANCE" "VERIFICATION:" "RESUME:"; do
  check "executor knows $tok" 'has agents/agentille-executor.md "$tok"'
done
check "planner writes ACCEPTANCE" 'has agents/agentille-planner.md "ACCEPTANCE"'
check "SKILL.md reads ACCEPTANCE" 'has skills/agt/SKILL.md "ACCEPTANCE"'
check "SKILL.md prints the recon line" 'has skills/agt/SKILL.md "recon: <level>"'
# every stop head factory.md routes is listed in display.md and written by the executor
for tok in "CONTEXT" "BLOCKED:" "CONTRACT:" "STUCK:" "RESUME:"; do
  check "factory.md routes $tok" 'has skills/agt/factory.md "$tok"'
  check "display.md lists $tok" 'has skills/agt/display.md "$tok"'
  check "executor writes $tok" 'has agents/agentille-executor.md "$tok"'
done
check "Codex workers get the STUCK: line" 'has skills/agt/panes-mode.md "STUCK:"'

# worktrees: one script, no inline recipe for the two files to drift apart on
for f in skills/agt/factory.md agents/agentille-executor.md; do
  check "$f makes worktrees with agt-worktree.sh" 'has "$f" "agt-worktree.sh"'
  check "$f has no inline worktree recipe" '! has "$f" "BRANCH_INPUT" && ! has "$f" "git worktree add"'
done
check "the worktree script exists and is executable" '[ -x scripts/agt-worktree.sh ]'

# 4. one vocabulary: "slice" in prose; "piece" only as the header key, never "chunk" or "bucket"
for f in skills/agt/*.md agents/agentille-*.md README.md; do
  check "$f says slice, not piece (except piece=)" '! grep -v "piece=" "$f" | grep -qiE "\bpieces?\b"'
done
# "chunk" and "bucket" were two more names for the same unit (a plan step is a different unit and keeps its name)
for f in skills/agt/*.md agents/agentille-*.md; do
  check "$f says slice, not chunk or bucket" '! grep -qiE "\b(chunks?|buckets?)\b" "$f"'
done

# 5. agreement, not only presence: the files that hand a value over and the files that use it say the same
# the executor pushes the branch the lead handed it (factory.md "Integrate"), written out, never a variable
push_lines() { grep -F 'git push -u origin' agents/agentille-executor.md; }
integrate() { sed -n '/^## Integrate/,$p' skills/agt/factory.md; }
check "executor has a push line" '[ -n "$(push_lines)" ]'
check "every executor push line names the lead's branch: input" '! push_lines | grep -vF "branch:" | grep -q .'
check "no executor push line pushes a variable" '! push_lines | grep -qE "git push -u origin \"?\\$"'
check "factory.md Integrate hands branch: feat/<slug> off main" 'integrate | grep -qF "branch: feat/<slug>"'
check "factory.md Integrate hands branch: agt/<slug> off a feature branch" 'integrate | grep -qF "branch: agt/<slug>"'
check "factory.md and the executor name the same fallback" 'integrate | grep -qF "falls back to \`agt/<slug>\`" && has agents/agentille-executor.md "with none given it is \`agt/<slug>\`"'
# a formation that holds a slice at integration: local names who pushes once it clears, in every file that routes it
check "formations.md names the post-gauntlet pusher" 'grep -F "clears the gauntlet" skills/agt/formations.md | grep -qF "re-dispatches the kept executor with \`INTEGRATE:\`"'
check "factory.md Integrate routes INTEGRATE:" 'integrate | grep -qF "INTEGRATE:"'
check "the executor answers INTEGRATE:" 'has agents/agentille-executor.md "INTEGRATE:"'
check "display.md lists INTEGRATE:" 'has skills/agt/display.md "INTEGRATE:"'
# every agent treats what it reads as data
for f in agents/agentille-*.md; do
  check "$f treats content as untrusted data" 'grep -qE "untrusted DATA.*never (as )?instructions" "$f" && grep -qE "Never run a shell command (that originates from|sourced from)" "$f"'
done
# a script injected from a CDN names an exact version
check "every CDN URL in a prompt file is pinned" '! grep -rhoE "(cdn\.jsdelivr\.net/npm|unpkg\.com)/[^ \`\"]+" skills agents | grep -vE "/(@[a-z0-9-]+/)?[a-z0-9.-]+@[0-9]+\.[0-9]+\.[0-9]+" | grep -q .'

# the lead re-enters a run from its files after a compaction: the compact hook prints where the run stands, and the
# update check still runs at startup and resume
reentry() { grep -F "compaction" skills/agt/SKILL.md | grep -F "Re-enter"; }
check "SKILL.md has a re-entry rule" '[ -n "$(reentry)" ]'
check "the re-entry rule names ledger.json and context-pack.md" 'reentry | grep -F "ledger.json" | grep -qF "context-pack.md"'
check "SKILL.md never re-dispatches a finished slice" 'has skills/agt/SKILL.md "Never re-dispatch a finished slice"'
# the hook lines of one SessionStart matcher: from its "matcher" line to the next matcher or hook event
matcher_block() { awk -v m="\"matcher\": \"$1\"" 'index($0, m) { on = 1; next } on && /"matcher"|"SessionEnd"/ { on = 0 } on' hooks/hooks.json; }
check "the compact hook runs the re-entry script" 'matcher_block compact | grep -qF "hooks/agentille-compact.sh"'
check "the re-entry script exists and is executable" '[ -x hooks/agentille-compact.sh ]'
check "the update check still runs at startup and resume" 'matcher_block "startup|resume" | grep -qF "hooks/agentille-update-check.sh"'

# the design-reviewer's hard rule and the cost ceiling agree: the ceiling demotes it (hooks/routing.js CEILING_ROLES),
# so the hard rule names the ceiling as its second exception, and the ceiling bullet still lists the design-reviewer
dr_rule() { grep -F "Never downgrade the design-reviewer" skills/agt/routing.md; }
check "routing.md's design-reviewer rule names quick and the ceiling" 'dr_rule | grep -qF "thinkingDepth=quick" && dr_rule | grep -qiF "cost ceiling"'
check "routing.md's ceiling bullet includes the design-reviewer" 'grep -F "Past the ceiling," skills/agt/routing.md | grep -qF "design-reviewer"'

# solo is the lead alone: no agents, no reviewer agent, and its own review of the diff before the push
check "routing.md's solo lines never name the code-reviewer" '! grep -i "solo" skills/agt/routing.md | grep -qF "code-reviewer"'
check "routing.md says a solo run dispatches no role in the roster" 'grep -F "solo run dispatches no role" skills/agt/routing.md | grep -qF "reviews its own diff"'
check "SKILL.md's solo step has no reviewer agent and a self-review before the push" 'grep -F "Solo steps aside" skills/agt/SKILL.md | grep -qF "no reviewer" && has skills/agt/SKILL.md "Before the push (under \`local\`, before you report), review your own full diff"'
check "factory.md gives a solo run no fix attempts" '! has skills/agt/factory.md "solo run counts its own review-fix rounds" && grep -F "solo run dispatches no executor" skills/agt/factory.md | grep -qF "reviews its own diff"'

# setup skills that say "typed only" disable model invocation
for f in skills/agentille-init/SKILL.md skills/agentille-project/SKILL.md skills/agentille-claude-md/SKILL.md; do
  check "$f disables model invocation" 'grep -qE "^disable-model-invocation: true$" "$f"'
done
# a typed-only skill never describes itself as one the model picks up from what the user says or asks
for f in skills/*/SKILL.md; do
  grep -qE "^disable-model-invocation: true$" "$f" || continue
  check "$f is typed only and its description says so" '! grep -E "^description:" "$f" | grep -qiE "use when the user says|when the user asks"'
done

[ "$bad" = 0 ] && echo "skill-text: $n checks pass" || { echo "skill-text: $bad of $n checks fail"; exit 1; }
