# Routing cost: the `maxRunUsd` estimate

`profile.routing.maxRunUsd` (default `15`; `null` turns it off) is a per-run cost ceiling in US dollars. [settings.md](./settings.md#routing) and `skills/agt/routing.md` → "Cost ceiling" say what happens once a run reaches it. This page holds how the mod estimates a run's spend.

`maxRunUsd` is an estimate at API list prices, not your subscription's quota. On a plan subscription you are not billed per token, so a run can pass $15 on this estimate while using little of your plan, or stay under it while your week runs low. The gate on the subscription itself is `routing.stopAtWeeklyPct` (below, "The weekly gate").

## The estimate

For every subagent of the run, the mod multiplies its tokens by that model's price per million tokens and adds them up:

`(input × input price + output × output price + cache reads × cache-read price) / 1,000,000`

The prices are the first-party API list prices of the current model generation (`PRICES` in `hooks/routing.js`), in US dollars per million tokens:

| model | input | output | cache read |
|---|---|---|---|
| Fable | 10 | 50 | 0.25 |
| Opus | 4 | 20 | 0.20 |
| Sonnet | 2 | 10 | 0.20 |
| Haiku | 0.10 | 0.50 | 0.01 |

A model the mod cannot name is priced as Opus.

The lead session's own tokens count too. Each main-loop step of the lead reports its usage, and the steps taken while an `/agt` run is in progress are added to that run and priced at the lead's model. That covers the procedure the lead reads at the start of a run and every report it reads after. Steps taken before the run has an id (its first pane or routed dispatch names it) wait and join the run once it does. Lead turns outside a run never count.

## What it leaves out

- **It is an estimate, not a bill.** A plan subscription is not billed per token.
- **Cache writes count as plain input,** though they cost about 1.25× that.
- **Pane workers report no tokens to the lead,** so they are estimated, not measured (below).
- **The lead's model is the one it ran last on the run.** A run whose lead switched models midway is priced at the newer one.

## Pane workers

A Herdr or tmux pane worker reports no tokens, so one function, `paneUsd` in `hooks/routing.js`, estimates it as *tokens per minute for its role × its routed model's prices × minutes open*:

| role | input / min | output / min | cache read / min |
|---|---|---|---|
| executor, adversary | 10k | 2.5k | 80k |
| any other role | 8k | 1.5k | 60k |

Minutes run from the pane's start to its end (or now), at most 60 per pane. That is about $0.06 a minute for a Sonnet executor and $0.07 for an Opus judge. A Codex pane runs on the person's own Codex account and counts $0.

## At the ceiling

Once the estimate is at or over `maxRunUsd`, one of two things happens to every later dispatch of the run, subagent, pane or workflow agent:

- **Demotion (the default).** A role the table or the ladder puts on Opus, or a ladder Fable, runs Sonnet at the same effort. That covers the planner, the plan-reviewer, every reviewer (code, design, security, payments, perf, seo), the ui-prototyper and the adversary. The executor keeps its route, since it is on Sonnet already. A workflow agent cannot be demoted: Claude Code ignores a model rewrite for a workflow script's agents, so it runs the model the script names, and the mod logs it and toasts the mismatch with the demoted pick.
- **Stop.** With `profile.routing.stopAtCeiling: true` (default `false`), the dispatch is denied instead. The stop covers every role, the executor and a typed `--fable` included, every pane, a Codex one included, and every workflow agent. The deny is one line that names the ceiling and the estimate, and says to raise `routing.maxRunUsd` in `~/.agentille/profile.json` (or turn `stopAtCeiling` off) to go on.

### A typed `--fable` passes the ceiling

`--fable` typed on the `/agt` line is your own choice, so demotion leaves it alone: past the ceiling, a role you forced onto Fable still runs Fable. The run says so. The first such dispatch in a run, subagent or pane, gets one toast and one band `⚑` line (`planner runs Fable anyway, since a typed --fable passes the ceiling`), and every such dispatch carries `"pastCeiling": true` in the run's `routing.jsonl`. The stop does not make this exception: with `stopAtCeiling` on, a typed `--fable` past the ceiling is denied like any other dispatch.

## The weekly gate: `stopAtWeeklyPct`

`profile.routing.stopAtWeeklyPct` (default `0`, off) gates on your subscription's real usage rather than the price estimate. Set it to a number from 1 to 100: once the seven-day usage percent Claude Code reports for your plan is at or above it, every later agentille dispatch is denied, whatever the role (executor, typed `--fable` and workflow agents included), with one line that names the percent and the key, and says to raise `routing.stopAtWeeklyPct` (or set it to `0`) to go on.

- It needs neither `maxRunUsd` nor `stopAtCeiling`; each gate works on its own, and when both apply the ceiling's line is the one shown.
- Until Claude Code has reported a seven-day percent in the session, nothing is denied.
- `0`, `null`, a number outside 1–100 or anything but a number turns it off.
- A Codex pane is not gated on it: it runs on your own Codex account and spends none of the subscription. The cost ceiling's stop still covers it.

## Where to see it

- `/agt-info ledger` shows the run's estimate beside the ceiling, and how much of it is the lead's own.
- `/agt-info route <role>` shows the pick a role gets past the ceiling, or `denied` when a stop applies.
