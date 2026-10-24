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
# the plan-review skip reads the same where the plan review is described (SKILL.md step 7) and in the roster
plan_skip() { grep -F "$2" "$1" | grep -F "plan-reviewer" | grep -qF "thinkingDepth=quick"; }
for f in skills/agt/SKILL.md skills/agt/routing.md; do
  check "$f skips the plan-reviewer on quick and for a ≤3-step fully sequential plan" 'plan_skip "$f" "for a ≤3-step fully sequential plan"'
done
# every stop head factory.md routes is listed in display.md and written by the executor
for tok in "CONTEXT" "BLOCKED:" "CONTRACT:" "STUCK:" "RESUME:"; do
  check "factory.md routes $tok" 'has skills/agt/factory.md "$tok"'
  check "display.md lists $tok" 'has skills/agt/display.md "$tok"'
  check "executor writes $tok" 'has agents/agentille-executor.md "$tok"'
done
check "Codex workers get the STUCK: line" 'has skills/agt/transport-panes.md "STUCK:"'
# fix rounds and early stops are counted in one table in factory.md: every stop head and lead message has its row
fixtable() { sed -n '/^## Fix rounds/,/^## Early stop/p' skills/agt/factory.md | grep '^|'; }
check "factory.md counts fix attempts in one table" 'fixtable | grep -qF "| Event | Fix attempt? | What happens next | The card shows |"'
for tok in "CONTEXT" "BLOCKED:" "STUCK:" "CONTRACT:" "RESUME:" "INTEGRATE:"; do
  check "factory.md's fix table has a row for $tok" 'fixtable | grep -qF "$tok"'
done
check "factory.md's fix table: an early stop is no fix attempt" 'fixtable | grep -F "| Early stop" | grep -qF "| no"'
check "factory.md's fix table: the limit is 2 per slice" 'sed -n "/^## Fix rounds/,/^## Early stop/p" skills/agt/factory.md | grep -qF "Limit: 2 per slice."'

# the "without the mod" branches live in one appendix, and each main file points there instead of forking
check "no-mod.md holds the squad scoring" 'has skills/agt/no-mod.md "signals.deps"'
check "no-mod.md holds the progress spine" 'has skills/agt/no-mod.md "seed TodoWrite"'
check "no-mod.md holds the manual Herdr spawn" 'has skills/agt/no-mod.md "herdr pane split"'
check "no-mod.md holds the manual tmux spawn" 'has skills/agt/no-mod.md "tmux split-window"'
check "squads.md points at no-mod.md and no longer counts squad signals" 'has skills/agt/squads.md "no-mod.md" && ! has skills/agt/squads.md "signals.deps"'
check "display.md points at no-mod.md and no longer seeds TodoWrite" 'has skills/agt/display.md "no-mod.md" && ! has skills/agt/display.md "seed TodoWrite"'
check "transport-panes.md points at no-mod.md and carries no manual spawn" 'has skills/agt/transport-panes.md "no-mod.md" && ! has skills/agt/transport-panes.md "herdr pane split" && ! has skills/agt/transport-panes.md "tmux split-window -d"'
check "SKILL.md names no-mod.md in its hard rules" 'grep -F "Mods off still works" skills/agt/SKILL.md | grep -qF "no-mod.md"'

# every coined term the prompt files use is defined in SKILL.md's Words section, in one bolded entry
words() { awk '/^## Words/ { on = 1; next } on && /^## / { on = 0 } on' skills/agt/SKILL.md; }
for t in mod band wire card formation squad gauntlet ladder harvest B0 ⚑ slice level transport recon; do
  check "SKILL.md's Words section defines $t" 'words | grep -qiE "\*\*(the )?$t[^*]*:\*\*"'
done

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
# every output field an agent's prose sends something "under" exists in that agent's own output template
fenced() { awk '/^ *```/ { on = !on; next } on' "$1"; }
under_fields() { grep -oE "under \`?[A-Z][A-Z]+" "$1" | sed -E 's/^under `?//' | sort -u; }
for f in agents/agentille-*.md; do
  for fld in $(under_fields "$f"); do
    check "$f's template has the $fld field its prose names" 'fenced "$f" | grep -qE "^ *(- )?$fld( \(if any\))?:"'
  done
done
check "the adversary's prose names a template field (NOTES)" '[ -n "$(under_fields agents/agentille-adversary.md)" ]'
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
# every hard rule carries its reason: the lead's in parentheses right after the bold rule, the executor's in its line
rules_of() { awk '/^## Hard rules/ { on = 1; next } on && /^## / { on = 0 } on && /^- /' "$1"; }
check "SKILL.md has hard rules" '[ "$(rules_of skills/agt/SKILL.md | wc -l)" -ge 10 ]'
check "every SKILL.md hard rule gives its reason" '! rules_of skills/agt/SKILL.md | grep -vqE "^- \*\*[^*]+\*\* \("'
check "every executor hard rule gives its reason" '[ -n "$(rules_of agents/agentille-executor.md)" ] && ! rules_of agents/agentille-executor.md | grep -vqF " ("'
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

# the init skill's `display` row says what hooks/settings.js defaults to: every key, and each key's default, in order
# (the Default cell is DISPLAY_DEFAULTS with the quotes dropped), so the table cannot drift from the code again
display_defaults() { sed -n 's/^export const DISPLAY_DEFAULTS = \({.*}\)$/\1/p' hooks/settings.js | tr -d "'" | sed 's/^{ /{/; s/ }$/}/'; }
init_display_row() { grep -E '^\| `display` \|' skills/agentille-init/SKILL.md; }
init_display_values() { init_display_row | sed 's/^| `display` | `\([^`]*\)`.*/\1/'; }
check "hooks/settings.js declares DISPLAY_DEFAULTS on one line" '[ -n "$(display_defaults)" ]'
check "the init skill's display default is hooks/settings.js's DISPLAY_DEFAULTS" '[ "$(init_display_row | awk -F"|" "{ print \$(NF-1) }" | sed "s/^ *\`//; s/\` *$//")" = "$(display_defaults)" ]'
for k in $(display_defaults | tr -d '{}' | tr ',' '\n' | sed 's/:.*//; s/ //g'); do
  check "the init skill's display row lists the values $k takes" 'init_display_values | grep -qE "[{ ]$k: [^,}]+[,}]"'
done

# every display switch, and the top-level sessions key, is a row of settings.md's switch table and named in the README's switch sentence
readme_switches() { grep -F "off switch in the profile's \`display\` block" README.md; }
check "README.md has its display switch sentence" '[ -n "$(readme_switches)" ]'
for k in $(display_defaults | tr -d '{}' | tr ',' '\n' | sed 's/:.*//; s/ //g') sessions; do
  check "docs/settings.md's switch table has a $k row" 'grep -qF "| \`$k\` " docs/settings.md'
  check "README.md's switch sentence names $k" 'readme_switches | grep -qF "\`$k\`"'
done

# the dispatch header's work type is spelled work= everywhere an agent reads it; mode= lives only in SKILL.md's
# alias note and deprecation line and in commands.md's deprecated rows
check "no prompt file emits mode= (SKILL.md keeps the alias note only)" '! grep -l "mode=" skills/agt/*.md agents/*.md | grep -qv "skills/agt/SKILL.md"'
check "SKILL.md names mode= only as the alias or the deprecation" '! grep "mode=" skills/agt/SKILL.md | grep -vqE "work=|deprecated"'
# every work= value the prose dispatches has an output head in the agent file that receives it
check "the planner defines the diagnose head factory.md dispatches" 'has skills/agt/factory.md "work=diagnose" && has agents/agentille-planner.md "ROOT CAUSE:" && has agents/agentille-planner.md "FIX PLAN:" && has skills/agt/display.md "ROOT CAUSE:"'
check "the planner defines the research head routing.md names" 'has agents/agentille-planner.md "CONTEXT-PACK:" && has skills/agt/display.md "CONTEXT-PACK:"'

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
