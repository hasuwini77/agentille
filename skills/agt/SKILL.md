---
name: agt
description: Personal AI coding orchestrator. Classifies one task and runs the right roster of agentille agents (planner, executor, reviewers) with the right model per role, then ends on one short result card. Works with zero setup. Activates ONLY when the user types `/agt <task>`; model invocation is disabled.
argument-hint: [--plan] [--mode panes|subagent|solo] [--fable] "<task>"
disable-model-invocation: true
---

# agentille — /agt

Turn one prompt into the cheapest run that does the job well: do it yourself when it is small, dispatch agents when it is not, and end on one card.

## The contract

1. **Profile.** Read `~/.agentille/profile.json`. Missing or unreadable → use the defaults (`deliveryStyle: direct`, `tone: peer-to-peer`, `preTaskQuestioning: ambiguous-only`, `thinkingDepth: complex-only`) and never stop. With no profile and no `~/.agentille/state/.tip-shown`, print `tip: /agentille-init makes agents sound like you` once, then create that marker (Write tool, empty).
2. **Mode.** Resolve it with "Modes" below and print the recon line (`display.md` → "Mid-run lines").
3. **Solo steps aside.** Print `solo · <why>` and do the task yourself: no run dir, no agents, no report, no card.
4. **Clarify only when genuinely ambiguous** (never with `preTaskQuestioning: never`; up front with `always`). Explore the repo first; ask at most 3 questions, each with a recommended default. UI viewports default to `profile.viewports` when set, else desktop + mobile, without asking.
5. **Roster, formation, models** → `routing.md`. Start every dispatch with the header below, plus the profile prefix unless every value is a default.
6. **Run dir.** Create `~/.agentille/state/run-<id>/` and keep it (never delete it). When a planner ran, write its CONTEXT-PACK to `context-pack.md` there and give each executor only its slice plus `checkpoint: ~/.agentille/state/run-<id>/checkpoint-<name>.md`.
7. **Plan, then review it.** REVISE → re-plan → review again. A second REVISE → re-plan once more (the mod picks Opus max or Fable) and go on without a third review.
8. **Build, then review**, in dependency order. Pipeline it: review each finished piece while the others still build. Apply the review gate (Hard rules).
9. **Tear down.** Harvest each `agt-<run>-*` pane worker's output, `close_pane` it, then confirm the run id lists zero panes (`panes-mode.md` → "The lifecycle state machine — harvest, then reap"). Stop any named background subagent once its handoff is used.
10. **Report, then the card.** Write the run report once (`display.md` → "report.md"), never print it, then print the final card (`display.md` → "Final card"). That card is the only end-of-run output.

## Modes

First match wins.

| # | Condition | Mode |
|---|---|---|
| 1 | `--team <x>` or `--mode team` | print `teams were removed in v3.0 — running as panes/subagent`, then resolve from row 3 as if no flag was typed |
| 2 | `--mode <m>` (`panes`, `subagent`, `solo`; `herdr` = `panes`) | `<m>` |
| 3 | ALL hold: no architectural verb (refactor, design, architect, migrate, redesign, restructure), a one-sentence task, no list of deliverables, no auth/money/data words | **solo** |
| 4 | verb is `review` | **subagent**: reviewers in parallel, in the background |
| 5 | verb is `debug` | **subagent**: the executor's debug loop |
| 6 | ≥2 genuinely disjoint slices that can build at the same time | **panes** inside Herdr or tmux, else **workflow** when the `Workflow` tool exists (`workflow-mode.md`), else subagent waves |
| 7 | otherwise | Stage 2 classify (`routing.md` → "Stage 2 classify") |

**Pane rule.** Panes open only for ≥2 disjoint slices, `--mode panes` or `/agt-spawn`. Then each slice's executor (and the adversary) opens through `spawn_pane` with `agent` and `header`; everyone else is a subagent, and a single executor is a subagent. `--mode subagent` means no panes. Details: `panes-mode.md` → "Through the mod's tools".

The recon line always names the mode and a one-clause reason (the matching row, or Stage 2's `reasoning`).

## Dispatch header

Every `agentille:agentille-*` dispatch prompt starts with one line:

`[agt run=<id> size=<small|large> risk=<none|auth|money|data> mode=<build|fix|diagnose|review|research> fable=<auto|forced> formation=<none|duel|gauntlet|relay>]`

- `size=large`: plan ≥6 steps or a shared contract, or a diff with logic in >1 file, >~150 LoC, or a public API/schema change.
- `risk`: auth/sessions → `auth`, payments/webhooks → `money`, migrations → `data`.
- `mode=fix` on every fix attempt; `diagnose` for the read-only root-cause planner.
- `fable=forced` only when the user typed `--fable`.

With the mod loaded it routes model + effort from this line and logs to `routing.jsonl` (`/agt-routing`). Still pass `model:` every time: the skill must work with mods off.

Profile prefix (skip it when every value is a default and `neverDo` is empty):

```
User: <name> (<role>). Avoid: <neverDo, verbatim>.
Communicate: <deliveryStyle>, <tone>.
```

## Run modifiers

- `--plan`: stop after the plan and its review; show the plan, the verdict, the mode and roster. "go" resumes with that exact plan. With no planner: `nothing to pre-plan — re-run without --plan`.
- `--fable`: Fable ceiling on judgment roles, never the executor (`routing.md` → "Escalation ladder").
- `--formation duel|gauntlet|relay`: force one (`formations.md`). Gauntlet is automatic on auth/money/data work with a test runner; duel and relay run only on request.

## Hard rules

- **Honor `neverDo`.** Absolute; pass it verbatim into every dispatch.
- **Review gate: P0/P1 block; P2/P3 advisory.** Fix every P0/P1 (re-dispatch the executor, or fix inline if trivial) and confirm the fix. If it cannot or should not be fixed, put it on the card's `⚑` line and let the user decide; never call it shipped.
- **Never auto-target `main`.** Worktrees fork from the current branch (`$BASE`) and merge back into it (`panes-mode.md` → "Consolidation").
- **Never let an agent push through context pressure.** An executor that reports `CONTEXT …` is replaced by a fresh one seeded from its checkpoint and slice.
- **At most 3 executors at once.** Batch the rest in waves.
- **Executor is never Haiku**; Haiku only classifies (`routing.md` → "Hard rules"). Fable comes only from the ladder or `--fable`.
- **Foreground when it gates.** A dispatch whose result feeds the next step uses `run_in_background: false`; background is only for parallel spawns.
- **Mods off still works.** Nothing here depends on the mod; it only adds the switchboard, routing, the wire between panes and raw reports.
- **Never close a pane you did not open.** The `agt-` prefix is ownership; a `/agt-spawn` pane is the user's.
