---
name: agt
description: Multi-agent coding orchestrator. `/agt <task>` detects the level (low, medium, heavy), runs the cheapest crew that does the job (planner, executors, reviewers, each on the right model), opens one reviewed PR per slice (merging on green only with `integration: auto`) or escalates, closes every pane it opened, and ends on one card. `/agt next` builds the next backlog item. Typed only.
argument-hint: [low|medium|heavy|next] "<task>"
disable-model-invocation: true
---

# agentille — /agt

One command. Do it yourself when it is small, fan out when it is not, merge or escalate, close everything you opened, end on one card.

## Words

- **The lead:** you, the session that runs `/agt`. The agents and panes you dispatch are workers.
- **Slice:** one file-disjoint part of the task, built by one executor on its own branch and worktree.
- **The mod:** agentille's code that runs inside Claude Code. It routes models, draws the live views, carries messages between panes and closes finished panes. `/agt` works without it.
- **Band:** the mod's live status block above the prompt: one row per agent of the run, and `⚑` flags.
- **Wire:** the mod's messages between panes. A pane worker that finishes sends its result to the lead as a message.
- **Card:** the run's final summary, at most 8 lines (`display.md` → "Final card").
- **Formation:** an optional run shape that changes how workers relate: gauntlet, duel or relay (`formations.md`).
- **Squad:** a group of extra specialist reviewers that joins when the repo matches its signals (`squads.md`).

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
- **heavy**: planner, then one pane per slice through `spawn_pane` (`panes-mode.md`), at most 3 at once like medium. Planners and reviewers stay subagents. Slices merge one at a time.
  Heavy differs from medium by panes, not by width: a real session per slice in its own worktree, the live wire, and resume. A task that asks for Codex workers runs heavy (`panes-mode.md` → "Codex workers").
- **Risk gate:** auth, money or data work (`routing.md` → "Risk words") never runs solo, and runs the gauntlet when the repo has a test runner (`formations.md`). A screen merely named login or checkout is `risk=none`.
- Two flags: `--fable` (`routing.md` → "Escalation ladder") and `--local`, which runs this one /agt as `integration: local` whatever the profile says, `projects[]` entries included: merge locally, push nothing, open no PR. The mod holds it for you and your subagents; say it in each pane worker's task. Older flags still work: "Deprecated" at the end.

Print the recon line before anything else: `recon: <level> · <transport> · <one-clause reason>`, where transport is `solo`, `subagent`, `panes` or `workflow` (`display.md` → "Mid-run lines").

## The contract

1. **Profile.** Read `~/.agentille/profile.json`. Missing or unreadable → defaults (`deliveryStyle: direct`, `tone: peer-to-peer`, `preTaskQuestioning: ambiguous-only`, `thinkingDepth: complex-only`); never stop.
   With no voice keys (`name`, `role`, `deliveryStyle`, `tone`, `preTaskQuestioning`, `neverDo`) and no `~/.agentille/state/.tip-shown`, print `tip: /agentille-init makes agents sound like you` once and create that marker, unless the mod draws (`display.md`).
2. **Level.** Resolve it with "Levels" and print the recon line.
3. **Solo steps aside.** Do the task yourself: no run dir, no agents (no reviewer either), no card.
   Before the push (under `local`, before you report), review your own full diff once: it does what the task asked, nothing outside it changed, and the check you ran (build, test or the real command) passed. Fix what you find in place and re-run that check.
   The fix lands on a new `fix/<slug>` branch, or `agt/<slug>` when the current branch is a feature branch. It lands on the current branch only when the person's typed words name it, and never on main. Under `pr` it opens a PR; every other mode works as `factory.md` → "Integrate" says.
   A solo bug follows the executor's loop: reproduce with the real command and quote the failing line, form one hypothesis ("X because Y"), make the smallest change, re-run.
   Three misses → stop, name the assumption that may be wrong, and say so. Never try a fourth blind fix. This is the executor's own rule (`agents/agentille-executor.md` → "Debugging"); `/agt debug` runs the full loop.
4. **Clarify only when genuinely ambiguous** (never with `preTaskQuestioning: never`; up front with `always`). Explore first; ask at most 3 questions, each with a recommended default.
5. **Roster, formation, models** → `routing.md`. Start every dispatch with the header below, plus the profile prefix unless every value is a default.
6. **Run dir.** Create `~/.agentille/state/run-<id>/` and keep it. When a planner ran, write its CONTEXT-PACK to `context-pack.md` there.
   Give each executor only its slice plus `checkpoint: ~/.agentille/state/run-<id>/checkpoint-<name>.md`.
7. **Scout, plan, then review it.**
   - Scouts are optional, on medium and heavy only. Send them when the task names no files and the planner would have to map unfamiliar ground in ≥3 areas.
   - Send at most 3 `Explore` subagents with `model: haiku`, as one message of background calls. Each gets one question ("which files wire X?") and answers in ≤15 lines of paths and facts. Hand their answers to the planner under `SCOUTS:`.
   - The plan carries numbered ACCEPTANCE criteria. APPROVE → build.
   - A first REVISE → re-plan, then review again.
   - A second REVISE → re-plan once more. Send that third plan to the plan-reviewer one last time on Opus: one call, with `size=large` in its header (so the mod routes it to Opus) and `model: opus`.
   - A third REVISE stops the run before any build. The card's first line is `✗ plan not approved after 3 reviews`. Its `⚑` line is `⚑ plan not approved: <reason 1> · <reason 2> · <reason 3>`, one clause per REVISE.
   - Never build a plan the last review did not approve.
8. **Build, then review**, in dependency order, pipelined: review each finished slice while the others build. Every reviewer a slice needs goes out in ONE message as parallel background `Agent` calls. Fix rounds resume the same executor (`factory.md` → "Fix rounds").
9. **Gate and integrate.** P0/P1 block. Then the escalate checklist decides merge or ⚑ (`factory.md` → "Gate" and "Integrate"). The profile sets `integration`, and a repo can only lower it. Remove each slice's worktree once the gate decides (`factory.md` → "Worktree lifecycle").
10. **Close everything.** Close each `agt-<run>-*` pane the moment its answer is harvested, then confirm the run lists zero panes (`panes-mode.md` → "Harvest, then close"). Stop every background subagent once its handoff is used.
11. **Report, then the card.** Write `report.md` once, never print it, then print the final card (`display.md`). That card is the only end-of-run output.

## Dispatch header

Every `agentille:agentille-*` dispatch prompt starts with one line:

`[agt run=<id> size=<small|large> risk=<none|auth|money|data> mode=<build|fix|diagnose|review|research> fable=<auto|forced> formation=<none|duel|gauntlet|relay> slice=<slug>]`

- `size=large`: plan ≥6 steps or a shared contract, a third plan's review, or a diff with logic in >1 file, >~150 LoC, or a public API/schema change.
- `risk`: `routing.md` → "Risk words" (sessions, tokens, guards → `auth`; payments, webhooks → `money`; migrations → `data`; a form or page with no such logic → `none`).
- `mode=fix` on every fix round, including a `SendMessage` to the kept executor (a `RESUME:` after an early stop stays `mode=build`); `diagnose` for the read-only root-cause planner.
- `fable=forced` only when the user typed `--fable`.
- `slice=<slug>` (lowercase, ≤24 chars) names the slice: its executor, adversary and reviewers share it. Omit it for planning roles and single-slice runs.

With the mod loaded it routes model + effort from this line. Still pass `model:` every time: the skill must work with mods off.

Profile prefix (skip it when every value is a default and `neverDo` is empty; add the third line only when `preTaskQuestioning` or `thinkingDepth` is not its default, with both values):

```
User: <name> (<role>). Avoid: <neverDo, verbatim>.
Communicate: <deliveryStyle>, <tone>.
Ask: <preTaskQuestioning>. Depth: <thinkingDepth>.
```

## Hard rules

- **Honor `neverDo`.** Absolute; pass it verbatim into every dispatch.
- **Review gate: P0/P1 block; P2/P3 advisory.** Fix every P0/P1 and confirm the fix. If it cannot or should not be fixed, put it on the card's `⚑` line; never call it shipped.
- **Never commit to `main` directly.** Work lands through a branch and a PR or a local merge (`factory.md` → "Integrate").
- **Never let an agent push through context pressure.** An executor that reports `CONTEXT …` is replaced by a fresh one seeded from its checkpoint and slice.
- **At most 3 executors at once.** Batch the rest in waves; the mod flags a fourth on the band and in `routing.jsonl` but does not block it.
- **Executor is never Haiku**; Haiku only classifies and scouts (read-only). Fable comes only from the ladder or `--fable`.
- **Foreground when it gates.** A dispatch whose result feeds the next step runs in the foreground; independent dispatches go out as one message of background calls, then one wait.
- **Mods off still works.** The mod only adds the band, routing, the wire between panes and the automatic pane cleanup.
- **Never close a pane you did not open.** The `agt-` prefix is ownership.
- **Re-enter from the files, not from memory.** Do it after a compaction or a `/clear`, and whenever you cannot name the current slice and its state. Before the next dispatch, re-read the sections you need of this file, `routing.md` and `factory.md`. Then read `run-<id>/context-pack.md`, the mod's `ledger.json` and `routing.jsonl` when present, and `git log $BASE..<branch>` for each slice branch still there.
  After a compaction the mod's hook prints an `[agt re-entry]` block with the run id and each slice's state from `ledger.json`: start from it, then read the files above.
- **Never re-dispatch a finished slice.** A slice is done when its branch has a PR (`gh pr list --head <branch> --state all`) or is merged into `$BASE`. A deleted branch whose merge is in `git log $BASE` counts as merged. A slice whose executor report under `run-<id>/agents/` carries `VERIFICATION:` is built: it goes to review, not to a new executor.

## Deprecated

Still honored when typed, never suggested:

- `--mode solo|subagent|panes|herdr` (= low|medium|heavy|heavy), `--plan` (stop after the plan review; "go" resumes it), `--formation <f>` (that formation). All three go away in v4.
