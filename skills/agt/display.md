# Display — what /agt prints

Presentation only: nothing here changes dispatch. If a line cannot be produced, drop it; never block the result. Solo prints only `solo · <why>`.

## Mid-run lines

The model writes only these, nothing else between dispatches:

```
recon: <mode> · <one-clause reason>   [agentille v<version>]
⚑ <agent> <blocked|REVISE|FAIL>: <one line>
```

`<version>` is the `version` in this plugin's `.claude-plugin/plugin.json`. One `⚑` line per real problem, when it happens.

## Progress spine

Before the first dispatch, seed TodoWrite with one todo per phase the roster actually has (e.g. plan · build · review · ship). Mark each in progress, then done, as it moves. That is the whole live view you write. With the mod loaded, a band above the prompt also shows every working agent and pane worker; you do nothing for it.

## Agent heads

Every agent's output starts with a head; relay the head, never the body:

- reviewers: `VERDICT: PASS|CONCERNS|FAIL · P0:n P1:n P2:n`, then `FIX: <file:line> <one line>` per P0/P1
- plan-reviewer: `VERDICT: APPROVE|REVISE` · adversary: `BROKEN: n · HELD: n` · executor: `VERIFICATION:` block, or a `CONTEXT …` handoff line

## Final card

The only end-of-run output of a non-solo run, at most 8 lines:

```
✓ <what changed, one line>  ·  <N> files  ·  <branch or PR #n>  ·  <m>m
verify: <command> → <result>
review: <PASS | CONCERNS: n P1 | FAIL: n P0> — <agents run>
⚑ <only if something needs the user; max 2 lines>
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
## Agents         role · model · effort · elapsed, from ledger.json (skip the section if it is missing)
## Findings       every P0–P3: file:line, fix, status
## Verification   commands and exit codes
## Raw reports    links to agents/<role>-<n>.md (written by the mod); with mods off, each agent's head
```

Never copy agent bodies into it: the mod already saved them under `agents/`.
