# Display — what /agt prints

Presentation only: nothing here changes dispatch. If a line cannot be produced, drop it; never block the result. Solo prints only its recon line.

## When the mod draws

The skill text then ends with a `## Drawing (agentille mod)` block. With it, the mod already shows these, so skip them:

- the `[agentille v<version>]` suffix on the recon line (the band header shows the version)
- the TodoWrite progress spine (the band shows the phases)
- the profile tip (the mod toasts it once)
- report.md's `## Agents` and `## Raw reports` sections (the mod appends them)

Without that block (mods off, the VS Code chat panel, `claude -p`), do all of them as written below.

## Mid-run lines

The model writes only these, nothing else between dispatches:

```
recon: <level> · <solo|subagent|panes|workflow> · <one-clause reason>   [agentille v<version>]
⚑ <agent> <blocked|REVISE|FAIL>: <one line>
```

`<version>` (skip it when the mod draws) is the `version` in the `.claude-plugin/plugin.json` beside this skill (the plugin root above its base directory), the one actually running: never a repo checkout's, which can differ. When you have the `advisor` tool, append ` · advisor` after the reason. One `⚑` line per real problem, when it happens.

## Progress spine

Skip this section when the mod draws. Otherwise, before the first dispatch, seed TodoWrite with one todo per phase the roster actually has (e.g. plan · build · review · ship). Mark each in progress, then done, as it moves. That is the whole live view you write. With the mod loaded, it draws the band instead and you do nothing.

## Agent heads

Every agent's output starts with a head; relay the head, never the body:

- reviewers: `VERDICT: PASS|CONCERNS|FAIL · P0:n P1:n P2:n`, then `FIX: <file:line> <one line>` per P0/P1
- planner: `PLAN: <n> steps · <p> parallel-safe · <w> waves` · ui-prototyper: `BLUEPRINT: <name> ready · <stack>`
- plan-reviewer: `VERDICT: APPROVE` or `VERDICT: REVISE · BLOCKER:n HIGH:n LOW:n`, then `FIX: <step> <one line>` per BLOCKER/HIGH
- adversary: `BROKEN: n · HELD: n`, then `FIX:` per broken case
- executor: `<what changed · files · verified yes/no>`, then `FIX:` per known remaining defect; or one stop line: `CONTEXT …`, `BLOCKED: <need>`, `STUCK: <the assumption that failed or the check that will not pass>`, `CONTRACT: <what and why>` (each routed in `factory.md` → "Fix rounds"). Its `VERIFICATION:` block is body evidence the gate reads, not the head.
  `RESUME:` is the lead's message to an executor that stopped early with none of these, and `INTEGRATE:` its message to the kept executor once a gauntlet clears or a duel picks it (`factory.md` → "Integrate"); it answers either with its normal head.

## Final card

The only end-of-run output of a non-solo run, at most 8 lines:

```
✓ <what changed, one line>  ·  <level>  ·  <N> files  ·  <merged PR #n | branch>  ·  <m>m
verify: <command> → <result>
review: <PASS | CONCERNS: n P1 | FAIL: n P0> — <agents run>
⚑ <only if something needs the user: escalated, PR ready, P0/P1 left, plan not approved, cost ceiling reached (`capped` lines in routing.jsonl); max 2 lines>
Open: ~/.agentille/state/run-<id>/report.md
Next: <one concrete action>
```

Failure form: the first line is `✗ <what failed + where>` and `Next:` is the fix. Keep `✓`/`✗` first and `Next:` last: the mod's highlight reads them. No other prose, fences, cost rows or token tables; formations add a clause to the `review:` line.

## report.md

Write `~/.agentille/state/run-<id>/report.md` once at the end with the Write tool. Never print it.

```
# /agt run <id> · <task> · <date>
## Result         the card's first three lines
## Plan           the planner's plan, if any
## Agents         role · model · effort · elapsed, from ledger.json (skip the section if it is missing, or when the mod draws)
## Findings       every P0–P3: file:line, fix, status
## Verification   commands and exit codes
## Raw reports    links to agents/<role>-<n>.md (written by the mod); with mods off, each agent's head (skip when the mod draws)
```

Never copy agent bodies into it: the mod already saved them under `agents/`.
