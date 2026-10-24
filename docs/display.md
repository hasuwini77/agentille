# What you see during a run

Everything on this page is drawn by the mod (`hooks/`) for zero model tokens. Without the mod, `/agt` still runs and you get the plain subagent tree.

## The switchboard

A framed dispatch tree above your prompt, rooted at your session.

- **The swarm line** on top holds every agent of the run by phase (`plan ✓ · build ◆◇ · review ◆◆◆ · 2/6 done`), however many there are.
- **One row per agent**: each subagent (`◇`) and pane session (`▣`) gets a row with its model pill, the tool it is running, elapsed time and tokens. `↑` marks an escalated route.
- **Nesting**: reviewers nest under the agent that spawned them, the agent you are viewing is highlighted, and a waiting or failed agent says so.
- **Each worker pane** shows a small mascot that says hi, walks while it works and waves bye.

## In the transcript and under the prompt

- Each `Agent` call in the conversation becomes a live row: role, model · effort, current tool, elapsed, tokens.
- A pinned status line under the prompt keeps `◇ working · done · tokens · $ session` in view when the band is collapsed.
- Dollar figures are the measured session cost only; per-agent numbers are tokens.

## Pane workers

- **Never loses a worker's answer**: a pane is closed only once its answer is saved or read, the session-end sweep included. The sweep skips a pane with no saved answer and never touches one another session opened.
- A pane that finishes silently is flagged to you.
- `/agt` refuses to open panes when the session runs an older agentille than the one installed (restart first).
- **The wire**: pane workers report to your session when they finish, so it wakes on its own; their live status reaches your band through a shared store.
- **When no wire message comes:** if a pane finishes and no wire message arrives within about 20 s, the mod tries to send the lead one `[agt wake]` message naming the pane and the read command (`herdr agent read <name> --source recent-unwrapped --lines 200`, or `tmux capture-pane -p -t <id> -S -200`). A session cannot message itself, so this usually reaches you as a `⚑` toast instead of waking the lead. A blocked pane gets no wake: it waits on you.
- **What counts as harvested:** the mod closes an `idle` `agt-` pane only while the lead has no turn running, and a `done` one about 10 s after it settles, and only once it is harvested:
  - that pane's own answer file `agents/pane-<role>.<pane>.md` was written after the pane opened (an earlier pane's file does not count), its wire done message reached the lead, or the lead closed it;
  - an older worker's legacy `pane-<role>.md` counts only while exactly one pane has that name;
  - a role the lead respawns is a new pane and starts unharvested, even while the earlier pane is still open.
- **Until then** the pane stays open and is flagged once (`⚑ <name> done, not harvested`, or `idle, not harvested`).

## Pane layout and cleanup

- **Layout:** the first worker splits right of the lead, and later workers stack below the previous worker. On Herdr, a run with `layout: "tab"` stacks its workers in their own `agt-<run>` tab; the lead's tab stays whole, and the tab closes with its last worker.
- **The reaper:** the mod closes a harvested `agt-` pane about 10 s after it reads `done`, and 60 s after `idle` while the lead is not mid-turn. `/agt-spawn` panes and Codex panes close the same way. On tmux, a pane counts as `done` once its done file exists, and closes once it is harvested and `done` has held about 10 s.
- **Never touched:** a `working`, `blocked` or `unknown` pane, and any pane without the `agt-` prefix. A role the lead respawns is a new pane and starts unharvested.
- **At session end:** the SessionEnd sweep closes only the `agt-` panes this lead opened (recorded in `~/.agentille/state/lead-<pane>.panes`). Of those it closes only the `idle` or `done` ones whose answer is saved (an answer file or done marker exists). `/clear` never triggers it, and a session that opened no panes sweeps nothing.

## After a compaction

When a session with an `/agt` run in flight compacts, a hook prints a short `[agt re-entry]` block into the new context: the run id, how its workers run (subagent, panes or workflow), one line per slice with each role's state (working or done), and which files to re-read before the next dispatch. The mod names the session's run in `~/.agentille/state/session-<session id>.run` at the run's first dispatch, and refreshes the run's `ledger.json` on each dispatch so every slice shows from the start. A run whose `report.md` is written, or that has not changed in a day, counts as over: the hook prints nothing.

## Best with Herdr

- Workers are labeled in Herdr's sidebar, and a row's `↗` jumps to its pane.
- A run with 3+ pane workers gets its own tab, so your tab stays whole.
- Ask for Codex in the task ("codex builds the API slice") and that slice runs as a Codex pane on your own Codex config.
- tmux works with the same band; without a multiplexer you get the subagent tree.
