# Routing cost: the `maxRunUsd` estimate

`profile.routing.maxRunUsd` (default `15`; `null` turns it off) is a per-run cost ceiling in US dollars. The README's Settings section and `skills/agt/routing.md` → "Cost ceiling" say what happens once a run reaches it. This page holds how the mod estimates a run's spend.

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

## What it leaves out

- **It is an estimate, not a bill.** A plan subscription is not billed per token.
- **Cache writes count as plain input,** though they cost about 1.25× that.
- **Pane workers report no tokens to the lead,** so they are estimated, not measured (below).

## Pane workers

A Herdr or tmux pane worker reports no tokens, so one function, `paneUsd` in `hooks/routing.js`, estimates it as *tokens per minute for its role × its routed model's prices × minutes open*:

| role | input / min | output / min | cache read / min |
|---|---|---|---|
| executor, adversary | 10k | 2.5k | 80k |
| any other role | 8k | 1.5k | 60k |

Minutes run from the pane's start to its end (or now), at most 60 per pane. That is about $0.06 a minute for a Sonnet executor and $0.07 for an Opus judge. A Codex pane runs on the person's own Codex account and counts $0.

## Where to see it

- `/agt-info ledger` shows the run's estimate beside the ceiling.
- `/agt-info route <role>` shows the pick a role gets past the ceiling.
