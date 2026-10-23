---
name: agt
description: Personal AI coding orchestrator and software factory. One command, `/agt <task>`, detects the level (low, medium, heavy) and runs the cheapest crew that does the job well (planner, executors, reviewers, each on the right model), opens one reviewed PR per slice (merges on green only with `integration: auto`) or escalates, closes every pane it opened, and ends on one short card. `/agt next` builds the next backlog item. Activates ONLY when the user types `/agt`; model invocation is disabled.
argument-hint: [low|medium|heavy|next] "<task>"
disable-model-invocation: true
---

# agentille — /agt

One command. Do it yourself when it is small, fan out when it is not, merge or escalate, close everything you opened, end on one card.

## Levels

The first word may force a level; otherwise detect it. First match wins.

| # | Condition | Level · how |
|---|---|---|
| 1 | first word is `low`, `medium` or `heavy` | that level (the risk gate below still applies) |
| 2 | first word is `next` | factory loop: `factory.md` → "/agt next" |
| 3 | verb is `review` | low · subagent: reviewers in parallel, in the background |
| 4 | verb is `debug` | low · subagent: the executor's debug loop |
| 5 | ALL hold: one sentence, no architectural verb (refactor, design, architect, migrate, redesign, restructure), no list of deliverables, no auth/money/data words (`routing.md` → "Risk words": a login *form* is not auth) | low · solo |
| 6 | ≥2 file-disjoint slices AND (any slice is ≥~30 min of work, needs its own dev server, simulator or browser, or there are >3 slices) | heavy · panes in Herdr or tmux, else workflow (`workflow-mode.md`), else subagent waves |
| 7 | ≥2 file-disjoint slices, each small | medium · subagent |
| 8 | otherwise | Stage 2 classify (`routing.md`) |

- **low**: solo, or one executor plus the reviewers its diff needs. A forced `low` on a multi-slice task builds the slices one after another with one executor.
- **medium**: planner, then up to 3 executor subagents at once (each in its own worktree), then the review fan-out.
- **heavy**: planner, then one pane per slice through `spawn_pane` (`panes-mode.md`); planners and reviewers stay subagents; serial merge. A task that asks for Codex workers runs heavy (`panes-mode.md` → "Codex workers").
- **Risk gate:** auth, money or data work (`routing.md` → "Risk words") never runs solo, and runs the gauntlet when the repo has a test runner (`formations.md`). A screen merely named login or checkout is `risk=none`.
- `--fable` is the only flag (`routing.md` → "Escalation ladder"). Old flags still work but are never suggested: `--mode solo|subagent|panes|herdr` = low|medium|heavy|heavy, `--plan` = stop after the plan review ("go" resumes it), `--formation <f>` = that formation.

Print the recon line before anything else: `recon: <level> · <solo|subagent|panes|workflow> · <one-clause reason>` (`display.md` → "Mid-run lines").

## The contract

1. **Profile.** Read `~/.agentille/profile.json`. Missing or unreadable → defaults (`deliveryStyle: direct`, `tone: peer-to-peer`, `preTaskQuestioning: ambiguous-only`, `thinkingDepth: complex-only`); never stop. With no voice keys (`name`, `role`, `deliveryStyle`, `tone`, `preTaskQuestioning`, `neverDo`) and no `~/.agentille/state/.tip-shown`, print `tip: /agentille-init makes agents sound like you` once and create that marker, unless the mod draws (`display.md`).
2. **Level.** Resolve it with "Levels" and print the recon line.
3. **Solo steps aside.** Do the task yourself: no run dir, no agents, no card. A solo bug follows the executor's loop: reproduce with the real command and quote the failing line, one hypothesis ("X because Y"), the smallest change, re-run. Three misses → stop, name the assumption that may be wrong, and say so; never a fourth blind fix (the executor's own rule, `agents/agentille-executor.md` → "Debugging"; or type `/agt debug` for the full loop).
4. **Clarify only when genuinely ambiguous** (never with `preTaskQuestioning: never`; up front with `always`). Explore first; ask at most 3 questions, each with a recommended default.
5. **Roster, formation, models** → `routing.md`. Start every dispatch with the header below, plus the profile prefix unless every value is a default.
6. **Run dir.** Create `~/.agentille/state/run-<id>/` and keep it. When a planner ran, write its CONTEXT-PACK to `context-pack.md` there and give each executor only its slice plus `checkpoint: ~/.agentille/state/run-<id>/checkpoint-<name>.md`.
7. **Scout, plan, then review it.** Scouts are optional, medium and heavy only: when the task names no files and the planner would have to map unfamiliar ground in ≥3 areas, first send ≤3 `Explore` subagents with `model: haiku` as one message of background calls, one question each ("which files wire X?"), each answering in ≤15 lines of paths and facts, and hand the answers to the planner under `SCOUTS:`. The plan carries numbered ACCEPTANCE criteria. REVISE → re-plan → review again; a second REVISE → re-plan once more and go on.
8. **Build, then review**, in dependency order, pipelined: review each finished piece while the others build. Every reviewer a piece needs goes out in ONE message as parallel background `Agent` calls. Fix rounds resume the same executor (`factory.md` → "Fix rounds").
9. **Gate and integrate.** P0/P1 block. Then the escalate checklist decides merge or ⚑ (`factory.md` → "Gate" and "Integrate").
10. **Close everything.** Close each `agt-<run>-*` pane the moment its answer is harvested, then confirm the run lists zero panes (`panes-mode.md` → "Harvest, then close"). Stop every background subagent once its handoff is used.
11. **Report, then the card.** Write `report.md` once, never print it, then print the final card (`display.md`). That card is the only end-of-run output.

## Dispatch header

Every `agentille:agentille-*` dispatch prompt starts with one line:

`[agt run=<id> size=<small|large> risk=<none|auth|money|data> mode=<build|fix|diagnose|review|research> fable=<auto|forced> formation=<none|duel|gauntlet|relay> piece=<slug>]`

- `size=large`: plan ≥6 steps or a shared contract, or a diff with logic in >1 file, >~150 LoC, or a public API/schema change.
- `risk`: `routing.md` → "Risk words" (sessions, tokens, guards → `auth`; payments, webhooks → `money`; migrations → `data`; a form or page with no such logic → `none`).
- `mode=fix` on every fix round, including a resumed executor's message; `diagnose` for the read-only root-cause planner.
- `fable=forced` only when the user typed `--fable`.
- `piece=<slug>` (lowercase, ≤24 chars) names the slice: its executor, adversary and reviewers share it. Omit it for planning roles and single-piece runs.

With the mod loaded it routes model + effort from this line. Still pass `model:` every time: the skill must work with mods off.

Profile prefix (skip it when every value is a default and `neverDo` is empty):

```
User: <name> (<role>). Avoid: <neverDo, verbatim>.
Communicate: <deliveryStyle>, <tone>.
```

## Hard rules

- **Honor `neverDo`.** Absolute; pass it verbatim into every dispatch.
- **Review gate: P0/P1 block; P2/P3 advisory.** Fix every P0/P1 and confirm the fix. If it cannot or should not be fixed, put it on the card's `⚑` line; never call it shipped.
- **Never commit to `main` directly.** Work lands through a branch and a PR or a local merge (`factory.md` → "Integrate").
- **Never let an agent push through context pressure.** An executor that reports `CONTEXT …` is replaced by a fresh one seeded from its checkpoint and slice.
- **At most 3 executors at once.** Batch the rest in waves.
- **Executor is never Haiku**; Haiku only classifies and scouts (read-only). Fable comes only from the ladder or `--fable`.
- **Foreground when it gates.** A dispatch whose result feeds the next step runs in the foreground; independent dispatches go out as one message of background calls, then one wait.
- **Mods off still works.** The mod only adds the band, routing, the wire between panes and the automatic pane cleanup.
- **Never close a pane you did not open.** The `agt-` prefix is ownership.
