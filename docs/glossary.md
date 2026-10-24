# Glossary

The words the README and the reference pages use, one meaning each.

- **Level:** how big the crew is. low (solo or one builder), medium (parallel subagents), heavy (panes). You force one with `/agt low|medium|heavy "task"`.
- **Transport:** how a run's workers execute: `solo` (Claude does it itself), `subagent`, `panes` (Herdr or tmux) or `workflow`. The recon line names it. `transport-panes.md` and `transport-workflow.md` in `skills/agt/` describe two of them.
- **Integration:** what a finished slice becomes, set by `integration` in your profile: `pr` (default), `auto`, `push` or `local`. A repo can only lower it.
- **Work type:** what one dispatch is for, written in the dispatch header as `work=`: `build`, `fix`, `diagnose`, `review` or `research`. The older spelling `mode=` is still read: deprecated; removed in 4.0.0.
- **Mode:** only the `--mode` flag's name for a level: `solo` (low), `subagent` (medium), `panes` or `herdr` (heavy). Deprecated; removed in 4.0.0. Type the level instead.
- **Slice:** one file-disjoint part of the task, built by one executor on its own branch. The dispatch header carries its slug as `slice=` (the older `piece=` is still read: deprecated; removed in 4.0.0).
- **Executor, planner, reviewers, adversary:** the agent roles in `agents/`. Reviewers read and run tests; they never edit. The adversary writes tests that try to break a slice.
- **Pane / worker:** a real Claude (or Codex) session in a Herdr or tmux pane, named `agt-<run>-<role>`, doing one slice. **Session:** a pane that is yours, opened with "open two sessions".
- **The mod:** the JavaScript in `hooks/` that Claude Code loads beside the skill. It draws the band, routes models, carries the wire, opens and closes panes. The skill works without it.
- **The band** (alias: switchboard): the live dispatch tree above your prompt (`display.band`). **Deck:** the fuller side pane (`/agt-deck`). **Focus flags:** the `⚑` lines in the band (a REVISE, a FAIL, a blocked pane); they clear when the run's card prints. **Status line:** the one line pinned under the prompt during a run (`display.statusLine`). **Mascot:** the small figure in a worker pane's band and the deck's cast (`display.mascot`).
- **The wire:** how pane workers report back to your session when they finish.
- **Run card:** the ≤8-line summary that ends every non-solo run. **Run dir:** `~/.agentille/state/run-<id>/`.
- **Squad:** extra reviewers (payments, SEO, perf) a repo type adds. **Formation:** a run shape (duel, gauntlet, relay) that reshapes the workers.
- **Recon line:** the first line of a run, `recon: <level> · <transport> · <reason>`.
