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

## Best with Herdr

- Workers are labeled in Herdr's sidebar, and a row's `↗` jumps to its pane.
- A run with 3+ pane workers gets its own tab, so your tab stays whole.
- Ask for Codex in the task ("codex builds the API slice") and that slice runs as a Codex pane on your own Codex config.
- tmux works with the same band; without a multiplexer you get the subagent tree.
